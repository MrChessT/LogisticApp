// Condiciones de pedido de un proveedor (especificación A, hoja Proveedores) y el cálculo que las usa:
// cuándo se puede pedir, cuándo llegaría y si el pedido llega al mínimo. Lo usan /proveedores, /pedidos y Jev.
import Decimal from "decimal.js";

export interface SupplierTerms {
  /** Días en que admite pedidos (ISO: 1 lunes … 7 domingo). null: cualquier día. */
  orderDays: number[] | null;
  /** Hora límite «HH:MM» (o «HH:MM:SS») del local. null: sin hora límite. */
  orderCutoff: string | null;
  /** Horas entre el pedido y la entrega. null: no se sabe. */
  leadTimeHours: number | null;
  /** Pedido mínimo en euros (cadena decimal). null: sin mínimo. */
  minOrder: string | null;
}

export interface DeliveryPlan {
  /** Día en que hay que hacer el pedido (YYYY-MM-DD, hora del local). */
  orderDate: string;
  /** El pedido aún entra hoy. */
  orderToday: boolean;
  /** Día en que llegaría (YYYY-MM-DD). null si no se conoce el plazo. */
  deliveryDate: string | null;
}

export const WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"] as const;
const SHORT = ["L", "M", "X", "J", "V", "S", "D"] as const;

const formatters = new Map<string, Intl.DateTimeFormat>();
function localParts(now: Date, timeZone: string): { date: string; minutes: number } {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatters.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 1 lunes … 7 domingo. */
function isoWeekday(day: string): number {
  const wd = new Date(`${day}T00:00:00Z`).getUTCDay();
  return wd === 0 ? 7 : wd;
}

function minutesOf(time: string): number {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Próximo día en que se puede pedir y cuándo llegaría. */
export function nextDelivery(terms: Pick<SupplierTerms, "orderDays" | "orderCutoff" | "leadTimeHours">, now: Date, timeZone = "Europe/Madrid"): DeliveryPlan {
  const { date: today, minutes } = localParts(now, timeZone);
  const days = terms.orderDays?.length ? terms.orderDays : null;
  const lateToday = terms.orderCutoff !== null && minutes >= minutesOf(terms.orderCutoff);
  let orderDate = today;
  for (let offset = 0; offset <= 7; offset += 1) {
    const d = addDays(today, offset);
    if (offset === 0 && lateToday) continue;
    if (days && !days.includes(isoWeekday(d))) continue;
    orderDate = d;
    break;
  }
  const deliveryDate = terms.leadTimeHours === null ? null : addDays(orderDate, Math.ceil(terms.leadTimeHours / 24));
  return { orderDate, orderToday: orderDate === today, deliveryDate };
}

/** Lo que falta para el pedido mínimo (null si no hay mínimo o ya se llega). */
export function minOrderShortfall(total: Decimal.Value, minOrder: string | null): Decimal | null {
  if (minOrder === null) return null;
  const missing = new Decimal(minOrder).minus(total);
  return missing.gt(0) ? missing : null;
}

/** «lunes y jueves», «de lunes a viernes», «cualquier día». */
export function describeDays(days: number[] | null): string {
  if (!days?.length) return "cualquier día";
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 7) return "todos los días";
  const consecutive = sorted.length >= 3 && sorted.every((d, i) => i === 0 || d === sorted[i - 1]! + 1);
  if (consecutive) return `de ${WEEKDAYS[sorted[0]! - 1]} a ${WEEKDAYS[sorted.at(-1)! - 1]}`;
  const names = sorted.map((d) => WEEKDAYS[d - 1]!);
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} y ${names.at(-1)}`;
}

/** Abreviatura para tablas: «L·J», «L–V». */
export function shortDays(days: number[] | null): string {
  if (!days?.length) return "Todos";
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const consecutive = sorted.length >= 3 && sorted.every((d, i) => i === 0 || d === sorted[i - 1]! + 1);
  return consecutive ? `${SHORT[sorted[0]! - 1]}–${SHORT[sorted.at(-1)! - 1]}` : sorted.map((d) => SHORT[d - 1]).join("·");
}

/** «miércoles 29 oct». */
export function formatDayLong(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return `${WEEKDAYS[isoWeekday(day) - 1]} ${d.getUTCDate()} ${d.toLocaleDateString("es-ES", { month: "short", timeZone: "UTC" }).replace(".", "")}`;
}

/** Resumen de las condiciones en una línea («Pide lunes y jueves hasta las 14:00 · entrega en 48 h · mínimo 150,00 €»). */
export function describeTerms(terms: SupplierTerms, money: (v: Decimal) => string): string | null {
  const parts: string[] = [];
  if (terms.orderDays?.length || terms.orderCutoff) {
    parts.push(`Pedidos ${describeDays(terms.orderDays)}${terms.orderCutoff ? ` hasta las ${terms.orderCutoff.slice(0, 5)}` : ""}`);
  }
  if (terms.leadTimeHours !== null) parts.push(terms.leadTimeHours === 0 ? "entrega el mismo día" : `entrega en ${terms.leadTimeHours} h`);
  if (terms.minOrder !== null && new Decimal(terms.minOrder).gt(0)) parts.push(`mínimo ${money(new Decimal(terms.minOrder))}`);
  return parts.length ? parts.join(" · ") : null;
}
