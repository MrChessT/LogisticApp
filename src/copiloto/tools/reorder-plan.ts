// Decisión de reposición: lo que el encargado decide cada mañana, calculado de una vez.
//
//   1. Traspasar antes que comprar: si otro local puede ceder sin quedarse corto, se mueve en vez de pedir.
//   2. Pedir a cada proveedor lo que cubre hasta que llegue SU pedido siguiente (días de pedido, hora límite y
//      plazo de su ficha), no una semana fija. Sin condiciones apuntadas, una semana, y se dice.
//   3. Lo del proveedor que hoy no admite pedidos espera a su día; no entra en el pedido de hoy.
//   4. Excepción: lo que se queda a cero antes de que pueda llegar el próximo pedido. Eso solo lo arregla un
//      traspaso (o una compra fuera de ruta), y va lo primero.
//
// Todo con decimal.js y sin modelo de lenguaje: la tarea `pedidos`, el borrador de pedido y `equilibrar` usan esta
// misma decisión, para que el chat diga lo mismo por cualquier camino.
import Decimal from "decimal.js";
import { minOrderShortfall, orderCycle, type OrderCycle } from "../../lib/supplier-terms";
import type { Pack, Product, SessionContext } from "../domain";
import { forOrdering } from "./orderable";
import { addDays } from "./periods";
import { computeReorder } from "./tools";
import type { InventoryDataSource, SupplierPriceRaw, SupplierTermsRaw } from "./types";

type ReorderLine = Awaited<ReturnType<typeof computeReorder>>[number];

/** Horizonte con el que se buscan candidatos: el ciclo más largo razonable (pedido semanal con plazo). */
const CANDIDATE_DAYS = 14;
/** Sin condiciones en la ficha del proveedor: una semana, como hasta ahora. */
const DEFAULT_COVER_DAYS = 7;
const WINDOW_DAYS = 28;

export interface PlannedTransfer {
  product: Product;
  fromLocationId: string;
  toLocationId: string;
  qty: Decimal;
  /** Lo que se ahorra en compra, a coste medio del local que cede. */
  value: Decimal;
  /** Lo que tiene ahora el local que recibe, para explicar el porqué. */
  stockAtTarget: Decimal;
  minAtTarget: Decimal;
  free: Decimal;
}

interface PlannedLine {
  line: ReorderLine;
  pack: Pack;
  packs: Decimal;
  price: string | null;
  /** Se queda a cero antes de que llegue el próximo pedido de su proveedor. */
  breaks: boolean;
}

export interface SupplierBatch {
  locationId: string;
  supplierId: string;
  supplierName: string;
  /** null: el proveedor no tiene condiciones apuntadas (se pide cuando se quiera y se cubre una semana). */
  cycle: OrderCycle | null;
  coverDays: number;
  lines: PlannedLine[];
  total: Decimal;
  minOrder: string | null;
  minShortfall: Decimal | null;
}

interface UrgentLine {
  locationId: string;
  product: Product;
  /** Días que aguanta con lo que hay y lo que ya llega. */
  days: Decimal;
  /** Qué lo arregla: un traspaso propuesto, nada en ruta (llamar o comprar fuera) o no hay a quién pedirlo. */
  fix: "traspaso" | "ninguno" | "sin_proveedor";
  /** Cuándo llega el próximo pedido de su proveedor (null: sin plazo en su ficha). */
  arrives: string | null;
}

export interface ReplenishmentPlan {
  transfers: PlannedTransfer[];
  /** Pedidos que se pueden hacer hoy. */
  today: SupplierBatch[];
  /** Pedidos cuyo proveedor hoy no admite pedidos: esperan a su día. */
  later: SupplierBatch[];
  noSupplier: Array<{ locationId: string; product: Product }>;
  noPack: Array<{ locationId: string; product: Product }>;
  urgent: UrgentLine[];
  /** Proveedores elegidos sin condiciones en su ficha (se ha usado una semana). */
  missingTerms: string[];
}

export interface PlanInput {
  ctx: SessionContext;
  source: InventoryDataSource;
  locationIds: string[];
  now: Date;
  productIds?: string[];
}

