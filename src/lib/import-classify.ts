// Qué contiene cada hoja (o cada CSV) que se sube: catálogo, escandallos o ventas del TPV. Se reconoce por
// las hojas y cabeceras que ya esperan los importadores, así que lo que se clasifica aquí es exactamente lo que
// luego se importa. Lo que no encaja queda como «desconocido»: lo pregunta el asistente, no se adivina.
import { parseCsv } from "./csv";
import { parseEscandalloBook } from "./recipe-import";
import { parseSalesBook } from "./sales-import";

export type ImportKind = "catalogo" | "escandallos" | "ventas" | "desconocido";

export interface ClassifiedSheet {
  /** Nombre de la hoja (o del archivo CSV). */
  sheet: string;
  kind: ImportKind;
  /** Filas con datos (sin contar cabeceras, según cada importador). */
  rows: number;
  /** Por qué se clasifica así, en una frase para el asistente. */
  reason: string;
}

const CATALOG_SHEETS = new Set(["proveedores", "productos", "surtido"]);

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Clasifica las hojas de un libro (nombre → filas). */
export function classifySheets(sheets: Record<string, string[][]>): ClassifiedSheet[] {
  return Object.entries(sheets).map(([sheet, rows]) => classifyRows(sheet, rows));
}

/** Clasifica un CSV: una sola hoja, con el nombre del archivo. */
export function classifyCsv(fileName: string, text: string): ClassifiedSheet {
  return classifyRows(fileName.replace(/\.csv$/i, ""), parseCsv(text));
}

function classifyRows(sheet: string, rows: string[][]): ClassifiedSheet {
  if (CATALOG_SHEETS.has(norm(sheet))) {
    return { sheet, kind: "catalogo", rows: Math.max(0, rows.length - 1), reason: `La hoja se llama «${sheet}»: es una hoja del catálogo.` };
  }
  const sales = parseSalesBook(rows);
  if (sales) return { sheet, kind: "ventas", rows: sales.lines.length, reason: "Tiene las columnas de ventas del TPV (descripción, código, cantidad, importe)." };
  const recipes = parseEscandalloBook(rows);
  if (recipes.format === "escandallo" && recipes.recipes.length > 0) {
    return { sheet, kind: "escandallos", rows: recipes.recipes.length, reason: `Tiene la ficha de ${recipes.recipes.length} escandallo(s) (descripción y alérgenos).` };
  }
  return { sheet, kind: "desconocido", rows: rows.length, reason: "No reconozco sus columnas: hay que decir qué es." };
}

export interface ImportPackage {
  /** Cuántas hojas o CSV hay de cada tipo. */
  counts: Record<ImportKind, number>;
  /** Lo que el asistente tiene que preguntar antes de guardar: cada hoja que no se reconoce. */
  questions: Array<{ sheet: string; file: string }>;
}

/** Resumen del paquete de importación a partir de los archivos clasificados (archivo → hojas). */
export function buildImportPackage(files: Array<{ file: string; sheets: ClassifiedSheet[] }>): ImportPackage {
  const counts: Record<ImportKind, number> = { catalogo: 0, escandallos: 0, ventas: 0, desconocido: 0 };
  const questions: ImportPackage["questions"] = [];
  for (const { file, sheets } of files) {
    for (const s of sheets) {
      counts[s.kind] += 1;
      if (s.kind === "desconocido") questions.push({ sheet: s.sheet, file });
    }
  }
  return { counts, questions };
}
