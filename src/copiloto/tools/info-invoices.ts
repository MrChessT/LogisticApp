// Facturas y albaranes desde el chat: pendientes, vencimientos, pagadas, las que no cuadran y los albaranes, con
// los filtros que diga el mensaje (proveedor, número, periodo, ventana de vencimiento). Si nombra un proveedor que
// no existe se dice; antes se contestaba con todos, como si el filtro no estuviera.
import Decimal from "decimal.js";
import type { AppRoute, TableEvent } from "../contract/index";
import type { SessionContext } from "../domain";
import { normalize, tokenize } from "../entities/normalize";
import { formatMoney } from "../entities/units";
import { tokenSimilarity } from "../entities/retriever";
import type { InfoParams, InfoResult } from "./info";
import { calendarPeriod } from "./periods";
import { documentNumber, dueWindow, sameDocument, unknownSupplier } from "./text-filters";
import type { Period } from "./types";

export interface InvoiceRaw {
  id: string;
  supplierName: string;
  number: string;
  code: string;
  date: string;
  due: string | null;
  total: string;
  status: "pendiente" | "pagada";
  paidAt: string | null;
  receipts: number;
  difference: string;
  overdue: boolean;
}

/** Un albarán cerrado (recepción) con la factura en la que está, si ya está facturado. */
export interface ReceiptRaw {
  number: string | null;
  code: string | null;
  supplierName: string;
  date: string;
  total: string;
  locationName: string;
  invoiceNumber: string | null;
}

export interface InvoicesSource {
  invoices(orgId: string): Promise<InvoiceRaw[]>;
  receipts(orgId: string): Promise<ReceiptRaw[]>;
}

const MAX_ROWS = 12;
const ROUTE: AppRoute = "/facturas";

