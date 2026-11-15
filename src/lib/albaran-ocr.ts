// Leer un albarán desde una foto, en el propio navegador: la foto no sale del dispositivo para leerla.
// El OCR corre en un Web Worker (public/ocr, ver scripts/build-ocr.mjs); aquí se prepara la imagen, se le
// pasa al worker y su texto se convierte en líneas con readAlbaran.

import { readAlbaran, type AlbaranRead, type OcrText } from "@/lib/albaran-reader";

/** Debe coincidir con OCR_VERSION de scripts/build-ocr.mjs. */
const OCR_VERSION = "2";
/** Lado mayor de la imagen que se lee: más grande no lee mejor y tarda bastante más. */
const MAX_SIDE = 1800;

type WorkerReply = { id: number; ok: true; texts: OcrText[] } | { id: number; ok: false; error: string };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (texts: OcrText[]) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(`/ocr/${OCR_VERSION}/worker.js`, { type: "module" });
  worker.onmessage = (e: MessageEvent<WorkerReply>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data.texts);
    else p.reject(new Error(e.data.error));
  };
  worker.onerror = () => {
    for (const p of pending.values()) p.reject(new Error("El lector de albaranes no se pudo cargar."));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** `turns`: cuartos de vuelta que se gira la foto antes de leerla (0 a 3). */
async function imageDataOf(file: Blob, turns: number): Promise<ImageData> {
  // createImageBitmap respeta la orientación de la foto (EXIF) del móvil.
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = turns % 2 ? h : w;
  canvas.height = turns % 2 ? w : h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Este navegador no puede preparar la foto.");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((turns * Math.PI) / 2);
  ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export type AlbaranPhotoRead = AlbaranRead & { texts: OcrText[] };

/** Texto y cajas que el OCR saca de una foto. El lector se descarga la primera vez y queda en caché. */
export async function ocrTextos(file: Blob, turns = 0): Promise<OcrText[]> {
  if (!file.type.startsWith("image/")) throw new Error("Para leer el documento hace falta una foto (JPG o PNG).");
  const image = await imageDataOf(file, turns);
  const w = getWorker();
  const id = nextId++;
  return new Promise<OcrText[]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, image: { data: image.data, width: image.width, height: image.height } }, [image.data.buffer]);
  });
}

export type Recuadro = { x: number; y: number; w: number; h: number };

/** Lee solo una zona de la foto (posición y tamaño de 0 a 1). Las zonas pequeñas se amplían para que el OCR lea bien. */
export async function ocrRecorte(file: Blob, rect: Recuadro): Promise<OcrText[]> {
  const bitmap = await createImageBitmap(file);
  const sx = Math.max(0, Math.min(bitmap.width - 1, Math.round(rect.x * bitmap.width)));
  const sy = Math.max(0, Math.min(bitmap.height - 1, Math.round(rect.y * bitmap.height)));
  const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round(rect.w * bitmap.width)));
  const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round(rect.h * bitmap.height)));
  const scale = Math.min(3, Math.max(1, 900 / Math.max(sw, sh)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Este navegador no puede preparar la foto.");
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("No se pudo preparar el recuadro.");
  return ocrTextos(blob, 0);
}

/** Lee la foto de un albarán. Si no sale ninguna línea, prueba con la foto girada (boca abajo o de lado). */
export async function readAlbaranPhoto(file: Blob): Promise<AlbaranPhotoRead> {
  let first: AlbaranPhotoRead | null = null;
  for (const turns of [0, 2, 1, 3]) {
    const texts = await ocrTextos(file, turns);
    const read = { ...readAlbaran(texts), texts };
    if (read.lines.length) return read;
    first ??= read;
  }
  return first!;
}

// Emparejar con lo nuestro -----------------------------------------------------------------------

const STOP = new Set(["de", "del", "la", "las", "el", "los", "con", "sin", "y", "en", "para", "por", "sl", "sa", "slu", "s.l", "s.a", "cb"]);
const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();
const words = (s: string) => norm(s).split(" ").filter((w) => w.length > 1 && !STOP.has(w));

/** Clave con la que se recuerda una línea de un proveedor: su referencia o, si no trae, la descripción. */
export function lineCode(line: { ref: string | null; description: string }): string | null {
  if (line.ref) return line.ref;
  const d = norm(line.description);
  return d ? `txt:${d.slice(0, 100)}` : null;
}

/** Proveedor cuyo nombre aparece en el albarán («CARNES EL CARPIO, S.L.» → Carnes El Carpio). */
export function guessSupplier<S extends { id: string; name: string }>(texts: OcrText[], suppliers: S[]): S | null {
  const all = ` ${norm(texts.map((t) => t.text).join(" "))} `;
  const compact = all.replace(/ /g, "");
  let best: { s: S; score: number } | null = null;
  for (const s of suppliers) {
    const ws = words(s.name).filter((w) => w.length >= 4);
    if (ws.length === 0) continue;
    const hits = ws.filter((w) => all.includes(` ${w} `) || compact.includes(w)).length;
    const score = hits / ws.length;
    if (score === 1 && (!best || ws.length > best.score)) best = { s, score: ws.length };
  }
  return best?.s ?? null;
}

const near = (x: string, y: string) => x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y.slice(0, 5)) || y.startsWith(x.slice(0, 5))));

