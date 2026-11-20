// Datos de la ficha que no necesitan a Jev ni elegir un producto. Antes preguntaba «¿De cuál de estos
// productos?» aunque la respuesta sirviera para todos; ahora contesta de todos los que encajan (o de la
// familia entera, si se nombra una):
// · «¿qué categoría tiene el pacharán?»;
// · «¿quién nos trae los vermuts?», «proveedores de la ginebra» (con varios productos; con uno solo
//   sigue la ficha de siempre, que da además el precio y el stock);
// · «¿qué nos trae Makro?»: lo que se le compra a un proveedor;
// · «¿qué proveedor me vende más barata la coca cola?»: el último precio de cada uno, por unidad.
import Decimal from "decimal.js";
import type { Product, SessionContext } from "../domain";
import { formatMoney } from "../entities/units";
import { mentionedSupplier } from "../entities/catalog-parser";
import { familyOf } from "../entities/family";
import { normalize, tokenize } from "../entities/normalize";
import type { Retriever } from "../entities/retriever";
import { forOrdering } from "../tools/orderable";
import type { InventoryDataSource } from "../tools/types";
import type { TopicReply } from "./topics";

const ASK_CATEGORY = /^(?:(?:dime |sabes )?(?:de |a |en )?(?:que|cual(?: es(?: la)?)?) (?:categoria|familia|seccion|tipo)(?: de producto)?(?: tiene| es| son| pertenece(?:n)?(?: a)?| esta(?:n)?(?: en)?| lleva(?:n)?)?|(?:la )?(?:categoria|familia) (?:de|del))\s+(?:el |la |los |las |al |del |de )?(.+)$/;
const ASK_SUPPLIER = /\b(proveedor(es)?|quien(es)? (nos |me )?(trae|traen|sirve|sirven|vende|venden|suministra|suministran)|a quien (le )?(compramos|pedimos|compro|pido)|donde (compramos|pedimos|compro|pido))\b/;
const ASK_SUPPLIER_CATALOG = /\b(que|cuales?|lo que)\b.*\b(nos |me )?(trae|traen|vende|venden|sirve|sirven|compramos|pedimos|compro|pido)\b/;
/** Ordenes, no preguntas: «cambia el proveedor de…», «pon a Makro como proveedor». */
const ACTION = /\b(cambia|cambiar|pon|poner|asigna|asignar|anade|anadir|quita|quitar|crea|crear|da de alta)\b/;
const NOT_PRODUCT = new Set("que quien quienes cual cuales es son el la los las lo de del al a nos me le trae traen sirve sirven vende venden suministra suministran compramos pedimos compro pido donde proveedor proveedores dime sabes".split(" "));

const ASK_CHEAPEST = /\b(mas barat[oa]s?|menos car[oa]s?|mejor precio|mas economic[oa]s?|precio mas bajo)\b/;
const CHEAP_WORDS = new Set(["mas", "menos", "barato", "barata", "baratos", "baratas", "caro", "cara", "mejor", "precio", "economico", "economica", "bajo"]);

/** Como mucho se nombran estos productos; si hay más, se resume. */
const MAX_LISTED = 8;
const MAX_PRODUCTS = 12;

/** Los productos que nombra un texto: una familia del catálogo entera, o los que mejor encajan. */
export async function productsNamed(phrase: string, ctx: SessionContext, retriever: Retriever, max = MAX_PRODUCTS): Promise<Product[]> {
  if (!phrase.trim()) return [];
  const family = familyOf(phrase, ctx.products, { exact: true });
  if (family) return family.products.slice(0, max);
  const found = await retriever.retrieve(ctx.products, phrase, max, ctx.catalogHash);
  const best = found[0];
  // Mismo listón que la vía rápida: el nombre tiene que explicar lo pedido; si no, decide Jev.
  if (!best || best.score < 0.8) return [];
  return found.filter((c) => c.score >= best.score * 0.75).map((c) => c.product);
}

const listed = (names: string[]) => (names.length > MAX_LISTED ? `${names.length} productos` : names.join(", "));

