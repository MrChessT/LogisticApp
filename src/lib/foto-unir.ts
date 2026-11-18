// Un documento de varias páginas en fotos (una factura de dos hojas): las páginas se unen en una sola imagen, una debajo
// de otra, para adjuntarla entera a la factura o a la recepción. Cada página se lee por separado (documento-foto.ts).

const ANCHO_MAX = 1800;
// Los navegadores no dibujan lienzos de más de ~16 000 px de alto: si las páginas no caben, se reducen todas.
const ALTO_MAX = 15000;

/** Cómo se colocan las páginas: el ancho común y el alto de cada una a ese ancho (reducido si no caben). */
export function colocarPaginas(tamanos: Array<{ ancho: number; alto: number }>, anchoMax = ANCHO_MAX, altoMax = ALTO_MAX): { ancho: number; altos: number[] } {
  const ancho = Math.min(anchoMax, Math.max(1, ...tamanos.map((t) => t.ancho)));
  let altos = tamanos.map((t) => Math.round((t.alto * ancho) / Math.max(1, t.ancho)));
  const total = altos.reduce((s, a) => s + a, 0);
  if (total <= altoMax) return { ancho, altos };
  const escala = altoMax / total;
  altos = altos.map((a) => Math.max(1, Math.floor(a * escala)));
  return { ancho: Math.max(1, Math.round(ancho * escala)), altos };
}

/** Une las fotos en una imagen JPEG con el nombre de la primera («factura-2-paginas.jpg»). */
export async function unirFotos(files: File[]): Promise<File> {
  const bitmaps = await Promise.all(files.map((f) => createImageBitmap(f)));
  try {
    const { ancho, altos } = colocarPaginas(bitmaps.map((b) => ({ ancho: b.width, alto: b.height })));
    const canvas = document.createElement("canvas");
    canvas.width = ancho;
    canvas.height = altos.reduce((s, a) => s + a, 0);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Este navegador no puede unir las fotos.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let y = 0;
    bitmaps.forEach((b, i) => {
      ctx.drawImage(b, 0, y, ancho, altos[i]!);
      y += altos[i]!;
    });
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) throw new Error("No se pudieron unir las fotos.");
    const base = (files[0]!.name || "documento").replace(/\.[^.]+$/, "");
    return new File([blob], `${base}-${files.length}-paginas.jpg`, { type: "image/jpeg" });
  } finally {
    bitmaps.forEach((b) => b.close());
  }
}
