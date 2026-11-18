// ¿Ha subido algo de precio en el archivo leído? Cada línea que es un producto del catálogo (uno solo) se compara con
// nuestro último precio de compra, por unidad base (kg, l o ud). La factura puede dar el precio por kilo y nosotros
// tenerlo por caja: se prueba la unidad que dice la línea y, si no dice ninguna, la que deja el precio más cerca del
// nuestro (por unidad, por kilo o litro, o por formato de compra). Si ninguna encaja (más del triple o menos de un
// tercio), la línea no se compara: mejor no decir nada que inventar una subida.
import Decimal from "decimal.js";
import type { ChatDocument } from "../contract/index";
import type { Product, SessionContext } from "../domain";
import { normalize } from "../entities/normalize";
import type { Retriever } from "../entities/retriever";
import { formatMoney } from "../entities/units";
import type { InventoryDataSource } from "../tools/types";
import { productsNamed } from "./product-facts";

type Line = ChatDocument["lines"][number];

const FACTOR: Record<string, number> = { kg: 1000, kgs: 1000, kilo: 1000, kilos: 1000, g: 1, gr: 1, l: 1000, lt: 1000, litro: 1000, litros: 1000, cl: 10, ml: 1, ud: 1, uds: 1, u: 1, un: 1, und: 1, unidad: 1, unidades: 1 };
/** Cuánto se compara: más de un 2 % arriba o abajo. */
const THRESHOLD = new Decimal("0.02");

/** Precio de la línea por unidad base del producto (g, ml o ud), o null si no se puede saber con confianza. */
export function lineBasePrice(line: Line, product: Product, ourBase: Decimal): Decimal | null {
  const price = line.price ? new Decimal(line.price) : new Decimal(line.qty).gt(0) ? new Decimal(line.amount).div(line.qty) : null;
  if (!price || !price.gt(0)) return null;
  const unit = line.unit ? normalize(line.unit).replace(/[^a-z]/g, "") : "";
  const said = FACTOR[unit];
  const candidates: Decimal[] = said
    ? [price.div(said)]
    : [
        price, // por unidad base (g, ml o ud)
        ...(product.dimension !== "count" ? [price.div(1000)] : []), // por kilo o litro
        ...product.packs.map((p) => price.div(p.qtyBase)), // por formato (caja, botella, saco…)
      ];
  const best = candidates.map((c) => ({ c, d: Math.abs(Math.log(c.div(ourBase).toNumber())) })).sort((a, b) => a.d - b.d)[0];
  return best && best.d <= Math.log(3) ? best.c : null;
}

/** «1,25 €/kg» desde un precio por gramo; «0,80 €/ud». */
function perUnit(base: Decimal, product: Product): string {
  return product.dimension === "count" ? `${formatMoney(base)}/ud` : `${formatMoney(base.mul(1000))}/${product.dimension === "mass" ? "kg" : "l"}`;
}

export interface PriceChange { line: Line; product: Product; now: Decimal; before: Decimal; change: Decimal; supplier: string; at: string | null }

/** Lo que cambia de precio en esas líneas frente a nuestro último precio de compra (y cuántas no se pudieron comparar). */
export async function priceChanges(lines: Line[], ctx: SessionContext, retriever: Retriever, source: InventoryDataSource): Promise<{ changes: PriceChange[]; compared: number; skipped: number }> {
  const changes: PriceChange[] = [];
  let compared = 0;
  for (const line of lines.slice(0, 60)) {
    const products = await productsNamed(line.description, ctx, retriever, 2).catch(() => []);
    if (products.length !== 1) continue;
    const product = products[0]!;
    const prices = await source.supplierPrices(product.packs.map((p) => p.id)).catch(() => []);
    const last = prices.sort((a, b) => (b.lastPriceAt ?? "").localeCompare(a.lastPriceAt ?? ""))[0];
    const pack = last && product.packs.find((p) => p.id === last.packId);
    if (!last || !pack || !new Decimal(pack.qtyBase).gt(0)) continue;
    const before = new Decimal(last.lastPrice).div(pack.qtyBase);
    if (!before.gt(0)) continue;
    const now = lineBasePrice(line, product, before);
    if (!now) continue;
    compared += 1;
    const change = now.div(before).minus(1);
    if (change.abs().gte(THRESHOLD)) changes.push({ line, product, now, before, change, supplier: last.supplierName, at: last.lastPriceAt });
  }
  return { changes: changes.sort((a, b) => b.change.minus(a.change).toNumber()), compared, skipped: Math.min(lines.length, 60) - compared };
}

/** La respuesta: lo que sube, lo que baja y cuántas líneas no se pudieron comparar. */
export function priceChangesText(what: string, r: { changes: PriceChange[]; compared: number; skipped: number }): string {
  const pct = (c: Decimal) => `${c.gt(0) ? "+" : ""}${c.mul(100).toFixed(1).replace(".", ",")} %`;
  const row = (c: PriceChange) => `${c.product.name}: ${perUnit(c.now, c.product)}, antes ${perUnit(c.before, c.product)} (${pct(c.change)}, ${c.supplier})`;
  const up = r.changes.filter((c) => c.change.gt(0));
  const down = r.changes.filter((c) => c.change.lt(0));
  if (r.compared === 0) return `No he podido comparar ninguna línea de ${what} con nuestros precios de compra (no reconozco sus productos en el catálogo o no tienen precio todavía).`;
  const parts = [
    up.length ? `Más caro en ${what}: ${up.map(row).join("; ")}.` : `En ${what} no hay nada más caro que nuestro último precio de compra.`,
    ...(down.length ? [`Más barato: ${down.map(row).join("; ")}.`] : []),
    `He comparado ${r.compared} ${r.compared === 1 ? "línea" : "líneas"}${r.skipped > 0 ? `; ${r.skipped} no (producto sin reconocer o sin precio nuestro)` : ""}.`,
    ...(up.length ? ["Si es el precio nuevo, se actualiza solo al registrar la recepción o la factura; si no, reclámalo al proveedor."] : []),
  ];
  return parts.join(" ");
}
