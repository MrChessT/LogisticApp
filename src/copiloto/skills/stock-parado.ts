// «¿Cuánto stock tengo parado?»: lo que hay en cada local y no ha salido en el último mes (ni consumo, ni merma,
// ni traspaso), valorado a su coste medio. Es dinero inmovilizado: candidato a traspasar, ofertar o dejar de pedir.
import Decimal from "decimal.js";
import { formatMoney, formatStock } from "../entities/units";
import { addDays } from "../tools/periods";
import { locationName, MAX_ROWS, plural, type TareaInput, type TareaResult } from "./tarea-types";

/** Días sin ninguna salida para dar un producto por parado. */
const PARADO_DIAS = 30;
const OUTGOING = new Set(["consumption", "waste", "transfer_out"]);

export async function stockParado({ ctx, source, locationIds, now }: TareaInput): Promise<TareaResult> {
  const since = addDays(now.toISOString().slice(0, 10), -PARADO_DIAS);
  const [balances, movements] = await Promise.all([source.balances({ locationIds }), source.movements({ locationIds, since: `${since}T00:00:00Z` })]);
  const moved = new Set(movements.filter((m) => OUTGOING.has(m.type) && new Decimal(m.qty).lt(0)).map((m) => `${m.locationId}:${m.productId}`));
  const products = new Map(ctx.products.map((p) => [p.id, p]));
  const still = balances
    .filter((b) => new Decimal(b.qty).gt(0) && !moved.has(`${b.locationId}:${b.productId}`) && products.has(b.productId))
    .map((b) => ({ ...b, value: new Decimal(b.qty).mul(b.avgCost || 0) }))
    .sort((a, b) => b.value.cmp(a.value));
  const navigate = { route: "/stock" as const, filters: {}, auto: false };
  if (still.length === 0) {
    return { tarea: "catalogo", text: `No hay stock parado: todo lo que hay ha tenido alguna salida en los últimos ${PARADO_DIAS} días.`, table: null, followUps: [], navigate };
  }
  const total = still.reduce((s, b) => s.plus(b.value), new Decimal(0));
  const top = still.slice(0, 3).map((b) => `${products.get(b.productId)!.name} en ${locationName(ctx, b.locationId)} (${formatMoney(b.value)})`);
  const costs = ctx.seesCosts;
  return {
    tarea: "catalogo",
    text: costs
      ? `Stock parado (sin ninguna salida en ${PARADO_DIAS} días): ${formatMoney(total)} en ${plural(still.length, "producto", "productos")}${ctx.locations.length > 1 ? " (cada local aparte)" : ""}. Lo que más pesa: ${top.join(", ")}. Se puede traspasar a donde se gaste o dejar de pedirlo.`
      : `Hay ${plural(still.length, "producto", "productos")} sin ninguna salida en ${PARADO_DIAS} días. Se puede traspasar a donde se gaste o dejar de pedirlo.`,
    table: {
      columns: [{ key: "producto", label: "Producto" }, { key: "local", label: "Local" }, { key: "cantidad", label: "Cantidad", align: "right" }, ...(costs ? [{ key: "valor", label: "Valor", align: "right" as const }] : [])],
      rows: still.slice(0, MAX_ROWS).map((b) => ({ producto: products.get(b.productId)!.name, local: locationName(ctx, b.locationId), cantidad: formatStock(new Decimal(b.qty), products.get(b.productId)!), ...(costs ? { valor: formatMoney(b.value) } : {}) })),
      ...(still.length > MAX_ROWS ? { more: still.length - MAX_ROWS } : {}),
    },
    followUps: [],
    navigate,
  };
}