export async function productFact(message: string, ctx: SessionContext, retriever: Retriever, source: InventoryDataSource): Promise<TopicReply | null> {
  const text = normalize(message).replace(/[¿?¡!.,]/g, " ").replace(/\s+/g, " ").trim();
  if (ACTION.test(text)) return null;
  const category = ASK_CATEGORY.exec(text)?.[1]?.trim();
  if (category) return categoryOf(await productsNamed(category, ctx, retriever, MAX_LISTED + 1));
  const supplier = mentionedSupplier(message, ctx.suppliers);
  if (supplier && ASK_SUPPLIER_CATALOG.test(text) && !ASK_SUPPLIER.test(text)) return supplierCatalog(supplier.name, ctx, source);
  if (ASK_SUPPLIER.test(text) && !supplier) {
    const words = tokenize(message).filter((w) => !NOT_PRODUCT.has(w) && !CHEAP_WORDS.has(w));
    const products = await productsNamed(words.join(" "), ctx, retriever);
    // «¿Qué proveedor me vende más barata la coca cola?»: comparar precios, no solo decir quién la trae.
    if (ASK_CHEAPEST.test(text) && products.length > 0) return cheapestSupplier(exactOnly(products, words), source);
    // Uno solo: la ficha de siempre (Jev), que además da precio y stock.
    if (products.length > 1) return suppliersOf(products, source);
  }
  return null;
}

function categoryOf(products: Product[]): TopicReply | null {
  if (products.length === 0) return null;
  const route = "/productos" as const;
  const byCategory = new Map<string, string[]>();
  for (const p of products) byCategory.set(p.category ?? "sin categoría", [...(byCategory.get(p.category ?? "sin categoría") ?? []), p.name]);
  if (products.length === 1) return { text: `${products[0]!.name} está en ${products[0]!.category ?? "ninguna categoría (sin asignar)"}.`, route };
  if (byCategory.size === 1) {
    const [name, names] = [...byCategory][0]!;
    return { text: `${names.length > MAX_LISTED ? `Los ${names.length}` : `Los ${names.length} (${names.join(", ")})`} están en ${name}.`, route };
  }
  return { text: `Depende del producto:\n${[...byCategory].map(([name, names]) => `• ${name}: ${listed(names)}`).join("\n")}`, route };
}

async function suppliersOf(products: Product[], source: InventoryDataSource): Promise<TopicReply> {
  const packOf = new Map(products.flatMap((p) => p.packs.map((k) => [k.id, p] as const)));
  // Las fuentes de precio (escandallos, estimados) no son nadie a quien se compre.
  const prices = forOrdering(await source.supplierPrices([...packOf.keys()]));
  const bySupplier = new Map<string, Set<string>>();
  const supplied = new Set<string>();
  for (const sp of prices) {
    const product = packOf.get(sp.packId);
    if (!product) continue;
    supplied.add(product.id);
    bySupplier.set(sp.supplierName, (bySupplier.get(sp.supplierName) ?? new Set()).add(product.name));
  }
  const without = products.filter((p) => !supplied.has(p.id)).map((p) => p.name);
  const route = "/proveedores" as const;
  if (bySupplier.size === 0) return { text: `Ninguno de estos productos tiene proveedor apuntado: ${listed(without)}. Se asigna en la ficha de cada producto.`, route };
  // Un solo proveedor y todos con él: una frase. Si no, uno por línea.
  if (bySupplier.size === 1 && without.length === 0) {
    const [name, names] = [...bySupplier][0]!;
    return { text: `Los trae ${name}: ${listed([...names])}.`, route };
  }
  const lines = [...bySupplier].sort((a, b) => b[1].size - a[1].size).map(([name, names]) => `• ${name}: ${listed([...names])}`);
  if (without.length > 0) lines.push(`• Sin proveedor apuntado: ${listed(without)}`);
  return { text: `${bySupplier.size === 1 ? "Solo uno tiene proveedor" : `Los traen ${bySupplier.size} proveedores`}:\n${lines.join("\n")}`, route };
}

