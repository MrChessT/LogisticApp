// «¿Cuándo pedimos coca por última vez?», «¿cuándo llegó el Barceló?», «hace cuánto que no compramos
// limones?»: el último pedido a proveedor que lo llevaba y la última vez que entró por una recepción.
// Antes no había forma de saberlo sin abrir Pedidos y Recepciones. Solo lectura, sin Jev.
import type { Product, SessionContext } from "../domain";
import { normalize, tokenize } from "../entities/normalize";
import type { Retriever } from "../entities/retriever";
import { formatStock } from "../entities/units";
import type { InventoryDataSource, OrderRaw } from "../tools/types";
import { productsNamed } from "./product-facts";
import { namedLocations } from "./routing";
import type { TopicReply } from "./topics";

const ASKS =
  /\b(ultima vez|ultimo pedido|ultima compra|ultima recepcion|ultima entrega|cuando (se )?(pidio|pidieron|pedimos|pedi|compramos|compre|compraron|llego|llegaron|recibimos|trajeron|entro|entraron)|hace cuanto (tiempo )?(que )?(no )?(pedimos|compramos|llega|llego|nos traen|recibimos))\b/;

/** Palabras de la pregunta, no del producto. */
const NOT_PRODUCT = new Set(
  "cuando cuanto hace tiempo que no se la el los las lo de del en al a por ultima ultimo vez pedido pedimos pedi pidio pidieron compra compramos compre compraron recepcion entrega llego llegaron llega recibimos trajeron traen nos entro entraron fue dime sabes".split(" "),
);

/** Un año atrás: lo de antes no ayuda a decidir un pedido. */
const LOOKBACK_DAYS = 365;

export async function lastTime(message: string, ctx: SessionContext, retriever: Retriever, source: InventoryDataSource, now: Date): Promise<TopicReply | null> {
  const text = normalize(message).replace(/[¿?¡!.,]/g, " ").replace(/\s+/g, " ").trim();
  if (!ASKS.test(text)) return null;
  const locationWords = new Set(ctx.locations.flatMap((l) => tokenize(l.name)));
  const words = tokenize(message).filter((w) => !NOT_PRODUCT.has(w) && !locationWords.has(w));
  const products = await productsNamed(words.join(" "), ctx, retriever);
  if (products.length === 0) return null;

  const named = namedLocations(ctx.locations, message);
  const locationIds = (named.length > 0 ? named : ctx.locations).map((l) => l.id);
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const ids = new Set(products.map((p) => p.id));
  const [movements, orders] = await Promise.all([
    source.movements({ locationIds, productIds: [...ids], since }),
    source.orders({ locationIds, statuses: ["sent", "partial", "received"] }),
  ]);
  const names = new Map(ctx.locations.map((l) => [l.id, l.name]));
  // «18/09»; de otro año, con el año.
  const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}${iso.slice(0, 4) === now.toISOString().slice(0, 4) ? "" : `/${iso.slice(0, 4)}`}`;

  const lastOrder = new Map<string, OrderRaw>();
  for (const o of orders) {
    const at = o.sentAt ?? o.createdAt;
    for (const l of o.lines) {
      if (!ids.has(l.productId)) continue;
      const prev = lastOrder.get(l.productId);
      if (!prev || (prev.sentAt ?? prev.createdAt) < at) lastOrder.set(l.productId, o);
    }
  }
  const lastArrival = new Map<string, (typeof movements)[number]>();
  for (const m of movements) {
    if (m.type !== "purchase") continue;
    const prev = lastArrival.get(m.productId);
    if (!prev || prev.occurredAt < m.occurredAt) lastArrival.set(m.productId, m);
  }

  const orderText = (p: Product) => {
    const o = lastOrder.get(p.id);
    return o ? `${day(o.sentAt ?? o.createdAt)} a ${o.supplierName} (${names.get(o.locationId) ?? "local"})` : "—";
  };
  const arrivalText = (p: Product) => {
    const m = lastArrival.get(p.id);
    return m ? `${day(m.occurredAt)}: ${formatStock(m.qty, p)} en ${names.get(m.locationId) ?? "local"}` : "—";
  };
  const where = named.length > 0 ? ` en ${named.map((l) => l.name).join(" y ")}` : "";
  const route = "/pedidos" as const;

  if (products.length === 1) {
    const p = products[0]!;
    if (!lastOrder.has(p.id) && !lastArrival.has(p.id)) return { text: `No consta ningún pedido ni ninguna entrada de ${p.name}${where} en el último año.`, route };
    const parts = [
      lastOrder.has(p.id) ? `el último pedido fue el ${orderText(p)}` : "no consta ningún pedido enviado",
      lastArrival.has(p.id) ? `llegó por última vez el ${arrivalText(p)}` : "no ha llegado nada en el último año",
    ];
    return { text: `${p.name}${where}: ${parts.join("; ")}.`, route };
  }
  const lines = products.map((p) => `• ${p.name}: pedido ${orderText(p)} · llegada ${arrivalText(p)}`);
  return { text: `Último pedido y última llegada${where}:\n${lines.join("\n")}`, route };
}
