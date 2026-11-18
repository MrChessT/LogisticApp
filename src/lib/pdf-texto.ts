// Texto de un PDF, en el navegador (el archivo no sale del dispositivo). Las facturas y los albaranes en PDF casi
// siempre traen su texto: se saca con pdf.js y se ordena en renglones, que es lo que lee documento-texto.ts. Un PDF
// escaneado (solo imagen) no trae texto: se dibuja cada página y se lee con el mismo OCR que las fotos.

/** Un trozo de texto de pdf.js con su posición (x, y desde abajo) y su tamaño. */
export type PdfItem = { str: string; x: number; y: number; width: number; height: number };

/**
 * Agrupa los trozos en renglones: mismos y (con tolerancia de medio cuerpo de letra), ordenados de arriba abajo y de
 * izquierda a derecha. Entre dos trozos separados se pone un espacio; pegados (pdf.js parte palabras), sin espacio.
 */
export function lineasDePdf(items: PdfItem[]): string[] {
  const rows: Array<{ y: number; h: number; items: PdfItem[] }> = [];
  for (const it of items) {
    if (!it.str.trim()) continue;
    const h = Math.max(it.height, 1);
    const row = rows.find((r) => Math.abs(r.y - it.y) <= Math.max(r.h, h) * 0.5);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, h, items: [it] });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((r) => {
      const sorted = r.items.sort((a, b) => a.x - b.x);
      let line = "";
      let end = -Infinity;
      for (const it of sorted) {
        const gap = it.x - end;
        if (line && gap > Math.max(it.height, 1) * 0.15) line += " ";
        line += it.str.trim();
        end = it.x + it.width;
      }
      return line.replace(/\s+/g, " ").trim();
    })
    .filter(Boolean);
}

const MAX_PAGES = 6;

type PdfJs = typeof import("pdfjs-dist");

async function loadPdfJs(): Promise<PdfJs> {
  const pdfjs = await import("pdfjs-dist");
  // Sin hilo aparte: el lector se carga en esta página (pdf.js lo busca en globalThis.pdfjsWorker). Evita servir el
  // worker como archivo suelto y basta para documentos de pocas páginas.
  if (!(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker) {
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await import("pdfjs-dist/build/pdf.worker.min.mjs");
  }
  return pdfjs;
}

/**
 * Renglones de texto del PDF y, si no tiene texto (escaneado), las páginas como imágenes para el OCR.
 * Solo las primeras páginas: una factura o un albarán no pasan de ahí.
 */
export async function leerPdf(file: Blob): Promise<{ lines: string[]; pages: Blob[] }> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const lines: string[] = [];
    const count = Math.min(doc.numPages, MAX_PAGES);
    for (let n = 1; n <= count; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items = content.items.flatMap((i) =>
        "str" in i ? [{ str: i.str, x: i.transform[4] as number, y: i.transform[5] as number, width: i.width, height: i.height || Math.abs(i.transform[3] as number) }] : [],
      );
      lines.push(...lineasDePdf(items));
    }
    if (lines.join("").replace(/\s/g, "").length >= 20) return { lines, pages: [] };
    const pages: Blob[] = [];
    for (let n = 1; n <= count; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (blob) pages.push(blob);
    }
    return { lines: [], pages };
  } finally {
    await doc.destroy();
  }
}
