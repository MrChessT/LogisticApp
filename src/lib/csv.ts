// Lectura de CSV (exportaciones de Excel, Google Sheets o el TPV): separador «;» o «,» (o tabulador), comillas
// y saltos de línea dentro de las comillas. Devuelve filas de texto; la interpretación es de cada importador.
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const delimiter = detectDelimiter(clean);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** El separador que más aparece en la primera línea (fuera de comillas). */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  const counts = [";", ",", "\t"].map((d) => ({ d, n: firstLine.split(d).length }));
  return counts.sort((a, b) => b.n - a.n)[0]!.d;
}
