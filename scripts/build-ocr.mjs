// Prepara el lector de albaranes en public/ocr/<versión>/ (no se versiona en git): el Web Worker con el
// OCR (PP-OCRv4 en ONNX), los modelos y el WebAssembly de onnxruntime. Se ejecuta antes de `next dev` y
// de `next build`. Si cambian los modelos o las librerías, sube OCR_VERSION (y la de src/lib/albaran-ocr.ts)
// para que los navegadores no usen la copia vieja.
import { build } from "esbuild";
import { copyFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { conEspacios } from "./ocr/espacios.mjs";

const OCR_VERSION = "2";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "ocr", OCR_VERSION);
// Las rutas dentro de node_modules (estos paquetes no exportan sus ficheros de datos).
const models = join(root, "node_modules", "@gutenye", "ocr-models", "assets");
const ort = join(root, "node_modules", "onnxruntime-web", "dist");

await rm(join(root, "public", "ocr"), { recursive: true, force: true });
await mkdir(out, { recursive: true });
await Promise.all([
  copyFile(join(models, "ch_PP-OCRv4_det_infer.onnx"), join(out, "det.onnx")),
  copyFile(join(models, "ch_PP-OCRv4_rec_infer.onnx"), join(out, "rec.onnx")),
  copyFile(join(models, "ppocr_keys_v1.txt"), join(out, "keys.txt")),
  copyFile(join(ort, "ort-wasm-simd-threaded.wasm"), join(out, "ort-wasm-simd-threaded.wasm")),
  copyFile(join(ort, "ort-wasm-simd-threaded.mjs"), join(out, "ort-wasm-simd-threaded.mjs")),
]);
let patched = false;
await build({
  entryPoints: [join(root, "scripts", "ocr", "worker.mjs")],
  outfile: join(out, "worker.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  minify: true,
  // OpenCV trae ramas para Node que en el navegador nunca se ejecutan.
  external: ["path", "fs", "crypto"],
  logLevel: "error",
  // El reconocedor de la librería pega las palabras: se compila con el parche que recupera los espacios.
  plugins: [{
    name: "espacios-ocr",
    setup(b) {
      b.onLoad({ filter: /ocr-common[\\/]build[\\/]models[\\/]Recognition\.js$/ }, async (args) => {
        patched = true;
        return { contents: conEspacios(await readFile(args.path, "utf8")), loader: "js" };
      });
    },
  }],
});
if (!patched) throw new Error("El worker del OCR se ha compilado sin el parche de espacios (no se ha encontrado Recognition.js).");
const size = (await stat(join(out, "worker.js"))).size;
console.log(`Lector de albaranes listo en public/ocr/${OCR_VERSION} (worker ${(size / 1e6).toFixed(1)} MB)`);
