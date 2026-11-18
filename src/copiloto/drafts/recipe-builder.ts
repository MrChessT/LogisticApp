// Escandallo nuevo desde el chat: un plato (con su PVP) o una elaboración (que se usa dentro de otros platos),
// con sus ingredientes. Cada ingrediente se busca en el catálogo: si no se encuentra, si encaja con varios o si
// la cantidad no cuadra con cómo se mide el producto, no se inventa nada: se avisa para añadirlo en Escandallos.
// Una elaboración suma sus ingredientes como rendimiento (1 kg de tomate + 50 ml de aceite no cuadra: se pide
// el mismo tipo de medida). Solo encargados; la base de datos decide al confirmar.
import Decimal from "decimal.js";
import type { DocumentDraft } from "../contract/index";
import { hasRole, type Product, type SessionContext } from "../domain";
import { normalize } from "../entities/normalize";
import type { Retriever } from "../entities/retriever";
import { formatMoney } from "../entities/units";
import { productsNamed } from "../agent/product-facts";
import { recipeFromMessage, type RecipeIngredient } from "../agent/recipe-chat";
import type { InfoSource } from "../tools/info";
import { draftBase, type BuildResult } from "./builder";
import { validateDraft } from "./schemas";

interface RecipeInput {
  message: string;
  ctx: SessionContext;
  info: InfoSource | undefined;
  retriever: Retriever | undefined;
  now: Date;
}

/** Cómo se mide cada unidad dicha: dimensión del producto y factor a la unidad base (g, ml o ud). */
export const UNIT: Record<string, { dimension: Product["dimension"]; factor: number }> = {
  g: { dimension: "mass", factor: 1 },
  kg: { dimension: "mass", factor: 1000 },
  ml: { dimension: "volume", factor: 1 },
  cl: { dimension: "volume", factor: 10 },
  l: { dimension: "volume", factor: 1000 },
  ud: { dimension: "count", factor: 1 },
};

type Resolved = { ok: true; productId: string; name: string; qtyBase: Decimal; qtyText: string; baseUnit: Product["baseUnit"] } | { ok: false; warning: string };

/** Un ingrediente de la frase contra el catálogo: el producto, su cantidad base, o el motivo por el que no entra. */
export async function resolveIngredient(item: RecipeIngredient, ctx: SessionContext, retriever: Retriever): Promise<Resolved> {
  // Un nombre dicho entero es ese producto («Ron Barceló Añejo 70 cl»), aunque otro se le parezca («Ron Brugal»).
  const exact = ctx.products.filter((p) => normalize(p.name) === normalize(item.phrase));
  const products = exact.length > 0 ? exact : await productsNamed(item.phrase, ctx, retriever, 6);
  if (products.length === 0) return { ok: false, warning: `No encuentro «${item.phrase}» en el catálogo: añádelo en Escandallos.` };
  if (products.length > 1) return { ok: false, warning: `«${item.phrase}» encaja con varios productos: añádelo en Escandallos para elegir cuál.` };
  const product = products[0]!;
  if (item.amount === null) return { ok: false, warning: `Falta la cantidad de «${product.name}»: añádela en Escandallos.` };
  const amount = new Decimal(item.amount);
  if (!amount.gt(0)) return { ok: false, warning: `La cantidad de «${product.name}» tiene que ser mayor que 0.` };
  const unit = item.unit ?? (product.dimension === "count" ? "ud" : null);
  if (!unit) return { ok: false, warning: `Dime la cantidad de «${product.name}» en g, kg, ml o l.` };
  const spec = UNIT[unit]!;
  if (spec.dimension !== product.dimension) {
    return { ok: false, warning: `«${product.name}» no se mide en ${unit}: pon la cantidad en ${product.dimension === "mass" ? "g o kg" : product.dimension === "volume" ? "ml, cl o l" : "unidades"}.` };
  }
  const qtyBase = amount.mul(spec.factor);
  return { ok: true, productId: product.id, name: product.name, qtyBase, qtyText: `${amount.toString()} ${unit}`, baseUnit: product.baseUnit };
}

