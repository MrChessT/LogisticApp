// Analítica para /informes y para las gráficas del chat. Todo cálculo con decimal.js; cada punto sale
// con su valor exacto (cadena decimal) y su texto ya formateado. La UI solo dibuja.
import Decimal from "decimal.js";
import type { AnalyticsResponse, AnalyticsView, ChartFormat, ChartPoint, ChartSeries, ChartSpec, Kpi } from "../contract/index";
import type { SessionContext } from "../domain";
import { formatDecimal, formatMoney } from "../entities/units";
import { businessDay } from "../../lib/business-day";
import { EXIT_KIND_LABEL, EXIT_KINDS, isLoss } from "../../lib/exit-kinds";
import { addDays } from "../tools/periods";
import { computeReorder, type ToolName } from "../tools/tools";
import type { InventoryDataSource, MovementRaw, ToolParams } from "../tools/types";

/** Máximo de series por gráfica: más allá, la paleta deja de distinguirse (se agrupa o se omite). */
const MAX_SERIES = 4;
const TOP_N = 8;

const VIEW_TITLES: Record<AnalyticsView, string> = {
  resumen: "Resumen",
  cuentas: "Cuentas de la mercancía",
  consumo: "Consumo",
  mermas: "Mermas",
  stock: "Stock",
  precios: "Precios",
  reposicion: "Reposición",
  desvios: "Desvíos de inventario",
};

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function dayLabel(day: string): string {
  const [, m, d] = day.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
}

/** «16–22 sep» (o «29 sep–5 oct» si cambia de mes). */
function weekLabel(from: string, to: string): string {
  const [a, b] = [dayLabel(from), dayLabel(to)];
  return a.split(" ")[1] === b.split(" ")[1] ? `${a.split(" ")[0]}–${b}` : `${a}–${b}`;
}

function display(value: Decimal, format: ChartFormat): string {
  switch (format) {
    case "money":
      return formatMoney(value);
    case "days":
      return `${formatDecimal(value, 1)} días`;
    case "percent":
      return `${formatDecimal(value, 1)} %`;
    case "number":
      return formatDecimal(value, 2);
  }
}

function point(x: string, label: string, value: Decimal, format: ChartFormat): ChartPoint {
  const rounded = format === "money" ? value.toDecimalPlaces(2) : value.toDecimalPlaces(2);
  return { x, label, value: rounded.toString(), display: display(rounded, format) };
}