/** Si lo dicho es exactamente el nombre de uno («coca cola» = Coca-Cola, no Coca-Cola Zero), solo ese. */
function exactOnly(products: Product[], words: string[]): Product[] {
  const core = (t: string) => tokenize(t).filter((w) => !/^\d/.test(w) && !["cl", "ml", "l", "kg", "g", "ud", "lt"].includes(w)).join("");
  const said = core(words.join(" "));
  const exact = products.filter((p) => core(p.name) === said);
  return exact.length > 0 ? exact : products;
}

/** Último precio de cada proveedor por unidad de medida (€/ud, €/l o €/kg), del más barato al más caro. */
async function cheapestSupplier(products: Product[], source: InventoryDataSource): Promise<TopicReply> {
  const route = "/proveedores" as const;
  const packOf = new Map(products.flatMap((p) => p.packs.map((k) => [k.id, { product: p, pack: k }] as const)));
  const prices = forOrdering(await source.supplierPrices([...packOf.keys()]));
  const lines: string[] = [];
  for (const product of products.slice(0, 3)) {
    const [factor, unit] = product.dimension === "volume" ? [1000, "l"] : product.dimension === "mass" ? [1000, "kg"] : [1, "ud"];
    // supplierPrices viene del más reciente al más antiguo: el primero de cada proveedor es su último precio.
    const best = new Map<string, { perUnit: Decimal; text: string }>();
    for (const sp of prices) {
      const found = packOf.get(sp.packId);
      if (!found || found.product.id !== product.id || best.has(sp.supplierName) || new Decimal(found.pack.qtyBase).lte(0)) continue;
      const perUnit = new Decimal(sp.lastPrice).div(found.pack.qtyBase).mul(factor);
      best.set(sp.supplierName, { perUnit, text: `${formatMoney(perUnit)}/${unit} (${found.pack.name} a ${formatMoney(sp.lastPrice)}${sp.lastPriceAt ? `, ${shortDay(sp.lastPriceAt)}` : ""})` });
    }
    const ranked = [...best].sort((a, b) => a[1].perUnit.cmp(b[1].perUnit));
    if (ranked.length === 0) lines.push(`${product.name}: ningún proveedor con precio apuntado.`);
    else if (ranked.length === 1) lines.push(`${product.name}: solo la trae ${ranked[0]![0]}, a ${ranked[0]![1].text}. No hay otro proveedor con que comparar.`);
    else lines.push(`${product.name}: el más barato es ${ranked[0]![0]}, a ${ranked[0]![1].text}. ${ranked.slice(1).map(([name, r]) => `${name}: ${r.text}`).join("; ")}.`);
  }
  if (products.length > 3) lines.push(`Y ${products.length - 3} productos más: pregúntame por uno concreto.`);
  return { text: lines.join("\n"), route };
}

const shortDay = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${Number(d)}/${Number(m)}/${y}`;
};

async function supplierCatalog(supplierName: string, ctx: SessionContext, source: InventoryDataSource): Promise<TopicReply> {
  const packOf = new Map(ctx.products.flatMap((p) => p.packs.map((k) => [k.id, p] as const)));
  // Las fuentes de precio (escandallos, estimados) no son nadie a quien se compre.
  const prices = forOrdering(await source.supplierPrices([...packOf.keys()]));
  const names = [...new Set(prices.filter((sp) => sp.supplierName === supplierName).map((sp) => packOf.get(sp.packId)?.name).filter((n): n is string => !!n))].sort((a, b) => a.localeCompare(b, "es"));
  const route = "/proveedores" as const;
  if (names.length === 0) return { text: `No hay ningún producto con ${supplierName} como proveedor. Se asigna en la ficha de cada producto.`, route };
  const shown = names.slice(0, 25);
  return { text: `${supplierName} nos trae ${names.length === 1 ? "1 producto" : `${names.length} productos`}: ${shown.join(", ")}${names.length > shown.length ? ` y ${names.length - shown.length} más` : ""}.`, route };
}
