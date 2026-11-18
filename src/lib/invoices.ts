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

const compact = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Albaranes sin facturar que corresponden a una factura leída, para marcarlos al registrarla:
 *  1. los que la factura nombra por su número («Albarán 2024/117», «Alb. AL-7781»), si alguno aparece;
 *  2. si no, la única combinación de albaranes (de los 14 más recientes) cuya suma sin IVA da la base, con el menor
 *     número de albaranes. Si hay dos combinaciones igual de buenas, no se elige: lo decide la persona.
 * Lo propuesto solo se marca; la persona lo revisa antes de registrar.
 */
export function proposeReceipts<R extends { id: string; docNumber: string | null; date: string; total: number }>(
  base: number | null,
  receipts: R[],
  texts: string[],
): { ids: string[]; how: "numero" | "suma" } | null {
  if (receipts.length === 0) return null;
  const tokens = new Set(texts.flatMap((t) => t.split(/[^\p{L}\p{N}/-]+/u)).map(compact).filter((t) => t.length >= 3));
  const whole = compact(texts.join(" "));
  const named = receipts.filter((r) => {
    const n = r.docNumber ? compact(r.docNumber) : "";
    return n.length >= 3 && (tokens.has(n) || (n.length >= 5 && whole.includes(n)));
  });
  if (named.length > 0) return { ids: named.map((r) => r.id), how: "numero" };
  if (base === null || base <= 0) return null;
  const pool = [...receipts].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);
  const cents = Math.round(base * 100);
  let best: { mask: number; size: number } | null = null;
  let tie = false;
  for (let mask = 1; mask < 1 << pool.length; mask++) {
    let sum = 0;
    let size = 0;
    for (let i = 0; i < pool.length; i++) if (mask & (1 << i)) { sum += Math.round(pool[i]!.total * 100); size++; }
    if (Math.abs(sum - cents) > 2) continue;
    if (!best || size < best.size) { best = { mask, size }; tie = false; } else if (size === best.size) tie = true;
  }
  if (!best || tie) return null;
  const picked = pool.filter((_, i) => best!.mask & (1 << i)).sort((a, b) => a.date.localeCompare(b.date));
  return { ids: picked.map((r) => r.id), how: "suma" };
}
