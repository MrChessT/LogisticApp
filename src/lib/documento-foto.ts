import Decimal from "decimal.js";
import { ocrTextos } from "@/lib/albaran-ocr";
import { filasDeOcr } from "@/lib/documento-filas";
import { readDocumentText, type DocRead } from "@/lib/documento-texto";

export type CamposLeidos = {
  number: string | null;
  date: string | null;
  subtotal: string | null;
  vat: string | null;
  total: string | null;
  /** Lo que se le dice a la persona sobre la lectura. */
  aviso: { ok: boolean; text: string };
};

/** Importe en el formato del formulario («165,00»). */
const importe = (v: Decimal.Value) => new Decimal(v).toFixed(2).replace(".", ",");

/**
 * Qué campos del formulario de factura rellena una lectura. La base es el subtotal (o la base escrita, o la suma
 * de las líneas) y el IVA es la suma de sus tipos. Si la lectura no cuadra o no tiene líneas, se avisa: no se
 * inventa nada y el importe que falte se deja vacío.
 */
export function camposDeFactura(r: DocRead): CamposLeidos {
  const base = r.subtotal ?? r.base ?? (r.lines.length ? r.linesTotal : null);
  const aviso: CamposLeidos["aviso"] =
    r.status === "cuadra" ? { ok: true, text: "Lectura cuadrada. Revisa los datos antes de registrar." }
      : r.status === "revisar" ? { ok: false, text: `La lectura no cuadra: ${r.issues.join(" ")} Revisa antes de registrar.` }
      : { ok: false, text: "No se reconocieron líneas de producto. Rellena los importes a mano." };
  return {
    number: r.number,
    date: r.date,
    subtotal: base === null ? null : importe(base),
    vat: r.vatRows.length ? importe(r.vatRows.reduce((sum, row) => sum.plus(row.vat), new Decimal(0))) : null,
    total: r.total === null ? null : importe(r.total),
    aviso,
  };
}

/** Lee una foto de factura o de albarán: el OCR del navegador (la foto no sale del dispositivo), renglones y el mismo lector que el texto. No guarda nada. */
export async function readDocumentPhoto(file: Blob): Promise<DocRead> {
  return readDocumentText(filasDeOcr(await ocrTextos(file)));
}