const purchasePack = (p: Product): Pack | null => p.packs.find((k) => k.isPurchaseDefault) ?? (p.packs.length === 1 ? p.packs[0]! : null);
/** Unidad en que se cuenta (botella, barril, kg…): no se traspasa media botella. */
const countUnit = (p: Product): Decimal => (p.dimension === "count" ? new Decimal(1) : new Decimal(p.packs.find((k) => k.isCountDefault)?.qtyBase ?? 1));

/** Lo que hace falta para aguantar `days` días sin bajar del mínimo, o para llegar al objetivo. */
function needFor(line: Pick<ReorderLine, "avg" | "min" | "par" | "available">, days: number): Decimal {
  return Decimal.max(0, line.avg.mul(days).plus(line.min).minus(line.available), line.par.minus(line.available));
}

/**
 * Lo que cada local puede ceder sin quedarse corto: por encima de su objetivo, de su mínimo más una semana de
 * consumo y, si no tiene niveles, de una semana de consumo. Es la regla de siempre de «equilibrar».
 */
async function surplusOf(ctx: SessionContext, source: InventoryDataSource, now: Date) {
  const all = ctx.locations.map((l) => l.id);
  const since = `${addDays(now.toISOString().slice(0, 10), -WINDOW_DAYS)}T00:00:00Z`;
  const [balances, lps, movements] = await Promise.all([
    source.balances({ locationIds: all }),
    source.locationProducts({ locationIds: all }),
    source.movements({ locationIds: all, since }),
  ]);
  const key = (l: string, p: string) => `${l}:${p}`;
  const stock = new Map(balances.map((b) => [key(b.locationId, b.productId), { qty: new Decimal(b.qty), cost: new Decimal(b.avgCost || 0) }]));
  const levels = new Map(lps.map((lp) => [key(lp.locationId, lp.productId), { min: new Decimal(lp.minQty), par: new Decimal(lp.parQty) }]));
  const perDay = new Map<string, Decimal>();
  for (const m of movements) {
    const q = new Decimal(m.qty);
    if (m.type === "consumption" || m.type === "waste" || ((m.type === "count_adjustment" || m.type === "manual_adjustment") && q.lt(0))) {
      const k = key(m.locationId, m.productId);
      perDay.set(k, (perDay.get(k) ?? new Decimal(0)).plus(q.abs().div(WINDOW_DAYS)));
    }
  }
  return {
    free(locationId: string, productId: string): Decimal {
      const s = stock.get(key(locationId, productId));
      if (!s) return new Decimal(0);
      const lv = levels.get(key(locationId, productId)) ?? { min: new Decimal(0), par: new Decimal(0) };
      const week = (perDay.get(key(locationId, productId)) ?? new Decimal(0)).mul(7);
      return Decimal.max(0, s.qty.minus(Decimal.max(lv.par, lv.min.plus(week), week)));
    },
    cost: (locationId: string, productId: string) => stock.get(key(locationId, productId))?.cost ?? new Decimal(0),
  };
}

/** El proveedor de cada formato: el del último precio entre los que sirven al local (sin locales marcados, a todos). */
function supplierFor(packId: string, locationId: string, prices: SupplierPriceRaw[], terms: Map<string, SupplierTermsRaw>) {
  const serves = (supplierId: string) => {
    const ids = terms.get(supplierId)?.locationIds;
    return !ids || ids.includes(locationId);
  };
  return prices.find((p) => p.packId === packId && serves(p.supplierId)) ?? prices.find((p) => p.packId === packId) ?? null;
}

const hasTerms = (t: SupplierTermsRaw | undefined): t is SupplierTermsRaw => !!t && (t.orderDays !== null || t.leadTimeHours !== null || t.orderCutoff !== null);

