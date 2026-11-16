// Enderezar una foto de albarán torcida: se gira la imagen entera y el resto (dibujar el recuadro, leerlo) trabaja
// sobre la foto ya girada. Así una línea torcida pasa a ser un rectángulo que se puede rodear.

const MAX_LADO = 2400;

/** Tamaño de la foto después de girarla: el rectángulo que la envuelve, reducido si pasa de MAX_LADO. */
export function tamanoGirado(ancho: number, alto: number, grados: number, maxLado = MAX_LADO): { ancho: number; alto: number; escala: number } {
  const rad = (grados * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const w = ancho * c + alto * s;
  const h = ancho * s + alto * c;
  const escala = Math.min(1, maxLado / Math.max(w, h, 1));
  return { ancho: Math.max(1, Math.round(w * escala)), alto: Math.max(1, Math.round(h * escala)), escala };
}

/** Gira la foto `grados` (positivo, en el sentido de las agujas del reloj) y devuelve la nueva imagen como JPEG. */
export async function rotarFoto(file: Blob, grados: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { ancho, alto, escala } = tamanoGirado(bitmap.width, bitmap.height, grados);
  const canvas = document.createElement("canvas");
  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Este navegador no puede girar la foto.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, ancho, alto);
  ctx.translate(ancho / 2, alto / 2);
  ctx.rotate((grados * Math.PI) / 180);
  ctx.scale(escala, escala);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new Error("No se pudo girar la foto.");
  return blob;
}
