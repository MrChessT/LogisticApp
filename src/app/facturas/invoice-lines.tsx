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

/** Las líneas de la factura, solo para ver. Se cambian volviendo a leer la foto. */
export function InvoiceLinesTable({ lines }: { lines: LineaFactura[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="editor-section">
      <p className="facet-title">Líneas de la factura ({lines.length})</p>
      <table className="editor-table">
        <thead>
          <tr><th>Ref.</th><th>Descripción</th><th>Cant.</th><th>Precio</th><th>Dto</th><th>IVA</th><th>Importe</th></tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>{l.ref ?? ""}</td>
              <td>{l.description}</td>
              <td>{l.qty}{l.unit ? ` ${l.unit}` : ""}</td>
              <td>{euros(l.price)}</td>
              <td>{l.discountPct ? `${l.discountPct} %` : ""}</td>
              <td>{l.vatPct ? `${l.vatPct} %` : ""}</td>
              <td>{euros(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
