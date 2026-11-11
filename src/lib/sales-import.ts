// Ventas del TPV: lectura de la exportación diaria «Ventas» (la que genera tSpoonLab con el BDP).
//
// Cabecera con «Fecha venta», «Centro de coste» y «Nombre»; después una tabla con, entre otras, las
// columnas Descripción, Código, Cantidad, Unidad e Importe (sin IVA). La columna «Enviado» de tSpoonLab
// solo dice si allí estaba enlazado a un escandallo: aquí se importan todas las líneas, porque la venta
// del día es la suma de todas (el «Importe» de la cabecera solo suma las enlazadas).

type SaleLine = { code: string; name: string; qty: number; unit: string; amount: number };
export type ParsedSales = {
  /** AAAA-MM-DD */
  date: string | null;
  costCentre: string | null;
  source: string | null;
  lines: SaleLine[];
  total: number;
  issues: string[];
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** Fecha de Excel (número de días desde 1899-12-30) o «30/10/2026» → «2026-10-30». */
export function excelDate(raw: string | undefined): string | null {
  const s = clean(raw);
  const serial = Number(s);
  if (s && Number.isFinite(serial) && serial > 20000 && serial < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  }
  return null;
}

/** Número tal como lo guarda Excel («50.05») o escrito a mano («50,05»). */
function num(raw: string | undefined): number | null {
  const s = clean(raw).replace(/€/g, "").trim();
  if (!s) return null;
  const v = Number(/,\d{1,4}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(v) ? v : null;
}

/** Quita las comillas que el TPV deja en algunos nombres («"COPA PIEROLA "»). */
const nameOf = (raw: string | undefined) => clean((raw ?? "").replace(/^\s*"+|"+\s*$/g, ""));

export function parseSalesBook(rows: string[][]): ParsedSales | null {
  const headerIdx = rows.findIndex((r) => {
    const cells = r.map((c) => norm(c ?? ""));
    return cells.includes("descripcion") && cells.includes("codigo") && cells.includes("cantidad") && cells.includes("importe");
  });
  if (headerIdx < 0) return null;
  const header = rows[headerIdx]!.map((c) => norm(c ?? ""));
  const col = (name: string) => header.indexOf(name);
  const cDesc = col("descripcion"), cCode = col("codigo"), cQty = col("cantidad"), cUnit = col("unidad"), cAmount = col("importe");

  const meta = (label: string) => {
    const r = rows.slice(0, headerIdx).find((row) => row.some((c) => norm(c ?? "") === label));
    if (!r) return null;
    const i = r.findIndex((c) => norm(c ?? "") === label);
    return clean(r.slice(i + 1).find((c) => clean(c)) ?? "") || null;
  };

  const lines: SaleLine[] = [];
  const issues: string[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const name = nameOf(r[cDesc]);
    const code = clean(r[cCode]);
    if (!name && !code) continue;
    const qty = num(r[cQty]);
    const amount = num(r[cAmount]);
    if (!name || qty === null || amount === null) {
      issues.push(`Fila ${i + 1}: falta ${!name ? "la descripción" : qty === null ? "la cantidad" : "el importe"}; no se importa.`);
      continue;
    }
    // Sin código (raro), el nombre hace de código para poder enlazarlo igual.
    lines.push({ code: code || `nombre:${norm(name)}`.slice(0, 40), name, qty, unit: cUnit >= 0 ? clean(r[cUnit]) : "", amount: Math.round(amount * 10_000) / 10_000 });
  }
  const total = Math.round(lines.reduce((a, l) => a + l.amount, 0) * 100) / 100;
  return { date: excelDate(meta("fecha venta") ?? meta("fecha") ?? undefined), costCentre: meta("centro de coste"), source: meta("nombre"), lines, total, issues };
}

/** El local cuyo nombre aparece en el centro de coste («Parador del Mar Menor» → «Parador»). */
export function guessLocation<T extends { id: string; name: string }>(costCentre: string | null, locations: T[]): T | null {
  if (!costCentre) return null;
  const cc = ` ${norm(costCentre)} `;
  const hits = locations.filter((l) => cc.includes(` ${norm(l.name)} `));
  return hits.length === 1 ? hits[0]! : (hits.sort((a, b) => b.name.length - a.name.length)[0] ?? null);
}