const day = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${Number(d)}/${Number(m)}/${y}`;
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const money = (v: Decimal.Value) => formatMoney(v);
const sum = (rows: Array<{ total: string }>) => rows.reduce((s, i) => s.plus(i.total), new Decimal(0));
/** «el mes pasado» → «del mes pasado», «en octubre» → «de octubre»: el periodo detrás de «albaranes» o «facturas». */
const ofPeriod = (label: string) => (label.startsWith("el ") ? `del ${label.slice(3)}` : label.startsWith("en ") ? `de ${label.slice(3)}` : `de ${label}`);
const within = (date: string | null, period: Period) => date !== null && date.slice(0, 10) >= period.from && date.slice(0, 10) <= period.to;

/** Hoy (día local), en el formato de las fechas de los documentos. */
function isoToday(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function daysFrom(iso: string, now: Date): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(y!, m! - 1, d!) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000);
}

function table(columns: TableEvent["columns"], rows: Array<Record<string, string>>, flagged: number[] = []): TableEvent | undefined {
  if (rows.length < 2) return undefined;
  const shown = rows.slice(0, MAX_ROWS);
  const marks = flagged.filter((i) => i < shown.length);
  return { columns, rows: shown, ...(marks.length ? { flagged: marks } : {}), ...(rows.length > MAX_ROWS ? { more: rows.length - MAX_ROWS } : {}) };
}

/** ¿El mensaje nombra a este proveedor? Todas sus palabras, o la distintiva de un nombre largo («carpio»). */
function names(message: string, name: string): boolean {
  const words = tokenize(message);
  const wanted = tokenize(name).filter((w) => w.length > 2 && !["demo", "sl", "sa", "slu", "sociedad", "limitada"].includes(w));
  if (wanted.length === 0) return false;
  const hits = wanted.filter((w) => words.some((m) => m.length > 2 && tokenSimilarity(m, w) >= 0.85));
  return hits.length === wanted.length || (wanted.length >= 2 && hits.length >= 1 && hits.some((h) => h.length >= 5));
}

const dueText = (i: InvoiceRaw, now: Date) => {
  if (!i.due) return "sin vencimiento";
  const d = daysFrom(i.due, now);
  return d < 0 ? `vencida hace ${plural(-d, "día", "días")}` : d === 0 ? "hoy" : d <= 31 ? `en ${plural(d, "día", "días")}` : day(i.due);
};

const cuadre = (i: InvoiceRaw) => (i.receipts === 0 ? "sin albaranes" : new Decimal(i.difference).abs().lte(0.5) ? "cuadra" : `${new Decimal(i.difference).gt(0) ? "+" : ""}${money(i.difference)}`);

function invoiceTable(list: InvoiceRaw[], now: Date): TableEvent | undefined {
  return table(
    [{ key: "proveedor", label: "Proveedor" }, { key: "numero", label: "Número" }, { key: "fecha", label: "Fecha" }, { key: "vence", label: "Vence" }, { key: "total", label: "Total", align: "right" }, { key: "cuadre", label: "Cuadre" }],
    list.map((i) => ({ proveedor: i.supplierName, numero: i.number, fecha: day(i.date), vence: i.status === "pagada" ? "pagada" : dueText(i, now), total: money(i.total), cuadre: cuadre(i) })),
    list.flatMap((i, n) => (i.overdue ? [n] : [])),
  );
}

/** «A-4356»: la factura o el albarán con ese número (o su código interno), con lo que importa de cada uno. */
function byNumber(number: string, invoices: InvoiceRaw[], receipts: ReceiptRaw[], now: Date): InfoResult {
  const inv = invoices.filter((i) => sameDocument(number, i.number) || sameDocument(number, i.code));
  const rec = receipts.filter((r) => (r.number && sameDocument(number, r.number)) || (r.code && sameDocument(number, r.code)));
  if (inv.length === 0 && rec.length === 0) {
    return { text: `No encuentro ninguna factura ni albarán con el número «${number.toUpperCase()}». Revisa el número o búscalo por proveedor («albaranes de este mes de …»).`, route: ROUTE, rows: 0 };
  }
  const lines = [
    ...inv.map((i) => `Factura ${i.number} de ${i.supplierName}, del ${day(i.date)}: ${money(i.total)}, ${i.status === "pagada" ? `pagada el ${day(i.paidAt ?? i.date)}` : `pendiente (${dueText(i, now)})`}; ${cuadre(i) === "cuadra" ? "cuadra con sus albaranes" : cuadre(i) === "sin albaranes" ? "sin albaranes enlazados" : `diferencia con sus albaranes ${cuadre(i)}`}.`),
    ...rec.map((r) => `Albarán ${r.number ?? r.code} de ${r.supplierName}, del ${day(r.date)} en ${r.locationName}: ${money(r.total)}, ${r.invoiceNumber ? `facturado en la factura ${r.invoiceNumber}` : "aún sin factura"}.`),
  ];
  return { text: lines.slice(0, 4).join("\n"), route: ROUTE, rows: inv.length + rec.length };
}

/** Albaranes con sus filtros: todos los del periodo o solo los que aún no tienen factura. */
function receiptsAnswer(rows: ReceiptRaw[], onlyUnbilled: boolean, who: string, period: Period | null): InfoResult {
  const list = (onlyUnbilled ? rows.filter((r) => !r.invoiceNumber) : rows).sort((a, b) => b.date.localeCompare(a.date));
  const when = period ? ` ${ofPeriod(period.label)}` : "";
  if (list.length === 0) {
    return { text: onlyUnbilled ? `No hay albaranes sin factura${who}${when}: todo lo recibido está facturado.` : `No hay albaranes${who}${when}.`, route: ROUTE, rows: 0 };
  }
  const unbilled = list.filter((r) => !r.invoiceNumber);
  const head = onlyUnbilled
    ? `Hay ${plural(list.length, "albarán", "albaranes")} sin factura${who}${when} por ${money(sum(list))}. Cuando llegue la factura, regístrala en Facturas desde «Albaranes sin factura».`
    : `${plural(list.length, "albarán", "albaranes")}${who}${when} por ${money(sum(list))}${unbilled.length ? `; ${plural(unbilled.length, "está", "están")} sin factura (${money(sum(unbilled))})` : "; todos facturados"}.`;
  return {
    text: head,
    table: table(
      [{ key: "fecha", label: "Fecha" }, { key: "numero", label: "Número" }, { key: "proveedor", label: "Proveedor" }, { key: "local", label: "Local" }, { key: "importe", label: "Importe", align: "right" }, { key: "factura", label: "Factura" }],
      list.map((r) => ({ fecha: day(r.date), numero: r.number ?? r.code ?? "—", proveedor: r.supplierName, local: r.locationName, importe: money(r.total), factura: r.invoiceNumber ?? "sin factura" })),
    ),
    route: ROUTE,
    rows: list.length,
  };
}

export async function invoices(source: InvoicesSource, ctx: SessionContext, p: InfoParams): Promise<InfoResult> {
  if (!ctx.seesCosts || ctx.role === "staff") {
    return { text: "Las facturas las ve la dirección (propiedad, administración y encargados) con el permiso «ve costes».", route: ROUTE, rows: 0 };
  }
  const text = normalize(p.message);
  const today = isoToday(p.now);
  const [all, receipts] = await Promise.all([source.invoices(ctx.orgId), source.receipts(ctx.orgId)]);

  const number = documentNumber(p.message);
  if (number) return byNumber(number, all, receipts, p.now);

  // Proveedor: uno con facturas o albaranes, o uno del catálogo sin ellos. Si nombra uno que no existe, se dice.
  const known = [...new Set([...all.map((i) => i.supplierName), ...receipts.map((r) => r.supplierName), ...ctx.suppliers.map((s) => s.name)])];
  const supplier = known.find((s) => names(p.message, s));
  if (!supplier) {
    const unknown = unknownSupplier(p.message, known, ctx.locations.map((l) => l.name));
    if (unknown) {
      const withDocs = [...new Set([...all.map((i) => i.supplierName), ...receipts.map((r) => r.supplierName)])].sort((a, b) => a.localeCompare(b, "es"));
      return {
        text: `No tengo ningún proveedor llamado «${unknown}».${withDocs.length ? ` Los que tienen facturas o albaranes son: ${withDocs.slice(0, 8).join(", ")}${withDocs.length > 8 ? "…" : "."}` : ""}`,
        route: ROUTE,
        rows: 0,
      };
    }
  }
  const who = supplier ? ` de ${supplier}` : "";
  const scoped = supplier ? all.filter((i) => i.supplierName === supplier) : all;
  const scopedReceipts = supplier ? receipts.filter((r) => r.supplierName === supplier) : receipts;
  const period = calendarPeriod(p.message, today);
  const due = dueWindow(p.message, today);

  // Albaranes: todos los del periodo (con su factura) o solo los que faltan por facturar.
  if (/\balbaran/.test(text) && !/\bfacturas\b/.test(text)) {
    const onlyUnbilled = /sin factura|sin facturar|no facturad|no (tiene|tienen|estan|esta) factur|pendientes?|falta|faltan/.test(text) || (!period && !supplier);
    const inPeriod = period ? scopedReceipts.filter((r) => within(r.date, period)) : scopedReceipts;
    return receiptsAnswer(inPeriod, onlyUnbilled, who, period);
  }

  const mismatched = scoped.filter((i) => i.receipts > 0 && new Decimal(i.difference).abs().gt(0.5));
  if (/cuadr|diferencia|de mas|cobrad|discrepan/.test(text)) {
    if (mismatched.length === 0) return { text: `Todas las facturas${who} cuadran con sus albaranes.`, route: ROUTE, rows: 0 };
    const over = mismatched.filter((i) => new Decimal(i.difference).gt(0)).reduce((s, i) => s.plus(i.difference), new Decimal(0));
    return {
      text: `${plural(mismatched.length, "factura no cuadra", "facturas no cuadran")} con sus albaranes${who}${over.gt(0) ? `: cobran ${money(over)} más de lo recibido` : ""}.`,
      table: table(
        [{ key: "proveedor", label: "Proveedor" }, { key: "numero", label: "Número" }, { key: "fecha", label: "Fecha" }, { key: "diferencia", label: "Diferencia", align: "right" }],
        mismatched.map((i) => ({ proveedor: i.supplierName, numero: i.number, fecha: day(i.date), diferencia: `${new Decimal(i.difference).gt(0) ? "+" : ""}${money(i.difference)}` })),
      ),
      route: ROUTE,
      rows: mismatched.length,
    };
  }

  // Pagadas (en el periodo, si lo dice: por la fecha de pago).
  if (/pagad|pague|pagamos/.test(text) && !/pendiente|por pagar|sin pagar|que pagar|hay que pagar|tengo que pagar/.test(text)) {
    const paid = scoped.filter((i) => i.status === "pagada" && (!period || within(i.paidAt, period))).sort((a, b) => (b.paidAt ?? "").localeCompare(a.paidAt ?? ""));
    const when = period ? ` ${period.label}` : "";
    if (paid.length === 0) return { text: `No hay facturas pagadas${who}${when}.`, route: ROUTE, rows: 0 };
    return {
      text: `${plural(paid.length, "factura pagada", "facturas pagadas")}${who}${when} por ${money(sum(paid))}. La última, el ${day(paid[0]!.paidAt ?? paid[0]!.date)}.`,
      table: table(
        [{ key: "proveedor", label: "Proveedor" }, { key: "numero", label: "Número" }, { key: "pagada", label: "Pagada" }, { key: "total", label: "Total", align: "right" }],
        paid.map((i) => ({ proveedor: i.supplierName, numero: i.number, pagada: i.paidAt ? day(i.paidAt) : "—", total: money(i.total) })),
      ),
      route: ROUTE,
      rows: paid.length,
    };
  }

  const pending = scoped.filter((i) => i.status === "pendiente");
  const overdue = pending.filter((i) => i.overdue);

  // «¿Qué facturas vencen esta semana?»: las que vencen en esa ventana (las ya vencidas se nombran aparte).
  if (due) {
    const inWindow = pending.filter((i) => !i.overdue && within(i.due, due)).sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
    const late = overdue.length ? ` Además, ${plural(overdue.length, "está vencida", "están vencidas")} sin pagar (${money(sum(overdue))}).` : "";
    if (inWindow.length === 0) return { text: `No vence ninguna factura${who} ${due.label}.${late}`, route: ROUTE, rows: 0 };
    return { text: `${plural(inWindow.length, "factura vence", "facturas vencen")}${who} ${due.label}: ${money(sum(inWindow))}.${late}`, table: invoiceTable(inWindow, p.now), route: ROUTE, rows: inWindow.length };
  }

  // «Facturas de octubre», «facturas de este mes»: las de ese periodo (por fecha de factura), pagadas o no.
  if (period) {
    const inPeriod = scoped.filter((i) => within(i.date, period)).sort((a, b) => b.date.localeCompare(a.date));
    if (inPeriod.length === 0) return { text: `No hay facturas${who} ${ofPeriod(period.label)}.`, route: ROUTE, rows: 0 };
    const open = inPeriod.filter((i) => i.status === "pendiente");
    return {
      text: `${plural(inPeriod.length, "factura", "facturas")}${who} ${ofPeriod(period.label)} por ${money(sum(inPeriod))}${open.length ? `; pendiente de pago: ${money(sum(open))}` : "; todas pagadas"}.`,
      table: invoiceTable(inPeriod, p.now),
      route: ROUTE,
      rows: inPeriod.length,
    };
  }

  // Pendientes (por defecto) o solo las vencidas.
  const onlyOverdue = /vencid|atrasad|retrasad|sin pagar desde/.test(text) && overdue.length > 0;
  const list = (onlyOverdue ? overdue : pending).sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  const unbilled = scopedReceipts.filter((r) => !r.invoiceNumber);
  if (pending.length === 0) {
    return { text: `No hay facturas pendientes de pago${who}.${unbilled.length > 0 ? ` Eso sí, hay ${plural(unbilled.length, "albarán", "albaranes")}${who} que aún no ${unbilled.length === 1 ? "tiene" : "tienen"} factura (${money(sum(unbilled))}).` : ""}`, route: ROUTE, rows: 0 };
  }
  const dueSoon = pending.filter((i) => !i.overdue && i.due && daysFrom(i.due, p.now) <= 7);
  const parts = [`Pendiente de pago${who}: ${money(sum(pending))} en ${plural(pending.length, "factura", "facturas")}.`];
  if (overdue.length > 0) parts.push(`${plural(overdue.length, "está vencida", "están vencidas")} (${money(sum(overdue))}).`);
  if (dueSoon.length > 0) parts.push(`${plural(dueSoon.length, "vence", "vencen")} en los próximos 7 días (${money(sum(dueSoon))}).`);
  const openMismatch = mismatched.filter((i) => i.status === "pendiente").length;
  if (openMismatch) parts.push(`Ojo: ${plural(openMismatch, "no cuadra", "no cuadran")} con sus albaranes.`);
  // «¿Cuánto le debo a X?»: lo facturado y, aparte, lo recibido que aún no se ha facturado.
  if (supplier && unbilled.length) parts.push(`Además hay ${plural(unbilled.length, "albarán", "albaranes")} sin facturar por ${money(sum(unbilled))}.`);
  return { text: parts.join(" "), table: invoiceTable(list, p.now), route: ROUTE, rows: list.length };
}
