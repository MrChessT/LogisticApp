// Albarán en PDF: se lee con el lector de texto (documento-texto.ts, vía documento-foto.ts) y se pasa a la misma forma
// que la lectura de una foto, así Nueva recepción y el asistente lo tratan igual: proveedor, fecha, número y líneas que
// se emparejan con el catálogo. Nada se guarda sin que la persona lo revise.
import type { DocumentoLeido } from "./documento-foto";
import type { AlbaranPhotoRead } from "./albaran-ocr";

const STATUS: Record<DocumentoLeido["status"], AlbaranPhotoRead["status"]> = { cuadra: "cuadra", revisar: "no_cuadra", sin_lineas: "sin_lineas" };
const num = (v: string | null) => (v === null ? null : Number(v));

/** Lectura por texto → lectura de albarán (números en vez de textos; un solo tipo de IVA, o ninguno si hay varios). */
export function albaranDeDocumento(r: DocumentoLeido): AlbaranPhotoRead {
  const vat = r.vatRows.length ? r.vatRows.reduce((sum, row) => sum + Number(row.vat), 0) : null;
  return {
    lines: r.lines.map((l) => ({
      ref: l.ref,
      description: l.description,
      qty: Number(l.qty),
      unit: l.unit,
      price: Number(l.price),
      discountPct: num(l.discountPct),
      amount: Number(l.amount),
      lot: null,
    })),
    linesTotal: Number(r.linesTotal),
    base: num(r.base ?? r.subtotal),
    vatRate: r.vatRows.length === 1 ? Number(r.vatRows[0]!.rate) : null,
    vat: vat === null ? null : Math.round(vat * 100) / 100,
    total: num(r.total),
    headerDiscountPct: num(r.discountPct),
    status: STATUS[r.status],
    date: r.date,
    texts: r.texts,
    number: r.number,
  };
}

const isPdf = (file: File) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

/** Foto o PDF de un albarán, con la misma forma de lectura. */
export async function readAlbaranFile(file: File): Promise<AlbaranPhotoRead> {
  if (isPdf(file)) {
    const { readDocumentPdf } = await import("./documento-foto");
    return albaranDeDocumento(await readDocumentPdf(file));
  }
  const { readAlbaranPhoto } = await import("./albaran-ocr");
  return readAlbaranPhoto(file);
}
