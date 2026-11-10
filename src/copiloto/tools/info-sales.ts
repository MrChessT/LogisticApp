// Ventas del TPV para el asistente: cuánto se vendió en un periodo, qué factura más, el food cost de lo
// vendido, cuánto salió de un plato concreto y qué artículos faltan por enlazar a su escandallo o producto.
// Mismos datos que la pantalla Ventas (sales_report) y solo para dirección con «ve costes».
import Decimal from "decimal.js";
import type { TableEvent } from "../contract/index";
import type { SessionContext } from "../domain";
import { normalize, tokenize } from "../entities/normalize";
import { tokenSimilarity } from "../entities/retriever";
import { formatDecimal, formatMoney } from "../entities/units";
import { addDays, extractDates } from "./periods";

export interface SalesItemRaw {
  name: string;
  link: "receta" | "producto" | "ignorado" | "sin_enlazar";
  linkName: string | null;
  qty: string;
  amount: string;
  cost: string | null;
  foodCost: string | null;
}
export interface SalesDayRaw { date: string; locationId: string; total: string }

export interface SalesSource {
  /** Por artículo en el periodo (locationId null = todos los locales). */
  salesReport(orgId: string, from: string, to: string, locationId: string | null): Promise<SalesItemRaw[]>;
  salesDays(orgId: string, from: string, to: string): Promise<SalesDayRaw[]>;
  /** Último día con ventas importadas (de cualquier local), o null si no hay ninguno. */
  lastSaleDate(orgId: string): Promise<string | null>;
}

export interface SalesResult { text: string; table?: TableEvent; rows: number }

