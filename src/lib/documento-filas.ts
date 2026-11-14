import type { OcrText } from "@/lib/albaran-reader";

/**
 * Convierte las cajas de texto del OCR en renglones, como se leen en el papel: dos cajas van en la misma fila si
 * su centro vertical está a menos de media altura de letra, y dentro de la fila van de izquierda a derecha.
 * El lector de texto (documento-texto.ts) trabaja sobre estos renglones. Lo que el OCR no detecta no aparece:
 * no se rellena nada.
 */
export function filasDeOcr(texts: OcrText[]): string {
  const cajas = texts
    .filter((t) => t.box.length >= 4 && t.text.trim())
    .map((t) => {
      const ys = t.box.map((p) => p[1]!);
      const xs = t.box.map((p) => p[0]!);
      const top = Math.min(...ys);
      const bottom = Math.max(...ys);
      return { text: t.text.trim(), x: Math.min(...xs), y: (top + bottom) / 2, h: bottom - top };
    })
    .sort((a, b) => a.y - b.y);
  if (cajas.length === 0) return "";

  const alturas = cajas.map((c) => c.h).sort((a, b) => a - b);
  const tolerancia = (alturas[Math.floor(alturas.length / 2)] ?? 20) / 2;
  const filas: { y: number; cajas: typeof cajas }[] = [];
  for (const c of cajas) {
    const fila = filas.at(-1);
    if (fila && Math.abs(c.y - fila.y) <= tolerancia) {
      fila.cajas.push(c);
      fila.y = fila.cajas.reduce((s, k) => s + k.y, 0) / fila.cajas.length;
    } else {
      filas.push({ y: c.y, cajas: [c] });
    }
  }
  return filas.map((f) => f.cajas.sort((a, b) => a.x - b.x).map((c) => c.text).join(" ")).join("\n");
}
