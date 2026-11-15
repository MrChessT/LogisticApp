import Decimal from "decimal.js";
import type { ReceiptLine } from "./receipt-lines";

// Comprobación de las líneas de una recepción antes de registrarla. Ninguna línea con algún dato se descarta en
// silencio: o está completa, o se dice cuál hay que corregir o quitar. Solo se ignora la fila totalmente vacía.

export type ReceiptLineToSave = { pack_id: string; packs_qty: string; pack_price: string; incident: string | null };

const num = (raw: string): Decimal | null => {
  const t = raw.trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return new Decimal(t);
};
const isBlank = (l: ReceiptLine) => !l.product && !l.read && !l.packId && !l.qty.trim() && !l.price.trim();

export function checkReceiptLines(lines: ReceiptLine[]): { error: string } | { lines: ReceiptLineToSave[] } {
  const out: ReceiptLineToSave[] = [];
  for (const [i, line] of lines.entries()) {
    if (isBlank(line)) continue;
    const name = line.product?.name ?? (line.read?.description ? `«${line.read.description}»` : `la línea ${i + 1}`);
    if (!line.product) {
      return { error: line.read ? `Elige o crea el producto de ${name}, o quita esa línea.` : `La línea ${i + 1} no tiene producto: elígelo o quita la línea.` };
    }
    if (!line.packId) return { error: `Elige el formato de ${name} (kilo, unidad, caja…): tiene que ser el mismo en el que viene la cantidad.` };
    const qty = num(line.qty);
    if (!qty || qty.lte(0)) return { error: `Revisa la cantidad de ${name}: tiene que ser mayor que 0.` };
    // Sin precio no se guarda a 0 €: un 0 tapaba el precio bueno del proveedor y valoraba el stock a 0 €.
    if (line.price.trim() === "") return { error: `Falta el precio de ${name}: escríbelo como viene en el albarán.` };
    const price = num(line.price);
    if (!price || price.lt(0)) return { error: `Revisa el precio de ${name}: tiene que ser un número, 0 o más.` };
    out.push({ pack_id: line.packId, packs_qty: qty.toString(), pack_price: price.toString(), incident: line.incident || null });
  }
  return out.length ? { lines: out } : { error: "Añade al menos una línea con producto, cantidad y precio." };
}
