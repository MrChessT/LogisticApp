// Borrador de cambios en la ficha de productos (categoría, alérgenos). Una familia del catálogo se cambia
// entera («los rones van en Destilados»: el borrador enseña cuáles); un nombre que encaja con varios
// productos sin ser familia pregunta cuál, con la opción de todos. Solo encargados; decide la base.
import type { DocumentDraft } from "../contract/index";
import { hasRole, type Product, type SessionContext } from "../domain";
import { familyOf } from "../entities/family";
import type { Retriever } from "../entities/retriever";
import { parseSheet } from "../agent/product-sheet";
import { ALLERGEN_LABEL } from "../../lib/recipes";
import { draftBase, type BuildResult } from "./builder";
import { validateDraft } from "./schemas";

const MAX_PRODUCTS = 12;

interface SheetInput {
  message: string;
  ctx: SessionContext;
  overrides: Record<string, string>;
  now: Date;
  retriever: Retriever | undefined;
}

async function productsFor(phrase: string, ctx: SessionContext, retriever: Retriever, chosen: string | undefined): Promise<Product[] | { ask: Product[] }> {
  if (chosen === "todos" || chosen?.startsWith("producto:")) {
    const found = await retriever.retrieve(ctx.products, phrase, MAX_PRODUCTS, ctx.catalogHash);
    if (chosen === "todos") return found.filter((c) => c.score >= (found[0]?.score ?? 0) * 0.75).map((c) => c.product);
    const one = ctx.products.find((p) => p.id === chosen.slice(9));
    return one ? [one] : [];
  }
  const family = familyOf(phrase, ctx.products, { exact: true });
  if (family) return family.products.slice(0, MAX_PRODUCTS);
  const found = await retriever.retrieve(ctx.products, phrase, MAX_PRODUCTS, ctx.catalogHash);
  const best = found[0];
  if (!best || best.score < 0.8) return [];
  const close = found.filter((c) => c.score >= best.score * 0.75).map((c) => c.product);
  return close.length === 1 ? close : { ask: close };
}

export async function productSheet({ message, ctx, overrides, now, retriever }: SheetInput): Promise<BuildResult> {
  if (!retriever) return { kind: "error", message: "El catálogo no está disponible ahora mismo." };
  if (!hasRole(ctx.role, "manager")) return { kind: "error", message: "La ficha de los productos la cambian los encargados y la administración." };
  const change = parseSheet(message, ctx);
  if (!change) return { kind: "error", message: "Dime el producto y lo que cambia, por ejemplo «pon el pacharán en Licores» o «el pan lleva gluten»." };
  const found = await productsFor(change.productPhrase, ctx, retriever, overrides.documento);
  if ("ask" in found) {
    return {
      kind: "clarify",
      plan: {
        type: "clarify",
        field: "documento",
        question: "¿A cuál de estos productos?",
        options: [...found.ask.slice(0, 5).map((p) => ({ id: `producto:${p.id}`, label: p.name, probability: null })), { id: "todos", label: "A todos", probability: null }],
      },
    };
  }
  if (found.length === 0) return { kind: "error", message: `No encuentro «${change.productPhrase}» en el catálogo. Dímelo como sale en Productos.` };

  const category = change.categoryId ? ctx.categories.find((c) => c.id === change.categoryId) : undefined;
  const what = [
    category ? `categoría ${category.name}` : "",
    change.addAllergens.length ? `lleva ${change.addAllergens.map((a) => ALLERGEN_LABEL[a]!.toLowerCase()).join(", ")}` : "",
    change.removeAllergens.length ? `sin ${change.removeAllergens.map((a) => ALLERGEN_LABEL[a]!.toLowerCase()).join(", ")}` : "",
  ].filter(Boolean);
  const lines = found.map((p) => ({
    label: p.name,
    qty: [
      category ? `${p.category ?? "sin categoría"} → ${category.name}` : "",
      ...change.addAllergens.map((a) => `+ ${ALLERGEN_LABEL[a]}`),
      ...change.removeAllergens.map((a) => `− ${ALLERGEN_LABEL[a]}`),
    ].filter(Boolean).join(" · "),
  }));
  const base = draftBase("documento", `Ficha: ${found.length === 1 ? found[0]!.name : `${found.length} productos`} (${what.join("; ")})`, ctx, found.length > 1 ? [`Se cambian los ${found.length} productos de la lista.`] : [], now);
  const draft: DocumentDraft = {
    ...base,
    requiredRole: "manager",
    canConfirm: hasRole(ctx.role, "manager"),
    kind: "documento",
    operation: "ficha_producto",
    documentId: found[0]!.id,
    locationId: ctx.locations[0]!.id,
    summary: what.join("; "),
    lines,
    sheet: { productIds: found.map((p) => p.id), ...(category ? { categoryId: category.id } : {}), addAllergens: change.addAllergens, removeAllergens: change.removeAllergens },
  };
  return { kind: "draft", draft: validateDraft(draft), summary: { operation: "change the category or allergens of products", document: draft.summary, lines: lines.map((l) => `${l.label}: ${l.qty}`).join("; ") } };
}
