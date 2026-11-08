// Facturas: vencimiento a partir de las condiciones de pago del proveedor y cómo se lee el cuadre con
// los albaranes. Los importes los valida la base de datos (save_invoice).

/** «Transferencia a 30 días», «60 d», «a 15 días fecha factura» → días; «contado» → 0; sin pista → null. */
export function paymentDays(terms: string | null | undefined): number | null {
  const t = (terms ?? "").toLowerCase();
  if (!t.trim()) return null;
  if (/contado|al contado|inmediat/.test(t)) return 0;
  const m = /(\d{1,3})\s*(d[ií]as|d\b|dias)/.exec(t);
  if (m) return Number(m[1]);
  if (/semanal/.test(t)) return 7;
  if (/mensual/.test(t)) return 30;
  return null;
}

/** Fecha ISO + días (sin husos: es una fecha de calendario). */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export type Match = { tone: "ok" | "over" | "under" | "none"; label: string };

/** Base de la factura frente a lo que suman sus albaranes (tolerancia de 0,50 € por redondeos). */
export function invoiceMatch(subtotal: number, receiptsTotal: number, receipts: number, money: (v: number) => string): Match {
  if (receipts === 0) return { tone: "none", label: "Sin albaranes" };
  const diff = Math.round((subtotal - receiptsTotal) * 100) / 100;
  if (Math.abs(diff) <= 0.5) return { tone: "ok", label: "Cuadra" };
  return diff > 0 ? { tone: "over", label: `${money(diff)} de más` } : { tone: "under", label: `${money(-diff)} de menos` };
}

/** Días hasta el vencimiento (negativo si ya venció). */
export function daysUntil(isoDate: string, today = new Date()): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  const due = Date.UTC(y!, m! - 1, d!);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((due - now) / 86_400_000);
}
