// Datos de la ficha que no necesitan a Jev ni elegir un producto. Antes preguntaba «¿De cuál de estos
// productos?» aunque la respuesta sirviera para todos; ahora contesta de todos los que encajan (o de la
// familia entera, si se nombra una):
// · «¿qué categoría tiene el pacharán?»;
// · «¿quién nos trae los vermuts?», «proveedores de la ginebra» (con varios productos; con uno solo
//   sigue la ficha de siempre, que da además el precio y el stock);
// · «¿qué nos trae Makro?»: lo que se le compra a un proveedor.
import type { Product, SessionContext } from "../domain";
import { mentionedSupplier } from "../entities/catalog-parser";
import { familyOf } from "../entities/family";
import { normalize, tokenize } from "../entities/normalize";
import type { Retriever } from "../entities/retriever";
import type { InventoryDataSource } from "../tools/types";
import type { TopicReply } from "./topics";

const ASK_CATEGORY = /^(?:(?:dime |sabes )?(?:de |a |en )?(?:que|cual(?: es(?: la)?)?) (?:categoria|familia|seccion|tipo)(?: de producto)?(?: tiene| es| son| pertenece(?:n)?(?: a)?| esta(?:n)?(?: en)?| lleva(?:n)?)?|(?:la )?(?:categoria|familia) (?:de|del))\s+(?:el |la |los |las |al |del |de )?(.+)$/;
const ASK_SUPPLIER = /\b(proveedor(es)?|quien(es)? (nos |me )?(trae|traen|sirve|sirven|vende|venden|suministra|suministran)|a quien (le )?(compramos|pedimos|compro|pido)|donde (compramos|pedimos|compro|pido))\b/;
const ASK_SUPPLIER_CATALOG = /\b(que|cuales?|lo que)\b.*\b(nos |me )?(trae|traen|vende|venden|sirve|sirven|compramos|pedimos|compro|pido)\b/;
/** Ordenes, no preguntas: «cambia el proveedor de…», «pon a Makro como proveedor». */
const ACTION = /\b(cambia|cambiar|pon|poner|asigna|asignar|anade|anadir|quita|quitar|crea|crear|da de alta)\b/;
const NOT_PRODUCT = new Set("que quien quienes cual cuales es son el la los las lo de del al a nos me le trae traen sirve sirven vende venden suministra suministran compramos pedimos compro pido donde proveedor proveedores dime sabes".split(" "));

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

/**
 * Los precios estimados se guardan como si fueran de un proveedor «Precio de referencia (estimado)»: no
 * es nadie a quien se compre, así que no cuenta como proveedor.
 */
const isReferencePrice = (supplierName: string) => /precio de referencia|\(estimado\)/i.test(supplierName);

const listed = (names: string[]) => (names.length > MAX_LISTED ? `${names.length} productos` : names.join(", "));

export async function productFact(message: string, ctx: SessionContext, retriever: Retriever, source: InventoryDataSource): Promise<TopicReply | null> {
  const text = normalize(message).replace(/[¿?¡!.,]/g, " ").replace(/\s+/g, " ").trim();
  if (ACTION.test(text)) return null;
  const category = ASK_CATEGORY.exec(text)?.[1]?.trim();
  if (category) return categoryOf(await productsNamed(category, ctx, retriever, MAX_LISTED + 1));
  const supplier = mentionedSupplier(message, ctx.suppliers);
  if (supplier && ASK_SUPPLIER_CATALOG.test(text) && !ASK_SUPPLIER.test(text)) return supplierCatalog(supplier.name, ctx, source);
  if (ASK_SUPPLIER.test(text) && !supplier) {
    const words = tokenize(message).filter((w) => !NOT_PRODUCT.has(w));
    const products = await productsNamed(words.join(" "), ctx, retriever);
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
  const prices = (await source.supplierPrices([...packOf.keys()])).filter((sp) => !isReferencePrice(sp.supplierName));
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

async function supplierCatalog(supplierName: string, ctx: SessionContext, source: InventoryDataSource): Promise<TopicReply> {
  const packOf = new Map(ctx.products.flatMap((p) => p.packs.map((k) => [k.id, p] as const)));
  const prices = (await source.supplierPrices([...packOf.keys()])).filter((sp) => !isReferencePrice(sp.supplierName));
  const names = [...new Set(prices.filter((sp) => sp.supplierName === supplierName).map((sp) => packOf.get(sp.packId)?.name).filter((n): n is string => !!n))].sort((a, b) => a.localeCompare(b, "es"));
  const route = "/proveedores" as const;
  if (names.length === 0) return { text: `No hay ningún producto con ${supplierName} como proveedor. Se asigna en la ficha de cada producto.`, route };
  const shown = names.slice(0, 25);
  return { text: `${supplierName} nos trae ${names.length === 1 ? "1 producto" : `${names.length} productos`}: ${shown.join(", ")}${names.length > shown.length ? ` y ${names.length - shown.length} más` : ""}.`, route };
}