function sinceIso(day: string): string {
  return `${addDays(day, -1)}T00:00:00Z`;
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Salidas que consumen stock (consumo, merma y ajustes negativos). Los traspasos no cuentan. */
function isUsage(m: MovementRaw): boolean {
  const qty = new Decimal(m.qty);
  return m.type === "consumption" || m.type === "waste" || ((m.type === "count_adjustment" || m.type === "manual_adjustment") && qty.lt(0));
}

/** Merma que es pérdida (rotura, caducidad…); las invitaciones o el consumo del personal no lo son. */
function isLossExit(m: MovementRaw): boolean {
  return m.type === "waste" && isLoss(m.exitKind);
}

/** Salida que no es pérdida: invitación, consumo del personal, degustación o evento. */
function isOtherExit(m: MovementRaw): boolean {
  return m.type === "waste" && !isLoss(m.exitKind);
}

function movementValue(m: MovementRaw): Decimal {
  return new Decimal(m.qty).abs().mul(m.unitCost ?? 0);
}

export interface AnalyticsQuery {
  ctx: SessionContext;
  locationIds: string[];
  productIds: string[];
  days: number;
  now: Date;
}

interface Window {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  label: string;
}

export class Analytics {
  constructor(private readonly source: InventoryDataSource) {}

  private window(q: AnalyticsQuery): Window {
    const location = q.ctx.locations.find((l) => l.id === q.locationIds[0]);
    const to = businessDay(q.now, location?.timezone ?? "Europe/Madrid", location?.dayCutoff ?? "06:00");
    const from = addDays(to, -(q.days - 1));
    return { from, to, prevFrom: addDays(from, -q.days), prevTo: addDays(from, -1), label: `últimos ${q.days} días` };
  }

  private dayOf(q: AnalyticsQuery, m: MovementRaw): string {
    const location = q.ctx.locations.find((l) => l.id === m.locationId);
    return businessDay(new Date(m.occurredAt), location?.timezone ?? "Europe/Madrid", location?.dayCutoff ?? "06:00");
  }

  private async movements(q: AnalyticsQuery, since: string): Promise<MovementRaw[]> {
    return this.source.movements({ locationIds: q.locationIds, since: sinceIso(since), ...(q.productIds.length > 0 ? { productIds: q.productIds } : {}) });
  }

  private locationName(q: AnalyticsQuery, id: string): string {
    return q.ctx.locations.find((l) => l.id === id)?.name ?? "Local";
  }

  // Gráficas ----------------------------------------------------------------------

  /** Evolución diaria del valor consumido (o solo mermas), una línea por local (máximo 4) o el total. */
  async dailyUsage(q: AnalyticsQuery, onlyWaste = false, movements?: MovementRaw[], options: { weekly?: boolean } = {}): Promise<ChartSpec> {
    const w = this.window(q);
    const list = (movements ?? (await this.movements(q, w.from))).filter((m) => (onlyWaste ? isLossExit(m) : isUsage(m)));
    // El día en curso está incompleto: la serie diaria termina ayer (mismo número de días).
    const lastFull = addDays(w.to, -1);
    const firstDay = addDays(w.from, -1);
    const days = daysBetween(firstDay, lastFull);
    const byLocation = q.locationIds.length > 1 && q.locationIds.length <= MAX_SERIES;
    const groups = byLocation ? q.locationIds : ["total"];
    const totals = new Map<string, Decimal>();
    for (const m of list) {
      const day = this.dayOf(q, m);
      if (day < firstDay || day > lastFull) continue;
      const key = `${byLocation ? m.locationId : "total"}|${day}`;
      totals.set(key, (totals.get(key) ?? new Decimal(0)).plus(movementValue(m)));
    }
    // En el chat (panel estrecho), varios locales día a día son un enredo de líneas: por semanas completas
    // (las 4 últimas, acabando ayer) se lee de un vistazo. La pantalla de Informes sigue por días.
    const weekly = options.weekly === true && byLocation && days.length >= 14;
    const weeks = weekly ? Array.from({ length: Math.floor(days.length / 7) }, (_, i) => days.slice(days.length - 7 * (i + 1), days.length - 7 * i)).reverse() : [];
    const name = (g: string) => (g === "total" ? (q.locationIds.length === 1 ? this.locationName(q, q.locationIds[0]!) : "Todos los locales") : this.locationName(q, g));
    const series: ChartSeries[] = groups.map((g) => ({
      key: g,
      name: name(g),
      points: weekly
        ? weeks.map((wk) => point(wk[0]!, weekLabel(wk[0]!, wk.at(-1)!), wk.reduce((sum, d) => sum.plus(totals.get(`${g}|${d}`) ?? 0), new Decimal(0)), "money"))
        : days.map((d) => point(d, dayLabel(d), totals.get(`${g}|${d}`) ?? new Decimal(0), "money")),
    }));
    return {
      id: onlyWaste ? "mermas-diarias" : "consumo-diario",
      kind: "line",
      title: onlyWaste ? (weekly ? "Mermas por semana" : "Mermas por día") : weekly ? "Consumo por semana" : "Consumo por día",
      subtitle: weekly
        ? `Valor a coste medio de las ${weeks.length} últimas semanas completas, por local`
        : `Valor a coste medio por día completo, ${w.label} hasta ayer${byLocation ? ", por local" : ""}`,
      format: "money",
      series,
      ...(list.length === 0 ? { empty: "No hay movimientos en este periodo." } : {}),
    };
  }

  /** Ranking de productos por valor consumido o mermado en el periodo. */
  async topProducts(q: AnalyticsQuery, onlyWaste: boolean, movements?: MovementRaw[]): Promise<ChartSpec> {
    const w = this.window(q);
    const list = (movements ?? (await this.movements(q, w.from))).filter((m) => (onlyWaste ? isLossExit(m) : isUsage(m)));
    const totals = new Map<string, Decimal>();
    for (const m of list) {
      const day = this.dayOf(q, m);
      if (day < w.from || day > w.to) continue;
      totals.set(m.productId, (totals.get(m.productId) ?? new Decimal(0)).plus(movementValue(m)));
    }
    const names = new Map(q.ctx.products.map((p) => [p.id, p.name]));
    const points = [...totals.entries()]
      .filter(([, v]) => v.gt(0))
      .sort((a, b) => b[1].cmp(a[1]))
      .slice(0, TOP_N)
      .map(([id, v]) => point(id, names.get(id) ?? "Producto", v, "money"));
    return {
      id: onlyWaste ? "mermas-producto" : "consumo-producto",
      kind: "bar",
      title: onlyWaste ? "Productos con más merma" : "Productos con más consumo",
      subtitle: `Valor a coste medio, ${w.label}`,
      format: "money",
      series: [{ key: "valor", name: "Valor", points }],
      ...(points.length === 0 ? { empty: "Sin datos en este periodo." } : {}),
    };
  }

  /** Salidas que no son venta, por tipo: separa las pérdidas de las invitaciones y del consumo interno. */
  async exitsByKind(q: AnalyticsQuery, movements?: MovementRaw[]): Promise<ChartSpec> {
    const w = this.window(q);
    const list = (movements ?? (await this.movements(q, w.from))).filter((m) => m.type === "waste");
    const totals = new Map(EXIT_KINDS.map((k) => [k, new Decimal(0)]));
    for (const m of list) {
      const day = this.dayOf(q, m);
      if (day < w.from || day > w.to) continue;
      const kind = m.exitKind ?? "merma";
      totals.set(kind, totals.get(kind)!.plus(movementValue(m)));
    }
    const points = EXIT_KINDS.filter((k) => k === "merma" || totals.get(k)!.gt(0)).map((k) => point(k, EXIT_KIND_LABEL[k], totals.get(k)!, "money"));
    const any = points.some((p) => !new Decimal(p.value).isZero());
    return {
      id: "salidas-tipo",
      kind: "bar",
      title: "Salidas por tipo",
      subtitle: `Pérdidas frente a invitaciones y consumo interno, valor a coste medio, ${w.label}`,
      format: "money",
      series: [{ key: "valor", name: "Valor", points }],
      ...(any ? {} : { empty: "No hay salidas en este periodo." }),
    };
  }

  async stockByLocation(q: AnalyticsQuery): Promise<ChartSpec> {
    const balances = await this.source.balances({ locationIds: q.locationIds, ...(q.productIds.length > 0 ? { productIds: q.productIds } : {}) });
    const totals = new Map<string, Decimal>(q.locationIds.map((id) => [id, new Decimal(0)]));
    for (const b of balances) totals.set(b.locationId, (totals.get(b.locationId) ?? new Decimal(0)).plus(new Decimal(b.qty).mul(b.avgCost)));
    const points = [...totals.entries()].map(([id, v]) => point(id, this.locationName(q, id), v, "money"));
    return { id: "stock-local", kind: "column", title: "Valor del stock por local", subtitle: "Valoración actual a coste medio", format: "money", series: [{ key: "valor", name: "Valor", points }] };
  }

  async topStockProducts(q: AnalyticsQuery): Promise<ChartSpec> {
    const balances = await this.source.balances({ locationIds: q.locationIds, ...(q.productIds.length > 0 ? { productIds: q.productIds } : {}) });
    const totals = new Map<string, Decimal>();
    for (const b of balances) totals.set(b.productId, (totals.get(b.productId) ?? new Decimal(0)).plus(new Decimal(b.qty).mul(b.avgCost)));
    const names = new Map(q.ctx.products.map((p) => [p.id, p.name]));
    const points = [...totals.entries()]
      .sort((a, b) => b[1].cmp(a[1]))
      .slice(0, TOP_N)
      .map(([id, v]) => point(id, names.get(id) ?? "Producto", v, "money"));
    return { id: "stock-producto", kind: "bar", title: "Productos con más valor en stock", subtitle: "Valoración actual a coste medio", format: "money", series: [{ key: "valor", name: "Valor", points }] };
  }

  /** Variación del último precio frente al anterior, por formato: ± alrededor de 0. */
  async priceChanges(q: AnalyticsQuery): Promise<ChartSpec> {
    const w = this.window(q);
    const packs = this.packIndex(q);
    const raw = await this.source.prices(q.productIds.length > 0 ? [...packs.keys()] : null, sinceIso(addDays(w.from, -90)));
    const series = new Map<string, typeof raw>();
    for (const p of raw) series.set(`${p.supplierId}|${p.packId}`, [...(series.get(`${p.supplierId}|${p.packId}`) ?? []), p]);
    const changes: Array<{ key: string; label: string; pct: Decimal }> = [];
    for (const [key, list] of series) {
      list.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
      const latest = list.at(-1)!;
      if (latest.recordedAt.slice(0, 10) < w.from) continue;
      const previous = [...list].reverse().find((p) => p.recordedAt < latest.recordedAt && !new Decimal(p.price).eq(latest.price));
      const pack = packs.get(latest.packId);
      if (!previous || !pack) continue;
      const old = new Decimal(previous.price);
      if (old.isZero()) continue;
      changes.push({ key, label: `${pack.product} (${pack.pack})`, pct: new Decimal(latest.price).minus(old).div(old).mul(100) });
    }
    const points = changes
      .sort((a, b) => b.pct.abs().cmp(a.pct.abs()))
      .slice(0, TOP_N)
      .map((c) => point(c.key, c.label, c.pct, "percent"));
    return {
      id: "variacion-precios",
      kind: "diverging",
      title: "Variación de precios de compra",
      subtitle: `Último precio frente al anterior, cambios en los ${w.label}`,
      format: "percent",
      series: [{ key: "variacion", name: "Variación", points }],
      ...(points.length === 0 ? { empty: "Sin cambios de precio en este periodo." } : {}),
    };
  }

  /** Evolución del precio de compra de los formatos con más cambio (máximo 4 líneas). */
  async priceHistory(q: AnalyticsQuery): Promise<ChartSpec> {
    const w = this.window(q);
    const packs = this.packIndex(q);
    const raw = await this.source.prices(q.productIds.length > 0 ? [...packs.keys()] : null, sinceIso(addDays(w.from, -90)));
    const byPack = new Map<string, typeof raw>();
    for (const p of raw) if (packs.has(p.packId)) byPack.set(p.packId, [...(byPack.get(p.packId) ?? []), p]);
    const ranked = [...byPack.entries()]
      .map(([packId, list]) => {
        const prices = list.map((p) => new Decimal(p.price));
        return { packId, list: list.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt)), spread: Decimal.max(...prices).minus(Decimal.min(...prices)) };
      })
      .filter((r) => r.list.length > 1)
      .sort((a, b) => b.spread.cmp(a.spread))
      .slice(0, MAX_SERIES);
    const series: ChartSeries[] = ranked.map((r) => {
      const pack = packs.get(r.packId)!;
      return {
        key: r.packId,
        name: `${pack.product} (${pack.pack})`,
        points: r.list.map((p) => point(p.recordedAt.slice(0, 10), dayLabel(p.recordedAt.slice(0, 10)), new Decimal(p.price), "money")),
      };
    });
    return {
      id: "historial-precios",
      kind: "line",
      title: "Evolución del precio de compra",
      subtitle: "Precio por formato en cada albarán",
      format: "money",
      series,
      ...(series.length === 0 ? { empty: "Todavía no hay varios precios que comparar." } : {}),
    };
  }

  /** Días de cobertura de los productos en riesgo, con el horizonte como referencia. */
  async coverage(q: AnalyticsQuery, horizonDays = 3): Promise<ChartSpec> {
    const params: ToolParams = { locationIds: q.locationIds, areaId: null, productIds: q.productIds, period: null, horizonDays, horizonLabel: `${horizonDays} días`, now: q.now };
    const lines = (await computeReorder(this.source, params, q.ctx)).filter((l) => l.coverage !== null).slice(0, TOP_N);
    const multi = q.locationIds.length > 1;
    const points = lines.map((l) =>
      point(`${l.lp.locationId}|${l.product.id}`, multi ? `${l.product.name} · ${this.locationName(q, l.lp.locationId)}` : l.product.name, l.coverage!, "days"),
    );
    return {
      id: "cobertura",
      kind: "bar",
      title: "Días de cobertura",
      subtitle: "Stock actual entre consumo medio diario (últimas 4 semanas)",
      format: "days",
      series: [{ key: "cobertura", name: "Cobertura", points }],
      reference: { value: String(horizonDays), label: `Horizonte: ${horizonDays} días` },
      ...(points.length === 0 ? { empty: "Ningún producto en riesgo de rotura." } : {}),
    };
  }

  /** Desvíos de los inventarios cerrados en el periodo, en valor: ± alrededor de 0. */
  async variance(q: AnalyticsQuery): Promise<ChartSpec> {
    const w = this.window(q);
    const raw = await this.source.countResults({ locationIds: q.locationIds, since: sinceIso(w.from), ...(q.productIds.length > 0 ? { productIds: q.productIds } : {}) });
    const names = new Map(q.ctx.products.map((p) => [p.id, p.name]));
    const points = raw
      .map((r) => ({ r, value: new Decimal(r.countedQty).minus(r.expectedQty).mul(r.unitCost) }))
      .filter((x) => !x.value.isZero())
      .sort((a, b) => b.value.abs().cmp(a.value.abs()))
      .slice(0, TOP_N)
      .map((x) => point(`${x.r.countId}|${x.r.productId}`, names.get(x.r.productId) ?? "Producto", x.value, "money"));
    return {
      id: "desvios",
      kind: "diverging",
      title: "Desvíos de inventario",
      subtitle: `Contado menos teórico, en valor, ${w.label}`,
      format: "money",
      series: [{ key: "desvio", name: "Desvío", points }],
      ...(points.length === 0 ? { empty: "Sin desvíos en este periodo." } : {}),
    };
  }

  private packIndex(q: AnalyticsQuery): Map<string, { product: string; pack: string }> {
    const index = new Map<string, { product: string; pack: string }>();
    for (const p of q.ctx.products) {
      if (q.productIds.length > 0 && !q.productIds.includes(p.id)) continue;
      for (const k of p.packs) index.set(k.id, { product: p.name, pack: k.name });
    }
    return index;
  }

  // KPIs --------------------------------------------------------------------------

  private async kpis(q: AnalyticsQuery, movements: MovementRaw[], which: Array<"stock" | "consumo" | "mermas" | "otras_salidas" | "bajo_minimo">): Promise<Kpi[]> {
    const w = this.window(q);
    const sum = (from: string, to: string, filter: (m: MovementRaw) => boolean) =>
      movements.reduce((acc, m) => {
        const day = this.dayOf(q, m);
        return day >= from && day <= to && filter(m) ? acc.plus(movementValue(m)) : acc;
      }, new Decimal(0));
    const delta = (current: Decimal, previous: Decimal, upIsGood: boolean): Kpi["delta"] => {
      if (previous.isZero()) return undefined;
      const change = current.minus(previous).div(previous).mul(100);
      const direction = change.abs().lt("0.5") ? "flat" : change.gt(0) ? "up" : "down";
      return { display: `${change.gt(0) ? "+" : ""}${formatDecimal(change, 1)} % vs. ${q.days} días anteriores`, direction, good: direction === "flat" || (direction === "up") === upIsGood };
    };
    const out: Kpi[] = [];
    if (which.includes("stock")) {
      const balances = await this.source.balances({ locationIds: q.locationIds });
      const total = balances.reduce((acc, b) => acc.plus(new Decimal(b.qty).mul(b.avgCost)), new Decimal(0));
      out.push({ id: "valor_stock", label: "Valor del stock", value: formatMoney(total), hint: "A coste medio" });
    }
    const usage = sum(w.from, w.to, isUsage);
    if (which.includes("consumo")) {
      const d = delta(usage, sum(w.prevFrom, w.prevTo, isUsage), true);
      out.push({ id: "consumo", label: "Consumo", value: formatMoney(usage), hint: w.label, ...(d ? { delta: d } : {}) });
    }
    if (which.includes("mermas")) {
      const waste = sum(w.from, w.to, isLossExit);
      const share = usage.isZero() ? null : waste.div(usage).mul(100);
      const d = delta(waste, sum(w.prevFrom, w.prevTo, isLossExit), false);
      out.push({ id: "mermas", label: "Mermas", value: formatMoney(waste), hint: share ? `${formatDecimal(share, 1)} % del consumo` : w.label, ...(d ? { delta: d } : {}) });
    }
    if (which.includes("otras_salidas")) {
      const other = sum(w.from, w.to, isOtherExit);
      const d = delta(other, sum(w.prevFrom, w.prevTo, isOtherExit), false);
      out.push({ id: "otras_salidas", label: "Invitaciones y personal", value: formatMoney(other), hint: "Salidas que no son pérdida", ...(d ? { delta: d } : {}) });
    }
    if (which.includes("bajo_minimo")) {
      const [lps, balances] = await Promise.all([this.source.locationProducts({ locationIds: q.locationIds }), this.source.balances({ locationIds: q.locationIds })]);
      const stock = new Map(balances.map((b) => [`${b.locationId}:${b.productId}`, new Decimal(b.qty)]));
      const below = lps.filter((lp) => new Decimal(lp.minQty).gt(0) && (stock.get(`${lp.locationId}:${lp.productId}`) ?? new Decimal(0)).lt(lp.minQty)).length;
      out.push({ id: "bajo_minimo", label: "Bajo mínimo", value: String(below), hint: below === 1 ? "producto" : "productos" });
    }
    return out;
  }

  // Vistas ------------------------------------------------------------------------

  async view(view: AnalyticsView, q: AnalyticsQuery): Promise<Omit<AnalyticsResponse, "locations">> {
    const w = this.window(q);
    const needsMovements = view === "resumen" || view === "cuentas" || view === "consumo" || view === "mermas";
    // Los movimientos (la lectura más pesada) se piden a la vez que el resto, no antes.
    const movementsReady: Promise<MovementRaw[]> = needsMovements ? this.movements(q, w.prevFrom) : Promise.resolve([]);
    const withMovements = <T>(fn: (movements: MovementRaw[]) => Promise<T>) => movementsReady.then(fn);
    let kpis: Kpi[] = [];
    let charts: ChartSpec[] = [];
    switch (view) {
      case "resumen":
        [kpis, ...charts] = await Promise.all([
          withMovements((m) => this.kpis(q, m, ["stock", "consumo", "mermas", "bajo_minimo"])),
          withMovements((m) => this.dailyUsage(q, false, m)),
          this.stockByLocation(q),
          withMovements((m) => this.topProducts(q, true, m)),
        ]) as [Kpi[], ...ChartSpec[]];
        break;
      case "cuentas":
        [kpis, ...charts] = await Promise.all([
          withMovements((m) => this.accountKpis(q, m)),
          this.spendBySupplier(q),
          withMovements((m) => this.topProducts(q, false, m)),
        ]) as [Kpi[], ...ChartSpec[]];
        break;
      case "consumo":
        [kpis, ...charts] = await Promise.all([
          withMovements((m) => this.kpis(q, m, ["consumo", "mermas"])),
          withMovements((m) => this.dailyUsage(q, false, m)),
          withMovements((m) => this.topProducts(q, false, m)),
        ]) as [Kpi[], ...ChartSpec[]];
        break;
      case "mermas":
        [kpis, ...charts] = await Promise.all([
          withMovements((m) => this.kpis(q, m, ["mermas", "otras_salidas", "consumo"])),
          withMovements((m) => this.dailyUsage(q, true, m)),
          withMovements((m) => this.topProducts(q, true, m)),
          withMovements((m) => this.exitsByKind(q, m)),
        ]) as [Kpi[], ...ChartSpec[]];
        break;
      case "stock":
        [kpis, ...charts] = await Promise.all([this.kpis(q, [], ["stock", "bajo_minimo"]), this.stockByLocation(q), this.topStockProducts(q)]) as [Kpi[], ...ChartSpec[]];
        break;
      case "precios":
        charts = await Promise.all([this.priceChanges(q), this.priceHistory(q)]);
        break;
      case "reposicion":
        [kpis, ...charts] = await Promise.all([this.kpis(q, [], ["bajo_minimo"]), this.coverage(q)]) as [Kpi[], ...ChartSpec[]];
        break;
      case "desvios":
        charts = [await this.variance(q)];
        break;
    }
    return {
      view,
      title: VIEW_TITLES[view],
      periodLabel: w.label,
      locationName: q.locationIds.length === 1 ? this.locationName(q, q.locationIds[0]!) : null,
      kpis,
      charts,
      generatedAt: q.now.toISOString(),
    };
  }

  /**
   * Cuentas de la mercancía: lo comprado frente a lo que salió. Todo lo que sale (consumo, mermas, invitaciones y
   * personal) está en la misma ventana, así que lo que no cuadra es la variación de stock: compras − salidas.
   */
  private async accountKpis(q: AnalyticsQuery, movements: MovementRaw[]): Promise<Kpi[]> {
    const w = this.window(q);
    const sumOf = (filter: (m: MovementRaw) => boolean) =>
      movements.reduce((acc, m) => {
        const day = this.dayOf(q, m);
        return day >= w.from && day <= w.to && filter(m) ? acc.plus(movementValue(m)) : acc;
      }, new Decimal(0));
    const purchases = await this.source.purchases({ locationIds: q.locationIds, since: w.from });
    const bought = purchases.filter((p) => p.docDate <= w.to).reduce((acc, p) => acc.plus(p.total), new Decimal(0));
    // isUsage incluye todas las mermas; las invitaciones y la pérdida se separan para no contarlas dos veces.
    const usage = sumOf(isUsage);
    const loss = sumOf(isLossExit);
    const other = sumOf(isOtherExit);
    const consumed = usage.minus(loss).minus(other);
    // El consumo puede superar a lo comprado: se gasta stock de periodos anteriores. Por eso la merma se mide
    // sobre lo consumido y no sobre lo comprado.
    const share = (part: Decimal, base: Decimal) => (base.isZero() ? "Sin salidas en el periodo" : `${formatDecimal(part.div(base).mul(100), 1)} % de las salidas`);
    const variation = bought.minus(usage);
    return [
      { id: "compras", label: "Compras", value: formatMoney(bought), hint: w.label },
      { id: "consumo_productivo", label: "Consumo", value: formatMoney(consumed), hint: "Lo que se ha gastado en cocina y barra" },
      { id: "mermas_perdida", label: "Pérdidas", value: formatMoney(loss), hint: share(loss, usage) },
      { id: "invitaciones_personal", label: "Invitaciones y personal", value: formatMoney(other), hint: "Salidas que no son pérdida" },
      {
        id: "variacion_stock",
        label: "Variación de stock",
        value: `${variation.gt(0) ? "+" : ""}${formatMoney(variation)}`,
        hint: variation.gt(0) ? "Se ha comprado más de lo que ha salido: el stock sube" : variation.lt(0) ? "Ha salido más de lo que se ha comprado: el stock baja" : "Cuadra: lo comprado es lo que ha salido",
      },
    ];
  }

  /** Gasto en compras (recepciones) por proveedor en la ventana de la consulta. */
  async spendBySupplier(q: AnalyticsQuery): Promise<ChartSpec> {
    const w = this.window(q);
    const raw = (await this.source.purchases({ locationIds: q.locationIds, since: w.from })).filter((p) => p.docDate <= w.to);
    const totals = new Map<string, Decimal>();
    for (const p of raw) {
      const name = p.supplierName ?? "Sin proveedor";
      totals.set(name, (totals.get(name) ?? new Decimal(0)).plus(p.total));
    }
    const points = [...totals.entries()]
      .sort((a, b) => b[1].cmp(a[1]))
      .slice(0, TOP_N)
      .map(([name, v]) => point(name, name, v, "money"));
    return {
      id: "compras-proveedor",
      kind: "bar",
      title: "Compras por proveedor",
      subtitle: `Recepciones, ${w.label}`,
      format: "money",
      series: [{ key: "importe", name: "Importe", points }],
      ...(points.length === 0 ? { empty: "Sin compras en este periodo." } : {}),
    };
  }

  /** Gráfica que acompaña a una respuesta del chat (null si no aporta: sin datos o una sola barra). */
  async chartForTool(tool: ToolName, q: AnalyticsQuery, horizonDays: number): Promise<ChartSpec | null> {
    let chart: ChartSpec | null;
    switch (tool) {
      case "query_stock":
        chart = q.productIds.length === 1 && q.locationIds.length > 1 ? await this.stockByLocation(q) : await this.topStockProducts(q);
        break;
      case "query_movements":
      case "query_top_usage":
        chart = await this.dailyUsage(q, false, undefined, { weekly: true });
        break;
      case "query_prices":
        chart = q.productIds.length > 0 ? await this.priceHistory(q) : await this.priceChanges(q);
        break;
      case "query_reorder":
        chart = await this.coverage(q, horizonDays);
        break;
      case "query_count_variance":
        chart = await this.variance(q);
        break;
      case "query_spend":
        chart = await this.spendBySupplier(q);
        break;
      case "query_product": {
        // Ficha: cómo ha ido el precio; con un solo precio, el consumo diario; sin consumo, el stock por local.
        const prices = await this.priceHistory(q);
        const pricePoints = prices.series.reduce((n, s) => n + s.points.length, 0);
        chart = !prices.empty && pricePoints >= 2 ? prices : await this.dailyUsage(q);
        if (!chart || chart.empty || chart.series.every((s) => s.points.length < 2)) chart = q.locationIds.length > 1 ? await this.stockByLocation(q) : null;
        break;
      }
      case "query_pending_transfers":
      case "query_orders":
        chart = null;
        break;
    }
    if (!chart || chart.empty) return null;
    const points = chart.series.reduce((n, s) => n + s.points.length, 0);
    // Todo a cero (sin consumo registrado) no dice nada que el texto no diga ya.
    if (chart.series.every((s) => s.points.every((p) => Number(p.value) === 0))) return null;
    // Una sola barra no es una gráfica (la cifra ya está en el texto).
    return points >= 2 ? chart : null;
  }
}

export const VIEW_FOR_TOOL: Record<ToolName, AnalyticsView> = {
  query_stock: "stock",
  query_movements: "consumo",
  query_prices: "precios",
  query_pending_transfers: "resumen",
  query_count_variance: "desvios",
  query_reorder: "reposicion",
  query_orders: "reposicion",
  query_spend: "resumen",
  query_product: "stock",
  query_top_usage: "consumo",
};
