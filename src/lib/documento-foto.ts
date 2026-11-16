import Decimal from "decimal.js";
import { ocrTextos } from "@/lib/albaran-ocr";
import type { OcrText } from "@/lib/albaran-reader";
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
 * Qué campos del formulario de factura rellena una lectura. La base es la base imponible (sin IVA y tras el
 * descuento de cabecera) y el IVA es la suma de sus tipos. Si la lectura no cuadra o no tiene líneas, se avisa: no se
 * inventa nada y el importe que falte se deja vacío.
 */
export function camposDeFactura(r: DocRead): CamposLeidos {
  // La base es la base imponible escrita; si no, el subtotal menos el descuento de cabecera; si no, la suma de las
  // líneas. Siempre sin IVA: es lo que se compara con los albaranes.
  const sub = r.subtotal ?? (r.lines.length ? r.linesTotal : null);
  const base = r.base ?? (sub !== null && r.discountPct !== null ? new Decimal(sub).mul(new Decimal(1).minus(new Decimal(r.discountPct).div(100))).toFixed(2) : sub);
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

/**
 * Lee una foto de factura o de albarán: el OCR del navegador (la foto no sale del dispositivo), renglones y el
 * mismo lector que el texto. Devuelve también el texto del OCR, para buscar el proveedor. No guarda nada.
 */
export async function readDocumentPhoto(file: Blob): Promise<DocRead & { texts: OcrText[] }> {
  const texts = await ocrTextos(file);
  return { ...readDocumentText(filasDeOcr(texts)), texts };
}
