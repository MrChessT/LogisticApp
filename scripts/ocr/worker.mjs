// Lector de albaranes en un Web Worker: OCR (PP-OCRv4 en ONNX) sin DOM, con OffscreenCanvas.
import Ocr, { registerBackend, FileUtilsBase, ImageRawBase } from "@gutenye/ocr-common";
import { splitIntoLineImages } from "@gutenye/ocr-common/splitIntoLineImages";
import * as ort from "onnxruntime-web/wasm";

const BASE = new URL(".", self.location.href).href;
ort.env.wasm.wasmPaths = BASE;
ort.env.wasm.numThreads = 1;

class FileUtils extends FileUtilsBase {
  static async read(url) { return (await fetch(url)).text(); }
}
class ImageRaw extends ImageRawBase {
  #canvas;
  static async open() { throw new Error("open no se usa en el worker"); }
  constructor({ data, width, height }) {
    const copy = Uint8ClampedArray.from(data);
    super({ data: copy, width, height });
    this.#canvas = new OffscreenCanvas(width, height);
    this.#canvas.getContext("2d").putImageData(new ImageData(copy, width, height), 0, 0);
    this.data = copy;
  }
  async write() {}
  async drawBox() { return this; }
  async resize({ width, height }) {
    const w = Math.round(width || (this.width / this.height) * height);
    const h = Math.round(height || (this.height / this.width) * width);
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext("2d");
    ctx.drawImage(this.#canvas, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h);
    this.#canvas = c; this.data = d.data; this.width = w; this.height = h;
    return this;
  }
}
registerBackend({ FileUtils, ImageRaw, InferenceSession: ort.InferenceSession, splitIntoLineImages });

let ready;
function engine() {
  ready ??= Ocr.create({ models: { detectionPath: BASE + "det.onnx", recognitionPath: BASE + "rec.onnx", dictionaryPath: BASE + "keys.txt" } });
  return ready;
}
self.onmessage = async (e) => {
  const { id, image } = e.data;
  try {
    const t0 = performance.now();
    const ocr = await engine();
    const t1 = performance.now();
    const r = await ocr.detect({ data: image.data, width: image.width, height: image.height });
    self.postMessage({ id, ok: true, init: Math.round(t1 - t0), ms: Math.round(performance.now() - t1), width: r.resizedImageWidth, height: r.resizedImageHeight, texts: r.texts.map((t) => ({ text: t.text, box: t.box, mean: t.mean })) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
