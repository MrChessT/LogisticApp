// Enlazar un artículo del TPV desde el chat, como en Ventas: a un plato o elaboración (cuántas raciones o cuánta
// cantidad gasta cada venta), a un producto («la COPA DE LA CASA son 150 ml de vino tinto») o ignorarlo en el food
// cost («ignora el artículo PAN del TPV»). Con eso, sus ventas pasan a tener coste. Se guarda con link_sales_item,
// la misma función que la pantalla, al confirmar. Lo que no se encuentra o encaja con varios no se adivina.
import Decimal from "decimal.js";
import type { DocumentDraft } from "../contract/index";
import { hasRole, type Product, type RecipeRef, type SessionContext } from "../domain";
import { normalize, STOPWORDS, tokenize } from "../entities/normalize";
import type { Retriever } from "../entities/retriever";
import { productsNamed } from "../agent/product-facts";
import type { InfoSource } from "../tools/info";
import type { SalesItemRef } from "../tools/info-sales";
import { draftBase, type BuildResult } from "./builder";
import { UNIT } from "./recipe-builder";
import { validateDraft } from "./schemas";

/** «Enlaza…», «asocia…», «es el plato…» o «ignora…» hablando de un artículo del TPV o de ventas. */
export const SALES_LINK = /\b(enlaza|enlazar|enlazalo|enlazala|asocia|asociar|vincula|vincular|relaciona|relacionar|corresponde|ignora|ignorar|ignoralo)\b.*\b(tpv|articulo|articulos|ventas?)\b|\b(tpv|articulo)\b.*\b(enlaza|enlazar|asocia|vincula|corresponde|es el plato|son|es|ignora|ignorar)\b/;
const IGNORE = /\b(ignora|ignorar|ignoralo|ignorala|no cuentes|no lo cuentes|no la cuentes|sin coste)\b/;
const AMOUNT = /(\d+(?:[.,]\d+)?)\s*(raciones|racion|kg|kilos?|g|gr|gramos?|l|litros?|cl|ml|ud|uds|unidades)?\b/;
const UNIT_ALIAS: Record<string, string> = { kg: "kg", kilo: "kg", kilos: "kg", g: "g", gr: "g", gramo: "g", gramos: "g", l: "l", litro: "l", litros: "l", cl: "cl", ml: "ml", ud: "ud", uds: "ud", unidad: "ud", unidades: "ud", racion: "racion", raciones: "racion" };
const CONNECTORS = /^(?:(?:con|a|al|es|son|como|del|de|la|el|las|los|un|una|lleva|plato|receta|elaboracion|escandallo|producto|que|y|cada|venta|tpv|articulo)\s+)+/;

