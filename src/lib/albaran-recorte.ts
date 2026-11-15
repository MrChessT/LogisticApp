// Lo que se lee de un recuadro dibujado sobre la foto del albarán, cuando el lector no detectó algo por su
// cuenta: el texto de esa zona se interpreta según lo que la persona dijo que buscaba.
import { cleanName, supplierNameGuess } from "@/lib/albaran-cabecera";
import { filasDeOcr } from "@/lib/documento-filas";
import { parseDate, productLine, type DocLine } from "@/lib/documento-texto";
import type { OcrText } from "@/lib/albaran-reader";

/** El texto de la zona, en un solo renglón (las cajas del OCR de varias filas se unen en orden). */
export function textoDeRecorte(texts: OcrText[]): string {
  return filasDeOcr(texts).replace(/\s*\n\s*/g, " ").trim();
}

/** Fecha en ISO, si hay una en el texto («28-04-2023», «04/03/14»). */
export function fechaDeRecorte(text: string): string | null {
  const m = /(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4}|\d{2})(?!\d)/.exec(text);
  return m ? parseDate(`${m[1]}/${m[2]}/${m[3]}`) : null;
}

/** Número del albarán: lo que va tras la etiqueta («Nº Albarán A/129» → A/129) o, si no hay etiqueta, el primer código con cifras. */
export function numeroDeRecorte(text: string): string | null {
  const sinEtiqueta = text.replace(/albar[aá]n|n[úu]mero|n[º°o]\.?|n\.º|fecha|\bn\b/gi, " ");
  const m = /[A-Za-z]{0,4}[-/]?\d[\w/-]*/.exec(sinEtiqueta.replace(/\s*([/-])\s*/g, "$1"));
  return m && !/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(m[0]) ? m[0] : null;
}

/** Nombre del proveedor: con forma social («Carnes Ejemplo S.L.»), o el texto limpio. */
export function proveedorDeRecorte(text: string): string | null {
  return supplierNameGuess(text) ?? cleanName(text);
}

/**
 * Las líneas de albarán (descripción, cantidad, precio e importe) del recuadro: cada renglón por separado, solo los
 * que cuadran. Así un recuadro que recoge un trozo del renglón de al lado no estropea el que se buscaba.
 */
export function lineasDeRecorte(texts: OcrText[]): DocLine[] {
  return filasDeOcr(texts).split("\n").map((row) => productLine(row)).filter((l): l is DocLine => l !== null);
}

/** Solo la descripción de un producto: sin importes ni cantidades sueltas al final. */
export function descripcionDeRecorte(text: string): string | null {
  const sinNumeros = text.replace(/\s+\d+(?:[.,]\d+)?(?:\s*(?:kg|kgs|g|gr|ud|uds|l|lt|€))?(?=\s|$)/gi, " ");
  return cleanName(sinNumeros.length >= 3 ? sinNumeros : text);
}
