import Decimal from "decimal.js";
import { Plus, Trash2 } from "lucide-react";
import { euros } from "@/lib/format";

/** Una línea de factura tal como se guarda o se lee: los importes son texto con punto decimal. */
export type LineaFactura = {
  ref: string | null;
  description: string;
  qty: string;
  unit: string | null;
  price: string;
  discountPct: string | null;
  vatPct: string | null;
  amount: string;
};

const dec = (raw: string | null): Decimal | null => {
  const t = (raw ?? "").trim().replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(t) ? new Decimal(t) : null;
};

/** Por qué una línea no se puede guardar (misma regla que la base de datos), o null si está bien. */
export function lineProblem(l: LineaFactura): string | null {
  if (!l.description.trim()) return "falta la descripción";
  const qty = dec(l.qty);
  const price = dec(l.price);
  const amount = dec(l.amount);
  const dto = l.discountPct?.trim() ? dec(l.discountPct) : new Decimal(0);
  if (!qty || !price || !amount) return "cantidad, precio e importe tienen que ser números";
  if (!dto || dto.lt(0) || dto.gt(100)) return "el descuento va de 0 a 100";
  const expected = qty.mul(price).mul(new Decimal(1).minus(dto.div(100)));
  // Igual tolerancia que invoice_lines: 5 céntimos más un 0,05 % del importe.
  return expected.minus(amount).abs().lte(new Decimal("0.05").plus(amount.abs().mul("0.0005"))) ? null : `cantidad × precio da ${euros(expected.toFixed(2))}, no ${euros(amount.toFixed(2))}`;
}

/** Suma de los importes de las líneas que son números. */
export function linesTotal(lines: LineaFactura[]): Decimal {
  return lines.reduce((s, l) => s.plus(dec(l.amount) ?? 0), new Decimal(0));
}

/** Las líneas de la factura, editables: lo que se leyó mal de la foto se corrige aquí. */
export function InvoiceLinesTable({ lines, onChange }: { lines: LineaFactura[]; onChange: (lines: LineaFactura[]) => void }) {
  const set = (i: number, patch: Partial<LineaFactura>) => onChange(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  return (
    <div className="editor-section">
      <p className="facet-title">Líneas de la factura{lines.length ? ` (${lines.length} · suman ${euros(linesTotal(lines).toFixed(2))})` : ""}</p>
      {lines.length > 0 && (
        <div className="invoice-lines-scroll">
          <table className="editor-table invoice-lines">
            <thead>
              <tr><th>Ref.</th><th>Descripción</th><th>Cant.</th><th>Precio</th><th>Dto %</th><th>Importe</th><th /></tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const problem = lineProblem(l);
                return (
                  <tr key={i} className={problem ? "bad" : undefined}>
                    <td><input value={l.ref ?? ""} maxLength={40} aria-label={`Referencia de la línea ${i + 1}`} onChange={(e) => set(i, { ref: e.target.value || null })} /></td>
                    <td>
                      <input value={l.description} maxLength={200} aria-label={`Descripción de la línea ${i + 1}`} onChange={(e) => set(i, { description: e.target.value })} />
                      {problem && <small role="alert">Revisa: {problem}.</small>}
                    </td>
                    <td><input value={l.qty} inputMode="decimal" aria-label={`Cantidad de la línea ${i + 1}`} onChange={(e) => set(i, { qty: e.target.value })} /></td>
                    <td><input value={l.price} inputMode="decimal" aria-label={`Precio de la línea ${i + 1}`} onChange={(e) => set(i, { price: e.target.value })} /></td>
                    <td><input value={l.discountPct ?? ""} inputMode="decimal" aria-label={`Descuento de la línea ${i + 1}`} onChange={(e) => set(i, { discountPct: e.target.value || null })} /></td>
                    <td><input value={l.amount} inputMode="decimal" aria-label={`Importe de la línea ${i + 1}`} onChange={(e) => set(i, { amount: e.target.value })} /></td>
                    <td><button type="button" className="ghost-button" aria-label={`Quitar la línea ${i + 1}`} onClick={() => onChange(lines.filter((_, k) => k !== i))}><Trash2 size={14} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <button type="button" className="ghost-button" onClick={() => onChange([...lines, { ref: null, description: "", qty: "1", unit: null, price: "", discountPct: null, vatPct: null, amount: "" }])}><Plus size={14} /> Añadir línea</button>
    </div>
  );
}
