// Totales de un albarán para su ficha. El dinero va con decimal.js (nunca number): importe de cada línea
// (cantidad × precio del formato), lo cobrado de más frente a lo pactado (solo subidas) y las incidencias.
import Decimal from "decimal.js";

export interface ReceiptDetailLine {
  qty: string;
  price: string;
  expected: string | null;
  incident: string | null;
}

export function lineAmount(line: Pick<ReceiptDetailLine, "qty" | "price">): Decimal {
  return new Decimal(line.qty).mul(line.price);
}

/** Lo cobrado de más en una línea: solo cuando el precio supera al pactado. */
export function lineOvercharge(line: ReceiptDetailLine): Decimal {
  if (line.expected === null) return new Decimal(0);
  const diff = new Decimal(line.price).minus(line.expected);
  return diff.gt(0) ? diff.mul(line.qty) : new Decimal(0);
}

export function receiptSummary(lines: ReceiptDetailLine[]): { amount: Decimal; overcharge: Decimal; incidents: number } {
  return {
    amount: lines.reduce((acc, l) => acc.plus(lineAmount(l)), new Decimal(0)),
    overcharge: lines.reduce((acc, l) => acc.plus(lineOvercharge(l)), new Decimal(0)),
    incidents: lines.filter((l) => l.incident).length,
  };
}
