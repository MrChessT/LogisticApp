// Datos fijos de la ficha que no necesitan a Jev ni elegir un producto: «¿qué categoría tiene el
// pacharán?». Antes preguntaba «¿De cuál de estos productos?» aunque la respuesta sirviera para todos:
// ahora contesta de todos los que encajan (o de la familia entera, si se nombra una).
import type { SessionContext } from "../domain";
import { familyOf } from "../entities/family";
import { normalize } from "../entities/normalize";
import type { Retriever } from "../entities/retriever";
import type { TopicReply } from "./topics";

const ASK_CATEGORY = /^(?:(?:dime |sabes )?(?:de |a |en )?(?:que|cual(?: es(?: la)?)?) (?:categoria|familia|seccion|tipo)(?: de producto)?(?: tiene| es| son| pertenece(?:n)?(?: a)?| esta(?:n)?(?: en)?| lleva(?:n)?)?|(?:la )?(?:categoria|familia) (?:de|del))\s+(?:el |la |los |las |al |del |de )?(.+)$/;

/** Como mucho se nombran estos productos; si hay más, se resume por categoría. */
const MAX_LISTED = 8;

export async function productFact(message: string, ctx: SessionContext, retriever: Retriever): Promise<TopicReply | null> {
  const text = normalize(message).replace(/[¿?¡!.,]/g, " ").replace(/\s+/g, " ").trim();
  const asked = ASK_CATEGORY.exec(text)?.[1]?.trim();
  if (!asked) return null;

  const family = familyOf(asked, ctx.products, { exact: true });
  let products = family?.products ?? [];
  if (products.length === 0) {
    const found = await retriever.retrieve(ctx.products, asked, MAX_LISTED + 1, ctx.catalogHash);
    const best = found[0];
    // Mismo listón que la vía rápida: el nombre tiene que explicar lo pedido; si no, decide Jev.
    if (!best || best.score < 0.8) return null;
    products = found.filter((c) => c.score >= best.score * 0.75).map((c) => c.product);
  }
  if (products.length === 0) return null;

  const byCategory = new Map<string, string[]>();
  for (const p of products) {
    const category = p.category ?? "sin categoría";
    byCategory.set(category, [...(byCategory.get(category) ?? []), p.name]);
  }
  const route = "/productos" as const;
  if (products.length === 1) return { text: `${products[0]!.name} está en ${products[0]!.category ?? "ninguna categoría (sin asignar)"}.`, route };
  if (byCategory.size === 1) {
    const [category, names] = [...byCategory][0]!;
    return { text: `${names.length > MAX_LISTED ? `Los ${names.length}` : `Los ${names.length} (${names.join(", ")})`} están en ${category}.`, route };
  }
  const lines = [...byCategory].map(([category, names]) => `• ${category}: ${names.length > MAX_LISTED ? `${names.length} productos` : names.join(", ")}`);
  return { text: `Depende del producto:\n${lines.join("\n")}`, route };
}