/** Qué parte de las palabras de cada lado está en el otro (admitiendo plurales y erratas: «MOZZARELA» ≈ «Mozzarella»). */
function overlap(description: string, productName: string): [number, number] {
  const a = words(description);
  const b = words(productName);
  if (a.length === 0 || b.length === 0) return [0, 0];
  return [a.filter((x) => b.some((y) => near(x, y))).length / a.length, b.filter((y) => a.some((x) => near(x, y))).length / b.length];
}

/** Parecido de 0 a 1, en las dos direcciones: «COSTILLA DE CERDO» no es «Costilla de Atún para paella». */
export function nameMatch(description: string, productName: string): number {
  return Math.min(...overlap(description, productName));
}

/**
 * El producto que corresponde a lo escrito, solo si está claro: al menos la mitad de las palabras coinciden
 * en las dos direcciones y ningún otro candidato empata. Si no, null: lo elige la persona (y queda aprendido).
 */
export function bestProduct<P extends { name: string }>(description: string, products: P[]): P | null {
  const scored = products
    .map((p) => {
      const [x, y] = overlap(description, p.name);
      return { p, min: Math.min(x, y), score: Math.min(x, y) + 0.01 * Math.max(x, y) };
    })
    .sort((a, b) => b.score - a.score);
  const [first, second] = scored;
  if (!first || first.min < 0.5) return null;
  if (second && Math.abs(second.score - first.score) < 1e-9) return null;
  return first.p;
}

/** Palabras con las que buscar en el catálogo lo escrito en el albarán (el buscador exige todas). */
export function searchTerms(description: string): string[] {
  const ws = words(description).filter((w) => w.length >= 3 && !/^\d+$/.test(w));
  return [...new Set(ws.sort((a, b) => b.length - a.length).slice(0, 3).map((w) => w.slice(0, 5)))];
}

/**
 * Formato en el que viene la línea: el kilo (o el litro) si viene en kg, o si la cantidad lleva decimales
 * («0,600») y el producto se pesa o se mide; la unidad si viene por unidades. null si no se sabe.
 */
export function packForUnit<P extends { id: string; qty: string }>(packs: P[], dimension: string, unit: string | null, qty?: number): P | null {
  const byQty = (q: number) => packs.find((k) => Number(k.qty) === q) ?? null;
  const fractional = qty !== undefined && !Number.isInteger(qty);
  if (dimension === "mass" && ((unit && /^(kg|kgs|k)$/.test(unit)) || (!unit && fractional))) return byQty(1000);
  if (dimension === "volume" && ((unit && /^(l|lt|lts)$/.test(unit)) || (!unit && fractional))) return byQty(1000);
  if (dimension === "count" && unit && /^(ud|uds|u|un|und)$/.test(unit)) return byQty(1);
  return null;
}