export async function newRecipe({ message, ctx, info, retriever, now }: RecipeInput): Promise<BuildResult> {
  if (!hasRole(ctx.role, "manager")) return { kind: "error", message: "Los escandallos los crean los encargados y la administración." };
  if (!info) return { kind: "error", message: "Los escandallos no están disponibles ahora mismo." };
  const parsed = recipeFromMessage(message);
  if (!parsed) return { kind: "error", message: "Dime el nombre del escandallo, por ejemplo «crea el escandallo de croquetas de jamón con PVP 9,50»." };

  const existing = (await info.recipes(ctx.orgId)).find((r) => normalize(r.name) === normalize(parsed.name));
  if (existing) return { kind: "error", message: `Ya hay un escandallo llamado «${existing.name}».` };

  const warnings: string[] = [];
  const lines: Array<{ productId: string; qtyBase: string; label: string; qty: string }> = [];
  let baseUnit: Product["baseUnit"] | null = null;
  let sum = new Decimal(0);
  for (const item of parsed.ingredients) {
    const r = retriever ? await resolveIngredient(item, ctx, retriever) : ({ ok: false, warning: "El catálogo no está disponible ahora mismo." } as const);
    if (!r.ok) {
      warnings.push(r.warning);
      continue;
    }
    // Un plato mezcla lo que sea (200 g de jamón y 50 ml de aceite). Una elaboración tiene un rendimiento
    // en una sola medida: sus ingredientes tienen que ser todos de peso o todos de volumen (o unidades).
    if (parsed.kind === "elaboracion" && baseUnit && r.baseUnit !== baseUnit) {
      return { kind: "error", message: "Una elaboración tiene un solo rendimiento: pon todos sus ingredientes en peso (g, kg) o todos en volumen (ml, cl, l)." };
    }
    lines.push({ productId: r.productId, qtyBase: r.qtyBase.toString(), label: r.name, qty: r.qtyText });
    baseUnit ??= r.baseUnit;
    sum = sum.plus(r.qtyBase);
  }

  let yieldQty = "1";
  let yieldUnit: "racion" | "g" | "ml" | "ud" = "racion";
  if (parsed.kind === "elaboracion") {
    if (lines.length === 0) return { kind: "error", message: `Una elaboración lleva ingredientes: dime cuáles y cuánto, por ejemplo «elaboración salsa de tomate: 1 kg de tomate, 50 ml de aceite».` };
    yieldQty = sum.toString();
    yieldUnit = baseUnit === "g" ? "g" : baseUnit === "ml" ? "ml" : "ud";
  }
  if (parsed.kind === "plato" && !parsed.salePrice && parsed.ingredients.length === 0) warnings.push("Sin PVP ni ingredientes: el coste sale al añadirlos en Escandallos.");

  const label = parsed.kind === "elaboracion" ? "Elaboración" : "Plato";
  const price = parsed.salePrice ? formatMoney(parsed.salePrice) : null;
  const base = draftBase("documento", `Escandallo nuevo: ${parsed.name}`, ctx, warnings, now);
  const draft: DocumentDraft = {
    ...base,
    requiredRole: "manager",
    canConfirm: hasRole(ctx.role, "manager"),
    kind: "documento",
    operation: "crear_escandallo",
    // Aún no existe: como en «crear zona», el documento de referencia es la organización.
    documentId: ctx.orgId,
    locationId: ctx.locations[0]!.id,
    summary: `${label}${price ? ` · PVP ${price} con IVA` : ""} · ${lines.length} ${lines.length === 1 ? "ingrediente" : "ingredientes"}`,
    lines: lines.length > 0 ? lines.map((l) => ({ label: l.label, qty: l.qty })) : [{ label: "Sin ingredientes", qty: "se añaden en Escandallos" }],
    recipe: {
      name: parsed.name,
      kind: parsed.kind,
      salePrice: parsed.salePrice,
      yieldQty,
      yieldUnit,
      lines: lines.map((l) => ({ productId: l.productId, qtyBase: l.qtyBase })),
    },
  };
  return {
    kind: "draft",
    draft: validateDraft(draft),
    summary: { operation: "create a recipe (dish or kitchen preparation) with its ingredients", document: draft.summary, lines: parsed.name },
  };
}
