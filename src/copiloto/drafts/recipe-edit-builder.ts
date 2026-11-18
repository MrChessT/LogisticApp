// Cambiar los ingredientes de un escandallo que ya existe desde el chat (agent/recipe-edit.ts lee la frase):
// añadir un producto o una elaboración, quitar un ingrediente o cambiar su cantidad. El borrador enseña el cambio
// («Jamón: 100 g → 150 g») y al confirmar se aplica solo eso (edit_recipe_lines, 0060): lo que alguien haya cambiado
// a la vez en Escandallos no se pisa. Si el ingrediente no se encuentra o encaja con varios, no se adivina.
import Decimal from "decimal.js";
import type { DocumentDraft } from "../contract/index";
import { hasRole, type RecipeRef, type SessionContext } from "../domain";
import { normalize, STOPWORDS, tokenize } from "../entities/normalize";
import type { Retriever } from "../entities/retriever";
import { recipeEditFromMessage, type RecipeEditChat } from "../agent/recipe-edit";
import type { InfoSource, RecipeLineRaw } from "../tools/info";
import { draftBase, type BuildResult } from "./builder";
import { resolveIngredient, UNIT } from "./recipe-builder";
import { validateDraft } from "./schemas";

interface RecipeEditInput {
  message: string;
  ctx: SessionContext;
  info: InfoSource | undefined;
  retriever: Retriever | undefined;
  now: Date;
}

type Change = { op: "add"; productId?: string; subRecipeId?: string; qty: string } | { op: "remove"; lineId: string } | { op: "set"; lineId: string; qty: string };

const BASE_DIMENSION: Record<string, string> = { g: "mass", ml: "volume", ud: "count" };

/** «1500 g» → «1,5 kg»; «150 g»; «3 ud». */
function qtyText(qty: Decimal, unit: string): string {
  const big = (unit === "g" || unit === "ml") && qty.gte(1000);
  const value = big ? qty.div(1000) : qty;
  const shown = value.toDecimalPlaces(3).toString().replace(".", ",");
  return `${shown} ${big ? (unit === "g" ? "kg" : "l") : unit === "racion" ? "raciones" : unit}`;
}

/** Cantidad dicha en la unidad de la línea (g, ml, ud o la del rendimiento de la elaboración), o el motivo. */
function inUnit(edit: RecipeEditChat, unit: string, name: string): { ok: true; qty: Decimal } | { ok: false; message: string } {
  if (edit.amount === null) return { ok: false, message: `Dime la cantidad de «${name}».` };
  const amount = new Decimal(edit.amount);
  if (!amount.gt(0)) return { ok: false, message: `La cantidad de «${name}» tiene que ser mayor que 0.` };
  const said = edit.unit ?? (unit === "ud" ? "ud" : null);
  if (!said) return { ok: false, message: `Dime la cantidad de «${name}» en ${unit === "g" ? "g o kg" : unit === "ml" ? "ml, cl o l" : "unidades"}.` };
  const spec = UNIT[said]!;
  if (spec.dimension !== BASE_DIMENSION[unit]) return { ok: false, message: `«${name}» no se mide en ${said}: pon la cantidad en ${unit === "g" ? "g o kg" : unit === "ml" ? "ml, cl o l" : "unidades"}.` };
  return { ok: true, qty: amount.mul(spec.factor) };
}

const words = (s: string) => tokenize(s).filter((w) => w.length > 2 && !STOPWORDS.has(w));
const near = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b.slice(0, 5)) || b.startsWith(a.slice(0, 5))));

/** Ingredientes del escandallo que encajan con lo dicho: el nombre entero, o todas sus palabras. */
function matchingLines(phrase: string, lines: RecipeLineRaw[]): RecipeLineRaw[] {
  const exact = lines.filter((l) => normalize(l.name) === normalize(phrase));
  if (exact.length) return exact;
  const said = words(phrase);
  if (!said.length) return [];
  return lines.filter((l) => said.every((w) => words(l.name).some((n) => near(w, n))));
}

/** La elaboración dicha (no el propio escandallo): por su nombre entero o por todas sus palabras. */
function namedPreparation(phrase: string, recipes: RecipeRef[], self: RecipeRef): RecipeRef | null {
  const preps = recipes.filter((r) => r.kind === "elaboracion" && r.id !== self.id && r.yieldUnit !== "racion");
  const exact = preps.filter((r) => normalize(r.name) === normalize(phrase));
  if (exact.length === 1) return exact[0]!;
  const said = words(phrase);
  const partial = preps.filter((r) => said.length > 0 && said.every((w) => words(r.name).some((n) => near(w, n))));
  return partial.length === 1 ? partial[0]! : null;
}