const MAX_ROWS = 10;
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const money = (v: Decimal.Value) => formatMoney(v);
const pct = (v: Decimal.Value) => `${formatDecimal(v, 1)} %`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayText = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}/${d.slice(0, 4)}`;
const qtyText = (v: Decimal.Value) => formatDecimal(v, new Decimal(v).isInteger() ? 0 : 2);

export type SalesPeriod = { from: string; to: string; label: string; explicit: boolean };

/** El periodo que pregunta el mensaje. Sin periodo: el mes en curso (y si no hay nada, el último día con ventas). */
export function salesPeriod(message: string, now: Date): SalesPeriod {
  const text = normalize(message);
  const today = iso(now);
  if (/\banteayer\b/.test(text)) { const d = addDays(today, -2); return { from: d, to: d, label: "anteayer", explicit: true }; }
  if (/\b(ayer|anoche)\b/.test(text)) { const d = addDays(today, -1); return { from: d, to: d, label: "ayer", explicit: true }; }
  if (/\bhoy\b/.test(text)) return { from: today, to: today, label: "hoy", explicit: true };
  const monday = addDays(today, -((now.getDay() + 6) % 7));
  if (/\bsemana (pasada|anterior)\b/.test(text)) return { from: addDays(monday, -7), to: addDays(monday, -1), label: "la semana pasada", explicit: true };
  if (/\b(esta semana|semana)\b/.test(text)) return { from: monday, to: today, label: "esta semana", explicit: true };
  if (/\bmes (pasado|anterior)\b/.test(text)) {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { from: iso(first), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)), label: MONTHS[first.getMonth()]!, explicit: true };
  }
  // Un día con su mes («el 30 de octubre», «del 1 al 15 de octubre») va antes que el mes entero.
  const yearOf = (month: number) => (month > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear());
  const monthAlt = MONTHS.join("|");
  const range = new RegExp(`\\bdel? (\\d{1,2}) al? (\\d{1,2}) de (${monthAlt})\\b`).exec(text);
  if (range) {
    const m = MONTHS.indexOf(range[3]!);
    const a = iso(new Date(yearOf(m), m, Number(range[1]))), b = iso(new Date(yearOf(m), m, Number(range[2])));
    return { from: a, to: b, label: `del ${dayText(a)} al ${dayText(b)}`, explicit: true };
  }
  const dayMonth = new RegExp(`\\b(\\d{1,2}) de (${monthAlt})\\b`).exec(text);
  if (dayMonth && Number(dayMonth[1]) >= 1 && Number(dayMonth[1]) <= 31) {
    const m = MONTHS.indexOf(dayMonth[2]!);
    const d = iso(new Date(yearOf(m), m, Number(dayMonth[1])));
    return { from: d, to: d, label: `el ${dayText(d)}`, explicit: true };
  }
  // «el jueves 30», «el día 30»: ese día de este mes, o del anterior si aún no ha llegado.
  const bareDay = /\b(?:dia|lunes|martes|miercoles|jueves|viernes|sabado|domingo) (\d{1,2})\b(?![/-])/.exec(text);
  if (bareDay && Number(bareDay[1]) >= 1 && Number(bareDay[1]) <= 31) {
    const n = Number(bareDay[1]);
    const d = iso(n <= now.getDate() ? new Date(now.getFullYear(), now.getMonth(), n) : new Date(now.getFullYear(), now.getMonth() - 1, n));
    return { from: d, to: d, label: `el ${dayText(d)}`, explicit: true };
  }
  const named = MONTHS.findIndex((m) => new RegExp(`\\b${m}\\b`).test(text));
  if (named >= 0) {
    // «octubre» en noviembre es el de este año; «diciembre» en enero, el del año pasado.
    const year = named > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear();
    return { from: iso(new Date(year, named, 1)), to: iso(new Date(year, named + 1, 0)), label: MONTHS[named]!, explicit: true };
  }
  const dates = extractDates(message, today);
  if (dates.length === 1) return { from: dates[0]!, to: dates[0]!, label: `el ${dayText(dates[0]!)}`, explicit: true };
  if (dates.length >= 2) return { from: dates[0]!, to: dates[dates.length - 1]!, label: `del ${dayText(dates[0]!)} al ${dayText(dates[dates.length - 1]!)}`, explicit: true };
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: today, label: MONTHS[now.getMonth()]!, explicit: false };
}

/** ¿El mensaje nombra este artículo (sus palabras con sentido, admitiendo erratas)? */
function mentions(message: string, name: string): boolean {
  const words = tokenize(message).filter((w) => w.length > 2);
  const wanted = tokenize(name).filter((w) => w.length > 3);
  if (wanted.length === 0) return false;
  const hits = wanted.filter((w) => words.some((m) => tokenSimilarity(m, w) >= 0.85));
  return hits.length === wanted.length || (hits.length >= 1 && hits.some((h) => h.length >= 5) && hits.length / wanted.length >= 0.5);
}

const SALES_WORDS = new Set(["venta", "ventas", "vendido", "vendidos", "vendida", "vendidas", "vendimos", "vendi", "vendio", "vendieron", "vendemos", "vende", "venden", "cuanto", "cuantos", "cuantas", "como", "food", "cost", "plato", "platos", "articulo", "articulos", "mas", "menos", "que", "del", "los", "las", "este", "esta", "mes", "semana", "ayer", "hoy", "facturacion", "caja", "tpv", "hemos", "han", "por", "con", "sin", "enlazar", "enlazados"]);

export async function sales(source: SalesSource, ctx: SessionContext, p: { message: string; locationIds: string[]; locationsChosen: boolean; now: Date }): Promise<SalesResult> {
  if (!ctx.seesCosts || ctx.role === "staff") {
    return { text: "Las ventas las ve la dirección (propiedad, administración y encargados) con el permiso «ve costes».", rows: 0 };
  }
  const text = normalize(p.message);
  const single = p.locationsChosen && p.locationIds.length === 1 ? p.locationIds[0]! : null;
  const where = single ? ` en ${ctx.locations.find((l) => l.id === single)?.name ?? "ese local"}` : "";
  let period = salesPeriod(p.message, p.now);
  let [items, days] = await Promise.all([source.salesReport(ctx.orgId, period.from, period.to, single), source.salesDays(ctx.orgId, period.from, period.to)]);
  days = days.filter((d) => !single || d.locationId === single);

  if (items.length === 0) {
    const last = await source.lastSaleDate(ctx.orgId);
    if (!last) return { text: "Aún no hay ventas importadas. Se suben en Ventas con la exportación diaria del TPV («Importar día del TPV»).", rows: 0 };
    if (period.explicit) return { text: `No hay ventas importadas de ${period.label}${where}. El último día importado es el ${dayText(last)}.`, rows: 0 };
    // Sin periodo pedido y nada este mes: el mes del último día con ventas.
    const d = new Date(`${last}T00:00:00`);
    period = { from: iso(new Date(d.getFullYear(), d.getMonth(), 1)), to: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)), label: MONTHS[d.getMonth()]!, explicit: false };
    [items, days] = await Promise.all([source.salesReport(ctx.orgId, period.from, period.to, single), source.salesDays(ctx.orgId, period.from, period.to)]);
    days = days.filter((x) => !single || x.locationId === single);
    if (items.length === 0) return { text: `No hay ventas importadas${where}. El último día importado es el ${dayText(last)}.`, rows: 0 };
  }

  const dec = (v: string | null) => new Decimal(v ?? 0);
  // El TPV exporta artículos, no tickets: sin número de tickets no hay ticket medio; se dice y se da lo que sí hay.
  const noTickets = /\b(ticket medio|tickets?|comensales|cubiertos|clientes)\b/.test(text) ? "El TPV exporta lo vendido por artículo, sin tickets ni comensales, así que no puedo darte el ticket medio. " : "";
  const total = items.reduce((s, i) => s.plus(i.amount), new Decimal(0));
  const costed = items.filter((i) => i.cost !== null);
  const cost = costed.reduce((s, i) => s.plus(dec(i.cost)), new Decimal(0));
  const costedAmount = costed.reduce((s, i) => s.plus(i.amount), new Decimal(0));
  const unlinked = items.filter((i) => i.link === "sin_enlazar");
  const nDays = new Set(days.map((d) => d.date)).size;
  const when = `${period.label === "hoy" || period.label === "ayer" || period.label === "anteayer" || period.label.startsWith("el ") || period.label.startsWith("del ") || period.label.includes("semana") ? period.label : `en ${period.label}`}${where}`;
  const fcRow = (i: SalesItemRaw) => (i.foodCost !== null ? pct(i.foodCost) : i.link === "sin_enlazar" ? "sin enlazar" : i.link === "ignorado" ? "—" : "falta precio");
  const tableOf = (rows: SalesItemRaw[], extra?: "fc"): TableEvent | undefined =>
    rows.length < 2 ? undefined : {
      columns: [
        { key: "articulo", label: "Artículo" },
        { key: "vendido", label: "Vendido", align: "right" },
        { key: "importe", label: "Importe", align: "right" },
        { key: extra === "fc" ? "coste" : "foodcost", label: extra === "fc" ? "Coste" : "Food cost", align: "right" },
        ...(extra === "fc" ? [{ key: "foodcost", label: "Food cost", align: "right" as const }] : []),
      ],
      rows: rows.slice(0, MAX_ROWS).map((i) => ({ articulo: i.name, vendido: qtyText(i.qty), importe: money(i.amount), coste: i.cost !== null ? money(i.cost) : "—", foodcost: fcRow(i) })),
      ...(rows.length > MAX_ROWS ? { more: rows.length - MAX_ROWS } : {}),
    };

  // Lo que falta enlazar.
  if (/\b(sin enlazar|enlazar|no enlazad|sin coste|sin escandallo)\b/.test(text)) {
    if (unlinked.length === 0) return { text: `Todo lo vendido ${when} está enlazado a su plato o producto.`, rows: 0 };
    const amount = unlinked.reduce((s, i) => s.plus(i.amount), new Decimal(0));
    return {
      text: `${plural(unlinked.length, "artículo vendido no está enlazado", "artículos vendidos no están enlazados")} ${when} (${money(amount)} sin coste). Enlázalos una vez en Ventas: pulsa el artículo y elige su plato o producto.`,
      table: tableOf([...unlinked].sort((a, b) => dec(b.amount).cmp(dec(a.amount)))),
      rows: unlinked.length,
    };
  }

  // Un artículo concreto («¿cuántos lenguados vendimos?»).
  const meaningful = tokenize(p.message).filter((w) => w.length > 2 && !SALES_WORDS.has(normalize(w)) && !MONTHS.includes(normalize(w)));
  const named = meaningful.length ? items.filter((i) => mentions(meaningful.join(" "), i.name) || (i.linkName ? mentions(meaningful.join(" "), i.linkName) : false)) : [];
  if (named.length >= 1 && named.length <= 3) {
    const lines = named.map((i) => {
      const fc = i.foodCost !== null ? `, coste teórico ${money(dec(i.cost))} (food cost ${pct(i.foodCost)})` : i.link === "sin_enlazar" ? " (sin enlazar: no tiene coste)" : "";
      return `${i.name}: ${qtyText(i.qty)} vendidos por ${money(i.amount)}${fc}`;
    });
    return { text: `${when[0]!.toUpperCase()}${when.slice(1)}, ${lines.join("; ")}.`, table: tableOf(named, "fc"), rows: named.length };
  }

  // Food cost más alto (lo que menos margen deja).
  if (/\b(food ?cost|margen|rentab|coste)\b/.test(text) && /\b(mas alto|mayor|peor|peores|alto|altos|menos margen|menos rentab|mas caro de hacer)\b/.test(text)) {
    const ranked = costed.filter((i) => i.foodCost !== null).sort((a, b) => dec(b.foodCost).cmp(dec(a.foodCost)));
    if (ranked.length === 0) return { text: `Lo vendido ${when} aún no tiene coste: enlaza los artículos a su escandallo o producto en Ventas.`, rows: 0 };
    const top = ranked[0]!;
    return {
      text: `${when[0]!.toUpperCase()}${when.slice(1)}, el food cost más alto es ${top.name}: ${pct(top.foodCost!)} (${money(dec(top.cost))} de coste por ${money(top.amount)} vendidos).`,
      table: tableOf(ranked, "fc"),
      rows: ranked.length,
    };
  }

  // Lo más vendido (por unidades si lo pide así; si no, por importe).
  const byUnits = /\b(unidades|cuantos|cuantas|mas veces)\b/.test(text);
  const ranked = [...items].filter((i) => i.link !== "ignorado" || dec(i.amount).gt(0)).sort((a, b) => (byUnits ? dec(b.qty).cmp(dec(a.qty)) : dec(b.amount).cmp(dec(a.amount))));
  if (/\b(mas vendid|lo que mas|que mas|vende mas|venden mas|top|ranking|estrella|mejores?)\b/.test(text)) {
    const top = ranked.slice(0, 3).map((i) => `${i.name} (${byUnits ? `${qtyText(i.qty)} uds` : money(i.amount)})`);
    return { text: `Lo más vendido ${when}${byUnits ? " por unidades" : ""}: ${top.join(", ")}.`, table: tableOf(ranked), rows: ranked.length };
  }

  // Resumen.
  const fc = costedAmount.gt(0) ? cost.div(costedAmount).mul(100) : null;
  const covered = total.gt(0) ? costedAmount.div(total).mul(100) : new Decimal(0);
  const parts = [`${when[0]!.toUpperCase()}${when.slice(1)} se vendieron ${money(total)} sin IVA${nDays > 1 ? ` en ${nDays} días` : ""}.`];
  if (fc) parts.push(`Coste teórico ${money(cost)}: food cost ${pct(fc)} y margen bruto ${money(costedAmount.minus(cost))}${covered.lt(99.5) ? `, sobre el ${formatDecimal(covered, 0)} % de la venta que tiene coste` : ""}.`);
  else parts.push("Aún no hay coste: enlaza los artículos a su escandallo o producto en Ventas.");
  if (unlinked.length) parts.push(`Faltan por enlazar ${plural(unlinked.length, "artículo", "artículos")} (${money(unlinked.reduce((s, i) => s.plus(i.amount), new Decimal(0)))}).`);
  return { text: noTickets + parts.join(" "), table: tableOf(ranked), rows: ranked.length };
}

/** Venta y coste teórico de un periodo, para el resumen «¿cómo voy?» (null si no hay ventas). */
export async function salesTotals(source: SalesSource, orgId: string, from: string, to: string, locationId: string | null): Promise<{ amount: Decimal; cost: Decimal; costedAmount: Decimal } | null> {
  const items = await source.salesReport(orgId, from, to, locationId);
  if (items.length === 0) return null;
  const amount = items.reduce((s, i) => s.plus(i.amount), new Decimal(0));
  const costed = items.filter((i) => i.cost !== null);
  return { amount, cost: costed.reduce((s, i) => s.plus(i.cost!), new Decimal(0)), costedAmount: costed.reduce((s, i) => s.plus(i.amount), new Decimal(0)) };
}
