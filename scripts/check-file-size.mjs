// Control de tamaño de los ficheros de código: ninguno nuevo pasa de LIMIT líneas, y los que ya lo
// superaban (BASELINE) no pueden crecer. Cuando uno de la lista baja, hay que bajar su tope aquí
// (o quitarlo si ya cabe): así el orden se mantiene solo. Se ejecuta en CI y en `npm run check`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const LIMIT = 600;

/** Ficheros que ya superaban el límite, con su tope actual. Objetivo: vaciar esta lista. */
const BASELINE = {
  "src/app/productos/product-editor.tsx": 880,
  "src/components/operations/operations-page.tsx": 811,
  "src/copiloto/drafts/catalog-builder.ts": 633,
  "src/copiloto/tools/tools.ts": 770,
};

const SKIP = /(\.test\.tsx?$|__tests__|database\.types\.ts$)/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.tsx?$/.test(name) && !SKIP.test(path)) yield path;
  }
}

const problems = [];
const shrunk = [];
for (const path of walk("src")) {
  // En Windows las rutas llevan «\» y la lista de excepciones usa «/».
  const file = path.replaceAll("\\", "/");
  const lines = readFileSync(path, "utf8").split("\n").length;
  const allowed = BASELINE[file] ?? LIMIT;
  if (lines > allowed) problems.push(`${file}: ${lines} líneas (tope ${allowed})`);
  else if (BASELINE[file] && lines <= LIMIT) shrunk.push(`${file} ya cabe en ${LIMIT}: quítalo de BASELINE`);
  else if (BASELINE[file] && lines < BASELINE[file] - 40) shrunk.push(`${file} ha bajado a ${lines}: baja su tope en BASELINE`);
}

for (const note of shrunk) console.log(`· ${note}`);
if (problems.length > 0) {
  console.error(`✗ Ficheros demasiado grandes (límite ${LIMIT} líneas). Sepáralos en piezas con una responsabilidad:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`✓ Tamaño de ficheros dentro del límite (${LIMIT} líneas; ${Object.keys(BASELINE).length} excepciones heredadas).`);
