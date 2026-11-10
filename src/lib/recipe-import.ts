// Importación de escandallos desde la exportación «Escandallo» de otros programas de gestión de cocina
// (un bloque por receta: cabecera con nombre, alérgenos, familia, coste unitario, cantidad y unidad; y
// debajo sus ingredientes con bruto, neto, unidad, precio y coste).
//
// Aquí solo se lee y se normaliza; la base de datos (import_recipes) casa los ingredientes con el catálogo,
// crea los que falten si se pide, y aplica todo en una transacción tras la vista previa.
import { ALLERGENS } from "./recipes";

export type IngredientDimension = "mass" | "volume" | "count";

export type ImportLine = {
  ingredient: string;
  /** Nombre sin el corte o la preparación: «Limón (Piel)» → «Limón». Es el producto. */
  product: string;
  dimension: IngredientDimension;
  /** Cantidad neta en unidad base (g, ml o ud) y merma de limpieza (1 − neto/bruto) en %. */
  qty: number;
  waste: number;
  /** Precio por unidad base según el escandallo (para crear el ingrediente si no existe). */
  unitPrice: number | null;
  allergens: string[];
};

export type ImportRecipe = {
  name: string;
  kind: "plato" | "elaboracion";
  category: string | null;
  yieldQty: number;
  yieldUnit: "racion" | "g" | "ml" | "ud";
  declaredAllergens: string[];
  lines: ImportLine[];
};

export type RecipeFileIssue = { recipe: string; row: number; message: string };
export type ParsedRecipes = { recipes: ImportRecipe[]; issues: RecipeFileIssue[]; format: "escandallo" | null };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
/** Nombre para comparar: sin tildes, en minúsculas y con espacios simples (como norm_text en la base). */
export const normName = norm;
const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** «Limón (Piel)» → «Limón»; «Cebolla Morada (Juliana)» → «Cebolla Morada». */
export function productNameOf(ingredient: string): string {
  // Paréntesis anidados («Pimiento Rojo (Limpio (sin pepitas ni rabo))»): se quitan de dentro afuera, y
  // luego cualquier paréntesis suelto que quede.
  let s = ingredient;
  for (let prev = ""; prev !== s; ) { prev = s; s = s.replace(/\([^()]*\)/g, " "); }
  const stripped = clean(s.replace(/[()]/g, " "));
  return stripped || clean(ingredient);
}

const ALLERGEN_WORDS: Array<[RegExp, string]> = [
  [/gluten|trigo|cebada|centeno|avena/, "gluten"], [/crustace/, "crustaceos"], [/huevo/, "huevo"], [/pescado/, "pescado"],
  [/cacahuete|mani\b/, "cacahuete"], [/soja/, "soja"], [/lact|leche/, "lacteos"], [/frutos (con|de) cascara|frutos secos/, "frutos_cascara"],
  [/apio/, "apio"], [/mostaza/, "mostaza"], [/sesamo/, "sesamo"], [/sulfito|dioxido de azufre/, "sulfitos"], [/altramuz/, "altramuces"], [/molusco/, "moluscos"],
];