const clean = (s: string) => normalize(s).replace(/(?<!\d)[.,]|[.,](?!\d)|[¿?¡!;:«»"()=]/g, " ").replace(/\s+/g, " ").trim();
const words = (s: string) => tokenize(s).filter((w) => w.length > 2 && !STOPWORDS.has(w));

/** El artículo nombrado: por su nombre entero (el más largo) o por su código («artículo 41»). */
function namedItem(text: string, items: SalesItemRef[]): { item: SalesItemRef; at: number; length: number } | null {
  let best: { item: SalesItemRef; at: number; length: number } | null = null;
  for (const item of items) {
    const name = clean(item.name);
    const at = name.length >= 3 ? ` ${text} `.indexOf(` ${name} `) : -1;
    if (at >= 0 && (!best || name.length > best.length)) best = { item, at, length: name.length };
  }
  if (best) return best;
  const code = /\b(?:articulo|codigo|cod)\s+(\w+)\b/.exec(text)?.[1];
  const byCode = code ? items.filter((i) => clean(i.code) === code) : [];
  return byCode.length === 1 ? { item: byCode[0]!, at: text.indexOf(code!), length: code!.length } : null;
}

/** El escandallo dicho: por nombre entero, o el único que tiene todas las palabras dichas. */
function namedRecipe(phrase: string, recipes: RecipeRef[]): RecipeRef | null {
  const exact = recipes.filter((r) => clean(r.name) === phrase);
  if (exact.length === 1) return exact[0]!;
  const said = words(phrase);
  const partial = recipes.filter((r) => said.length > 0 && said.every((w) => words(r.name).some((n) => n.startsWith(w.slice(0, 5)) || w.startsWith(n.slice(0, 5)))));
  return partial.length === 1 ? partial[0]! : null;
}

interface SalesLinkInput {
  message: string;
  ctx: SessionContext;
  info: InfoSource | undefined;
  retriever: Retriever | undefined;
  now: Date;
}

export async function salesLink({ message, ctx, info, retriever, now }: SalesLinkInput): Promise<BuildResult> {
  if (!hasRole(ctx.role, "manager") || !ctx.seesCosts) return { kind: "error", message: "Las ventas las ve la dirección (propiedad, administración y encargados) con el permiso «ve costes»." };
  if (!info) return { kind: "error", message: "Las ventas no están disponibles ahora mismo." };
  const text = clean(message);
  const items = await info.salesItems(ctx.orgId);
  const named = namedItem(text, items);
  if (!named) {
    const pending = items.filter((i) => i.link === "sin_enlazar").slice(0, 6).map((i) => i.name);
    return { kind: "error", message: `No encuentro ese artículo del TPV. Dímelo como sale en Ventas${pending.length ? ` (sin enlazar: ${pending.join(", ")}…)` : ""}.` };
  }
  const { item } = named;
  const base = (title: string) => draftBase("documento", title, ctx, [], now);
  const finish = (link: NonNullable<DocumentDraft["salesLink"]>, lineQty: string, warnings: string[] = []): BuildResult => {
    const draft: DocumentDraft = {
      ...base(`Ventas: ${item.name}`),
      warnings,
      requiredRole: "manager",
      canConfirm: hasRole(ctx.role, "manager"),
      kind: "documento",
      operation: "enlazar_venta",
      documentId: item.id,
      locationId: ctx.locations[0]!.id,
      summary: `Artículo del TPV${item.code ? ` ${item.code}` : ""} · ahora ${item.link === "sin_enlazar" ? "sin enlazar" : item.link === "ignorado" ? "ignorado" : `enlazado a ${item.link === "receta" ? "un escandallo" : "un producto"}`}`,
      lines: [{ label: item.name, qty: lineQty }],
      salesLink: link,
    };
    return { kind: "draft", draft: validateDraft(draft), summary: { operation: "link a point-of-sale item to a recipe or product (or ignore it) so its sales get a cost", document: item.name, lines: lineQty } };
  };

  if (IGNORE.test(text)) return finish({ itemId: item.id, itemName: item.name, ignored: true }, "Ignorar (no cuenta en el food cost)");

  // Lo que se dice después del artículo es a qué se enlaza, con su cantidad por venta.
  let rest = `${text.slice(0, named.at)} ${text.slice(named.at + named.length + 1)}`.replace(SALES_LINK, " ").replace(/\b(enlaza\w*|asocia\w*|vincula\w*|relaciona\w*|corresponde)\b/g, " ");
  const amount = AMOUNT.exec(rest);
  if (amount) rest = rest.replace(amount[0], " ");
  const phrase = rest.replace(/\s+/g, " ").trim().replace(CONNECTORS, "").trim();
  if (!phrase) return { kind: "error", message: `¿A qué enlazo «${item.name}»? Por ejemplo «enlaza el artículo ${item.name} del TPV con las croquetas de jamón».` };
  const unit = amount?.[2] ? UNIT_ALIAS[amount[2]] ?? null : null;
  const qty = amount ? new Decimal(amount[1]!.replace(",", ".")) : null;
  if (qty && !qty.gt(0)) return { kind: "error", message: "La cantidad por venta tiene que ser mayor que 0." };

  const recipe = namedRecipe(phrase, ctx.recipes ?? []);
  if (recipe) {
    // Un plato: raciones por venta (1 si no se dice). Una elaboración: su cantidad, en la unidad que rinde.
    if (recipe.yieldUnit === "racion") {
      if (unit && unit !== "racion" && unit !== "ud") return { kind: "error", message: `«${recipe.name}» se mide en raciones: dime cuántas raciones lleva cada venta.` };
      const per = qty ?? new Decimal(1);
      return finish({ itemId: item.id, itemName: item.name, recipeId: recipe.id, qty: per.toString() }, `→ ${recipe.name} · ${per.toString().replace(".", ",")} ${per.eq(1) ? "ración" : "raciones"} por venta`);
    }
    if (!qty || !unit || !UNIT[unit] || UNIT[unit]!.dimension !== { g: "mass", ml: "volume", ud: "count" }[recipe.yieldUnit]) {
      return { kind: "error", message: `¿Cuánto de «${recipe.name}» lleva cada venta? Dímelo en ${recipe.yieldUnit === "g" ? "g o kg" : recipe.yieldUnit === "ml" ? "ml o l" : "unidades"}.` };
    }
    const per = qty.mul(UNIT[unit]!.factor);
    return finish({ itemId: item.id, itemName: item.name, recipeId: recipe.id, qty: per.toString() }, `→ ${recipe.name} · ${per.toString()} ${recipe.yieldUnit} por venta`);
  }

  if (!retriever) return { kind: "error", message: "El catálogo no está disponible ahora mismo." };
  const products = await productsNamed(phrase, ctx, retriever, 4);
  if (products.length === 0) return { kind: "error", message: `No encuentro «${phrase}» entre los escandallos ni en el catálogo.` };
  if (products.length > 1) return { kind: "error", message: `«${phrase}» encaja con varios productos: ${products.map((p) => p.name).join(", ")}. Dímelo con el nombre completo.` };
  const product: Product = products[0]!;
  const said = unit ?? (product.dimension === "count" ? "ud" : null);
  if (!said || !UNIT[said] || UNIT[said]!.dimension !== product.dimension) {
    return { kind: "error", message: `¿Cuánto de «${product.name}» gasta cada venta? Dímelo en ${product.dimension === "mass" ? "g o kg" : product.dimension === "volume" ? "ml, cl o l (una copa de vino suele ser 150 ml)" : "unidades"}.` };
  }
  const per = (qty ?? new Decimal(1)).mul(UNIT[said]!.factor);
  return finish({ itemId: item.id, itemName: item.name, productId: product.id, qty: per.toString() }, `→ ${product.name} · ${per.toString()} ${product.baseUnit} por venta`);
}