export async function planReplenishment({ ctx, source, locationIds, now, productIds = [] }: PlanInput): Promise<ReplenishmentPlan> {
  const plan: ReplenishmentPlan = { transfers: [], today: [], later: [], noSupplier: [], noPack: [], urgent: [], missingTerms: [] };
  const needs = await computeReorder(source, { locationIds, areaId: null, productIds, period: null, horizonDays: CANDIDATE_DAYS, horizonLabel: "", now }, ctx);
  if (needs.length === 0) return plan;

  const packIds = [...new Set(needs.map((l) => purchasePack(l.product)?.id).filter((x): x is string => !!x))];
  const prices = forOrdering(await source.supplierPrices(packIds));
  const terms = new Map((await source.supplierTerms([...new Set(prices.map((p) => p.supplierId))])).map((t) => [t.supplierId, t]));
  const surplus = ctx.locations.length > 1 ? await surplusOf(ctx, source, now) : null;
  const given = new Map<string, Decimal>();
  const batches = new Map<string, SupplierBatch>();
  const missing = new Set<string>();
  const tzOf = (locationId: string) => ctx.locations.find((l) => l.id === locationId)?.timezone ?? "Europe/Madrid";

  // computeReorder las da de menos a más cobertura: lo más urgente coge primero el stock que sobra en otro local.
  for (const line of needs) {
    const locationId = line.lp.locationId;
    const pack = purchasePack(line.product);
    const price = pack ? supplierFor(pack.id, locationId, prices, terms) : null;
    const t = price ? terms.get(price.supplierId) : undefined;
    const cycle = hasTerms(t) ? orderCycle(t, now, tzOf(locationId)) : null;
    if (price && !cycle) missing.add(price.supplierName);
    const coverDays = cycle?.coverDays ?? DEFAULT_COVER_DAYS;
    let need = needFor(line, coverDays);
    if (need.lte(0)) continue;

    // Se queda a cero antes de que pueda llegar lo que se pida (sin condiciones: mañana como pronto). Lo que no se
    // gasta no se acaba: sin consumo no es urgente aunque esté a cero (en producción eran cientos de falsas alarmas).
    const daysToDelivery = cycle?.daysToDelivery ?? 1;
    const breaks = line.avg.gt(0) && line.available.div(line.avg).lt(daysToDelivery);

    let moved = new Decimal(0);
    if (surplus) {
      const unit = countUnit(line.product);
      const donor = ctx.locations
        .filter((l) => l.id !== locationId)
        .map((l) => ({ id: l.id, free: surplus.free(l.id, line.product.id).minus(given.get(`${l.id}:${line.product.id}`) ?? 0) }))
        .filter((d) => d.free.gte(unit))
        .sort((a, b) => b.free.cmp(a.free))[0];
      if (donor) {
        moved = Decimal.min(need, donor.free).div(unit).floor().mul(unit);
        if (moved.gt(0)) {
          given.set(`${donor.id}:${line.product.id}`, (given.get(`${donor.id}:${line.product.id}`) ?? new Decimal(0)).plus(moved));
          plan.transfers.push({
            product: line.product,
            fromLocationId: donor.id,
            toLocationId: locationId,
            qty: moved,
            value: moved.mul(surplus.cost(donor.id, line.product.id)),
            stockAtTarget: line.qty,
            minAtTarget: line.min,
            free: donor.free,
          });
          need = need.minus(moved);
        }
      }
    }
    if (breaks) {
      plan.urgent.push({
        locationId,
        product: line.product,
        days: line.available.div(line.avg),
        fix: moved.gt(0) ? "traspaso" : price ? "ninguno" : "sin_proveedor",
        arrives: cycle?.next.deliveryDate ?? null,
      });
    }
    if (need.lte(0)) continue;
    if (!pack) {
      plan.noPack.push({ locationId, product: line.product });
      continue;
    }
    if (!price) {
      plan.noSupplier.push({ locationId, product: line.product });
      continue;
    }
    const key = `${locationId}:${price.supplierId}`;
    const batch = batches.get(key) ?? {
      locationId,
      supplierId: price.supplierId,
      supplierName: price.supplierName,
      cycle,
      coverDays,
      lines: [],
      total: new Decimal(0),
      minOrder: t?.minOrder ?? null,
      minShortfall: null,
    };
    const packs = need.div(pack.qtyBase).ceil();
    batch.lines.push({ line, pack, packs, price: price.lastPrice, breaks });
    batch.total = batch.total.plus(packs.mul(price.lastPrice));
    batches.set(key, batch);
  }

  for (const b of batches.values()) {
    b.minShortfall = minOrderShortfall(b.total, b.minOrder);
    (b.cycle && !b.cycle.next.orderToday ? plan.later : plan.today).push(b);
  }
  plan.missingTerms = [...missing].sort((a, b) => a.localeCompare(b, "es"));
  return plan;
}