/** «Pescado \nFrutos con cáscara\nSulfitos(Trazas)» → ["pescado", "frutos_cascara", "sulfitos"]. */
export function parseAllergens(text: string): string[] {
  const found = new Set<string>();
  for (const part of norm(text).split(/\n|,|;|\//)) for (const [re, id] of ALLERGEN_WORDS) if (re.test(part)) found.add(id);
  return ALLERGENS.map((a) => a.id).filter((id) => found.has(id));
}

/** Número tal como lo guarda Excel («1.0», «0,25»). */
function n(raw: string | undefined): number | null {
  const s = clean(raw).replace(",", ".");
  if (!/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

const METRIC: Record<string, { dimension: IngredientDimension; factor: number }> = {
  g: { dimension: "mass", factor: 1 }, gr: { dimension: "mass", factor: 1 }, kg: { dimension: "mass", factor: 1000 },
  ml: { dimension: "volume", factor: 1 }, cl: { dimension: "volume", factor: 10 }, l: { dimension: "volume", factor: 1000 },
  ud: { dimension: "count", factor: 1 }, uni: { dimension: "count", factor: 1 }, unidad: { dimension: "count", factor: 1 }, unidades: { dimension: "count", factor: 1 },
};

/** «6 €/Kg» → 0,006 €/g; «0,079 €/ml» → 0,079 €/ml; «11 €/Paquete» → 11 € por ud. */
export function parseUnitPrice(text: string): { price: number; dimension: IngredientDimension; unitLabel: string } | null {
  const m = /([\d.,]+)\s*€\s*\/\s*(.+)$/.exec(clean(text));
  if (!m) return null;
  const amount = Number(m[1]!.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(amount)) return null;
  const label = clean(m[2]);
  const metric = METRIC[norm(label)];
  if (metric) return { price: amount / metric.factor, dimension: metric.dimension, unitLabel: label };
  return { price: amount, dimension: "count", unitLabel: label };
}

function yieldOf(qty: number, unit: string): { yieldQty: number; yieldUnit: ImportRecipe["yieldUnit"] } {
  const u = norm(unit);
  const metric = METRIC[u];
  if (metric?.dimension === "mass") return { yieldQty: qty * metric.factor, yieldUnit: "g" };
  if (metric?.dimension === "volume") return { yieldQty: qty * metric.factor, yieldUnit: "ml" };
  if (metric?.dimension === "count") return { yieldQty: qty, yieldUnit: "ud" };
  return { yieldQty: qty, yieldUnit: "racion" }; // Pax, ración, persona…
}

/**
 * Lee el libro «Escandallo». `kind` decide si son platos o elaboraciones (la exportación no lo dice; por
 * defecto, las recetas que rinden «Pax» o raciones son platos y el resto, elaboraciones).
 */
export function parseEscandalloBook(rows: string[][], kind?: "plato" | "elaboracion"): ParsedRecipes {
  const recipes: ImportRecipe[] = [];
  const issues: RecipeFileIssue[] = [];
  const isRecipeHeader = (r: string[] | undefined) => clean(r?.[1]) === "Descripción" && /al[eé]rgenos/i.test(clean(r?.[2]));
  if (!rows.some(isRecipeHeader)) return { recipes, issues, format: null };

  for (let i = 0; i < rows.length; i++) {
    if (!isRecipeHeader(rows[i])) continue;
    const head = rows[i + 1] ?? [];
    const name = clean(head[1]);
    if (!name) continue;
    const yq = n(head[7]);
    const { yieldQty, yieldUnit } = yieldOf(yq && yq > 0 ? yq : 1, clean(head[8]) || "Pax");
    const recipe: ImportRecipe = {
      name,
      kind: kind ?? (yieldUnit === "racion" ? "plato" : "elaboracion"),
      category: clean((head[4] ?? "").split("\n")[0]) || null,
      yieldQty,
      yieldUnit,
      declaredAllergens: parseAllergens(head[2] ?? ""),
      lines: [],
    };
    // Ingredientes: desde la cabecera de ingredientes hasta la siguiente receta.
    let j = i + 2;
    while (j < rows.length && !isRecipeHeader(rows[j])) {
      const r = rows[j] ?? [];
      const ingredient = clean(r[2]);
      if (!clean(r[1]) && ingredient && ingredient !== "Descripción") {
        const excelRow = j + 1;
        const price = parseUnitPrice(r[5] ?? "");
        const gross = n(r[6]);
        const net = n(r[7]);
        const unit = clean(r[8]);
        const cost = n(r[11]);
        const metric = METRIC[norm(unit)];
        // La medida la decide la unidad de la línea si es g, kg, ml, l o ud; si es casera (cucharada, hoja,
        // manojo…), la del precio.
        const dimension: IngredientDimension = metric?.dimension ?? price?.dimension ?? "count";
        let netBase: number | null = null;
        let unitPrice: number | null = price ? price.price : null;
        if (net !== null && net > 0 && metric) {
          netBase = net * metric.factor;
          // Precio por bote, paquete o lata pero usado por peso o volumen (o al revés): el precio por unidad
          // base sale del coste de la línea. g ↔ ml se toman 1:1 (aceites pesados en g con precio por litro).
          // Lo mismo si el precio va por un envase («5,29 €/Paquete») y la línea por unidades sueltas.
          const sameKind = price && ((price.dimension === "count") === (metric.dimension === "count")) && METRIC[norm(price.unitLabel)];
          // Pieza que se corta («Pan de Molde Brioche (Rebanada)»: bruto 0,4 barras, neto 2 rebanadas, 3,43 €
          // la barra, coste 1,37 €): si el coste cuadra con bruto × precio y el neto es mayor que el bruto
          // (imposible en la misma unidad), el bruto está en la unidad del precio y es lo que se gasta.
          if (sameKind && metric.dimension === "count" && price && cost !== null && cost > 0 && gross && gross < net
            && Math.abs(gross * metric.factor * price.price - cost) <= cost * 0.02) netBase = gross * metric.factor;
          if (!sameKind && cost !== null && cost > 0 && gross) unitPrice = cost / (gross * metric.factor);
          else if (!sameKind && !(price && (price.dimension === "count") === (metric.dimension === "count"))) unitPrice = null;
        } else if (cost !== null && cost > 0 && price && price.price > 0 && gross && net) {
          // Unidades caseras: la cantidad sale del coste y del precio.
          netBase = (cost / price.price) * (net / gross);
        } else if (!metric && !price && net !== null && net > 0) {
          // Unidad casera sin precio («1 Filete», «0,625 Lata»): se cuenta en esas unidades. El coste
          // queda pendiente hasta que el producto tenga precio (como en el original).
          netBase = net;
        }
        if (netBase === null || !(netBase > 0)) {
          issues.push({ recipe: name, row: excelRow, message: `«${ingredient}»: no se puede saber la cantidad (${clean(r[7])} ${unit}).` });
        } else {
          // Merma: si la línea trae coste, la que hace que cueste lo mismo que en el escandallo (el bruto de
          // algunas exportaciones no es fiable); si no, 1 − neto/bruto.
          const ratio = cost !== null && cost > 0 && unitPrice ? (netBase * unitPrice) / cost : null;
          const waste = ratio !== null
            ? (ratio < 1 ? Math.min(94, Math.round((1 - ratio) * 1000) / 10) : 0)
            : gross && net && gross > net ? Math.min(94, Math.round((1 - net / gross) * 1000) / 10) : 0;
          recipe.lines.push({
            ingredient,
            product: productNameOf(ingredient),
            dimension,
            qty: Math.round((dimension === "count" ? netBase : netBase) * 10_000) / 10_000,
            waste,
            unitPrice,
            allergens: parseAllergens(r[4] ?? ""),
          });
        }
      }
      j++;
    }
    if (recipe.lines.length === 0) issues.push({ recipe: name, row: i + 2, message: "No tiene ingredientes legibles." });
    recipes.push(recipe);
    i = j - 1;
  }
  // Nombres repetidos en el mismo libro: se queda la última y se avisa.
  const seen = new Map<string, number>();
  recipes.forEach((r, idx) => seen.set(norm(r.name), idx));
  const unique = recipes.filter((r, idx) => seen.get(norm(r.name)) === idx);
  if (unique.length < recipes.length) issues.push({ recipe: "", row: 0, message: `${recipes.length - unique.length} recetas repetidas en el fichero: se usa la última de cada una.` });
  return { recipes: unique, issues, format: "escandallo" };
}

/**
 * Un mismo ingrediente puede ir por unidades en una receta y por peso en otra («1 puerro», «150 g de
 * puerro»). El producto se queda con la medida que más se usa y el resto de líneas se pasan a ella con
 * los precios del propio escandallo (mismo coste). Las que no se puedan convertir se dejan como están y
 * la base de datos las señala. También deja un único precio por producto (el más repetido).
 */
export function harmonizeIngredients(
  recipes: ImportRecipe[],
  /** Medida que ya tiene el producto en el catálogo (por nombre normalizado): manda sobre la mayoría. */
  fixed: ReadonlyMap<string, IngredientDimension> = new Map(),
): { converted: number; dropped: RecipeFileIssue[]; kitchen: string[] } {
  const byProduct = new Map<string, ImportLine[]>();
  const kitchen = new Set<string>();
  for (const r of recipes) for (const l of r.lines) byProduct.set(norm(l.product), [...(byProduct.get(norm(l.product)) ?? []), l]);
  let converted = 0;
  const unusable = new Set<ImportLine>();
  for (const [key, lines] of byProduct) {
    const weight = (d: IngredientDimension) => lines.filter((l) => (d === "count" ? l.dimension === "count" : l.dimension !== "count")).length;
    const target: IngredientDimension = fixed.get(key)
      ?? (weight("count") > lines.length - weight("count") ? "count" : (lines.find((l) => l.dimension !== "count")?.dimension ?? "mass"));
    const same = lines.filter((l) => (target === "count") === (l.dimension === "count") && l.unitPrice && l.unitPrice > 0);
    const prices = same.map((l) => l.unitPrice!).sort((a, b) => a - b);
    const ref = prices.length ? prices[Math.floor(prices.length / 2)]! : null;
    for (const l of lines) {
      const sameKind = (target === "count") === (l.dimension === "count");
      if (!sameKind && ref && l.unitPrice && l.unitPrice > 0) {
        l.qty = Math.round(((l.qty * l.unitPrice) / ref) * 10_000) / 10_000;
        l.dimension = target;
        converted++;
      } else if (sameKind && l.dimension !== target) {
        l.dimension = target; // g ↔ ml: misma cantidad.
      } else if (!sameKind && fixed.has(key)) {
        // El catálogo ya lo tiene en la otra medida (una botella del bar usada en cocina por ml) y no hay
        // precios para convertir: va como ingrediente de cocina aparte, sin tocar el del catálogo.
        l.product = l.ingredient = `${l.product} (cocina)`;
        kitchen.add(l.product);
      } else if (!sameKind) {
        unusable.add(l); // Ni precio para convertir: en el original tampoco tiene coste.
      }
      if ((target === "count") === (l.dimension === "count") && ref) l.unitPrice = ref;
    }
  }
  const dropped: RecipeFileIssue[] = [];
  for (const r of recipes) {
    const keep = r.lines.filter((l) => !unusable.has(l));
    for (const l of r.lines.filter((x) => unusable.has(x))) {
      dropped.push({ recipe: r.name, row: 0, message: `«${l.ingredient}» va por ${l.dimension === "count" ? "unidades" : "peso o volumen"} y en el resto de recetas al revés, sin precio para convertirlo: no se incluye (en el original tampoco tiene coste).` });
    }
    r.lines = keep;
  }
  return { converted, dropped, kitchen: [...kitchen].sort() };
}

/**
 * Orden de envío: cada receta después de las que usa como ingrediente (así la base la encuentra como
 * elaboración y no crea un producto con su nombre); a igual profundidad, elaboraciones antes que platos.
 */
export function orderByDependency(recipes: ImportRecipe[]): ImportRecipe[] {
  const byName = new Map(recipes.map((r) => [norm(r.name), r]));
  const depth = new Map<ImportRecipe, number>();
  const depthOf = (r: ImportRecipe, path: Set<ImportRecipe>): number => {
    const known = depth.get(r);
    if (known !== undefined) return known;
    if (path.has(r)) return 0; // ciclo: la base lo rechaza con su propio aviso
    path.add(r);
    let d = 0;
    for (const l of r.lines) {
      const sub = byName.get(norm(l.ingredient)) ?? byName.get(norm(l.product));
      if (sub && sub !== r) d = Math.max(d, depthOf(sub, path) + 1);
    }
    path.delete(r);
    depth.set(r, d);
    return d;
  };
  const rank = (r: ImportRecipe) => (r.kind === "elaboracion" ? 0 : 1);
  return recipes.map((r, i) => ({ r, i, d: depthOf(r, new Set()) })).sort((a, b) => a.d - b.d || rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r);
}