export async function editRecipe({ message, ctx, info, retriever, now }: RecipeEditInput): Promise<BuildResult> {
  if (!hasRole(ctx.role, "manager")) return { kind: "error", message: "Los escandallos los cambian los encargados y la administración." };
  if (!info) return { kind: "error", message: "Los escandallos no están disponibles ahora mismo." };
  const edit = recipeEditFromMessage(message, ctx.recipes);
  if (!edit) return { kind: "error", message: "Dime qué cambio y en qué escandallo, por ejemplo «añade 20 g de queso a las croquetas» o «quita el ajo del gazpacho»." };
  const { recipe } = edit;
  const lines = await info.recipeLines(recipe.id);
  const list = lines.length ? lines.map((l) => l.name).join(", ") : "ningún ingrediente todavía";

  let change: Change;
  let line: { label: string; qty: string };
  if (edit.op === "add") {
    // Elaboración («80 g de bechamel») o producto del catálogo.
    const prep = namedPreparation(edit.phrase, ctx.recipes ?? [], recipe);
    let target: { productId?: string; subRecipeId?: string; name: string; unit: string; qty: Decimal };
    if (prep) {
      const q = inUnit(edit, prep.yieldUnit, prep.name);
      if (!q.ok) return { kind: "error", message: q.message };
      target = { subRecipeId: prep.id, name: prep.name, unit: prep.yieldUnit, qty: q.qty };
    } else {
      if (!retriever) return { kind: "error", message: "El catálogo no está disponible ahora mismo." };
      const r = await resolveIngredient({ phrase: edit.phrase, amount: edit.amount, unit: edit.unit }, ctx, retriever);
      if (!r.ok) return { kind: "error", message: r.warning.replace("añádelo en Escandallos", `añádelo en Escandallos, en «${recipe.name}»`) };
      target = { productId: r.productId, name: r.name, unit: r.baseUnit, qty: r.qtyBase };
    }
    // Si ya lo lleva, se suma a lo que tenía: así «añade 20 g de queso» no deja dos líneas de queso.
    const already = lines.find((l) => (target.productId && l.productId === target.productId) || (target.subRecipeId && l.subRecipeId === target.subRecipeId));
    if (already) {
      const total = new Decimal(already.qty).plus(target.qty);
      change = { op: "set", lineId: already.id, qty: total.toString() };
      line = { label: `${already.name} (ya lo lleva: se suma)`, qty: `${qtyText(new Decimal(already.qty), already.unit)} → ${qtyText(total, already.unit)}` };
    } else {
      change = { op: "add", ...(target.productId ? { productId: target.productId } : { subRecipeId: target.subRecipeId! }), qty: target.qty.toString() };
      line = { label: `Añadir ${target.name}`, qty: qtyText(target.qty, target.unit) };
    }
  } else {
    const found = matchingLines(edit.phrase, lines);
    if (found.length === 0) return { kind: "error", message: `«${recipe.name}» no lleva «${edit.phrase}». Lleva: ${list}.` };
    if (found.length > 1) return { kind: "error", message: `«${edit.phrase}» encaja con varios ingredientes de «${recipe.name}»: ${found.map((l) => l.name).join(", ")}. Dímelo con el nombre completo.` };
    const target = found[0]!;
    if (edit.op === "remove") {
      change = { op: "remove", lineId: target.id };
      line = { label: `Quitar ${target.name}`, qty: qtyText(new Decimal(target.qty), target.unit) };
    } else {
      const q = inUnit(edit, target.unit, target.name);
      if (!q.ok) return { kind: "error", message: q.message };
      if (q.qty.eq(target.qty)) return { kind: "error", message: `«${recipe.name}» ya lleva ${qtyText(q.qty, target.unit)} de ${target.name}: no cambio nada.` };
      change = { op: "set", lineId: target.id, qty: q.qty.toString() };
      line = { label: target.name, qty: `${qtyText(new Decimal(target.qty), target.unit)} → ${qtyText(q.qty, target.unit)}` };
    }
  }

  const warnings: string[] = [];
  // El rendimiento de una elaboración lo decide quien la hace (1 kg de salsa): cambiar un ingrediente no lo toca.
  if (recipe.kind === "elaboracion") warnings.push("El rendimiento de la elaboración no cambia: ajústalo en Escandallos si ahora sale más o menos cantidad.");
  if (edit.op === "remove" && lines.length === 1) warnings.push("Era su único ingrediente: el escandallo se queda sin coste.");

  const base = draftBase("documento", `Escandallo: ${recipe.name}`, ctx, warnings, now);
  const draft: DocumentDraft = {
    ...base,
    requiredRole: "manager",
    canConfirm: hasRole(ctx.role, "manager"),
    kind: "documento",
    operation: "editar_escandallo",
    documentId: recipe.id,
    locationId: ctx.locations[0]!.id,
    summary: `${recipe.kind === "elaboracion" ? "Elaboración" : "Plato"} · ${lines.length} ${lines.length === 1 ? "ingrediente" : "ingredientes"} ahora`,
    lines: [line],
    recipeEdit: { recipeId: recipe.id, recipeName: recipe.name, changes: [change] },
  };
  return {
    kind: "draft",
    draft: validateDraft(draft),
    summary: { operation: "change the ingredients of an existing recipe", document: recipe.name, lines: `${line.label}: ${line.qty}` },
  };
}
