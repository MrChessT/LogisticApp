// Lector de albaranes y facturas a partir de su TEXTO, línea a línea (PDF, texto copiado o OCR ya ordenado).
// No depende de la geometría de la foto: cada línea se lee sola y los totales se comprueban entre ellos.
// Lo que no cuadra no se da por bueno: se marca para revisar con el motivo. Reglas en docs/lector-documentos.md.

import Decimal from "decimal.js";

type DocKind = "albaran" | "factura" | "desconocido";

export type DocLine = {
  ref: string | null;
  description: string;
  qty: string;
  unit: string | null;
  price: string;
  /** Descuento de la línea (%), si la tabla lo trae. */
  discountPct: string | null;
  /** IVA de la línea (%), si la tabla lo trae (albaranes con columna de IVA). */
  vatPct: string | null;
  amount: string;
};

type VatRow = { rate: string; vat: string };

export type DocRead = {
  kind: DocKind;
  number: string | null;
  date: string | null;
  lines: DocLine[];
  /** Suma de los importes de las líneas (antes de descuento de cabecera e IVA). */
  linesTotal: string;
  /** Subtotal que aparece en el documento. */
  subtotal: string | null;
  /** Descuento de cabecera (%), si lo hay. */
  discountPct: string | null;
  /** Base imponible que aparece en el documento. */
  base: string | null;
  vatRows: VatRow[];
  surcharge: string | null;
  total: string | null;
  /** cuadra: todo encaja · revisar: algo no encaja (ver issues) · sin_lineas: no se reconoce ninguna línea. */
  status: "cuadra" | "revisar" | "sin_lineas";
  issues: string[];
};

const D = (v: Decimal.Value) => new Decimal(v);
const money = (v: Decimal) => v.toDecimalPlaces(2).toFixed(2);
const TOL = D("0.011");

/** Un importe escrito de cualquiera de las formas habituales («1.234,56», «1,234.56», «100.00», «7 900,00 €»). */
export function parseNumber(raw: string): string | null {
  let t = raw.replace(/€|%/g, "").replace(/\beur(os)?\b/gi, "").trim();
  if (!/\d/.test(t)) return null;
  t = t.replace(/(\d) (?=\d{3}(?!\d))/g, "$1"); // «7 900,00» → «7900,00»
  if (!/^-?\d{1,3}([.,]\d{3})*([.,]\d{1,2})?$|^-?\d+([.,]\d{1,2})?$/.test(t)) return null;
  const negative = t.startsWith("-");
  t = t.replace(/^-/, "");
  const last = Math.max(t.lastIndexOf(","), t.lastIndexOf("."));
  const value = last >= 0 ? `${t.slice(0, last).replace(/[.,]/g, "")}.${t.slice(last + 1)}` : t;
  return (negative ? "-" : "") + value;
}

export function parseDate(raw: string): string | null {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[1])));
  if (d.getUTCMonth() !== Number(m[2]) - 1) return null;
  return d.toISOString().slice(0, 10);
}

const UNITS = new Set(["kg", "g", "l", "ml", "cl", "ud", "uds", "u", "un", "caja", "cajas", "cj", "pz", "paq", "bot"]);
const RE_TOTAL = /^(total|total albar[áa]n|total factura|total con iva|importe total)\b/i;
const RE_SUBTOTAL = /^(sub\s?total)\b/i;
// «B. Imponible» solo con el punto o con la palabra completa: «B / 1» es el número de albarán, no la base.
const RE_BASE = /^(base\b|b\.\s*imponible\b)/i;
const RE_BLOCK = /^b\.?\s*imponible\b.*\biva\b/i;
// «Vencimiento», «Vence el», «Vto.»: esa fecha es la de pago, no la del documento, y no se usa.
const RE_DUE_WORD = /\b(vencimiento|vence|vto\.?)\b/i;
const RE_DISCOUNT = /^(descuento|dto\.?)\b/i;
const RE_VAT = /^(i\.?\s?v\.?\s?a\.?|iva)\b/i;
const RE_SURCHARGE = /^recargo/i;

/** Separa una línea en palabras, importes y porcentajes. Los miles con espacio se pegan antes. */
function tokens(line: string): { words: string[]; nums: string[]; pcts: string[] } {
  // Solo se pegan los grupos de miles: un bloque de 1-3 cifras, un espacio y tres cifras, al principio de la
  // línea o tras un espacio, y seguido de decimales con coma o de € («7 900,00 €»). Con punto decimal («5 285.00»)
  // el espacio separa dos números. «100.00 100.00» no se toca.
  const joined = line.replace(/(^|\s)(\d{1,3}) (\d{3})(?=,\d{1,2}(?:\s|$)|\s?€|$)/g, "$1$2$3");
  const words: string[] = [];
  const nums: string[] = [];
  const pcts: string[] = [];
  for (const tok0 of joined.split(/\s+/).filter((t) => t && t !== "€")) {
    const tok = tok0.replace(/^\(|\)$/g, "");
    if (/%$/.test(tok)) {
      const p = parseNumber(tok);
      if (p !== null) pcts.push(p);
      else words.push(tok);
      continue;
    }
    const n = /\d/.test(tok) ? parseNumber(tok) : null;
    if (n !== null) nums.push(n);
    else words.push(tok);
  }
  return { words, nums, pcts };
}

const REF = /^(\d{4,}|[A-Za-z]{1,3}[-.]?\d{3,}[A-Za-z0-9-]*)$/;
const REF_LOOSE = /^(\d{1,6}|[A-Za-z]{1,3}[-.]?\d{2,}[A-Za-z0-9-]*)$/;

/**
 * Línea de producto. Formas admitidas (de izquierda a derecha, con la referencia y la descripción delante):
 *  · cantidad  precio  importe                       («1 Talla pequeña… 100.00 100.00»)
 *  · cantidad  precio  importe  %IVA  total          («100 6,00 € 600,00 € 10,00% 660,00 €»)
 *  · cantidad  precio  importe  %descuento  [...]    («… 2 10,00 € 20,00 € 10% 18,00 €»)
 * La comprobación es siempre cantidad × precio = importe (o × (1 − descuento) si hay descuento en la línea).
 */
export function productLine(text: string): DocLine | null {
  // Un código al principio («000113», «77») es la referencia, no un importe: si le sigue una palabra, se quita
  // y la línea se lee sin él. Así «77 Membrana … 12,00 25,00 5 285,00» no pierde el descuento.
  const coded = /^(\S+)\s+(\p{L}[\s\S]*)$/u.exec(text.trim());
  if (coded && REF_LOOSE.test(coded[1]!)) {
    const inner = productLine(coded[2]!);
    if (inner) return { ...inner, ref: coded[1]! };
  }
  const { words, nums, pcts } = tokens(text);
  const ref = words.length && REF.test(words[0]!) ? words[0]! : null;
  const unitIdx = words.findIndex((w) => UNITS.has(w.toLowerCase()));
  const unit = unitIdx >= 0 ? words[unitIdx]!.toLowerCase() : null;
  const desc = words.filter((w, i) => w !== ref && i !== unitIdx).join(" ").trim();

  if (nums.length >= 4 && pcts.length >= 1) {
    // Columna de IVA: total = importe × (1 + IVA). Así un «10%» no se confunde con un descuento.
    const [q, p, a, t] = nums.slice(-4).map((n) => D(n)) as [Decimal, Decimal, Decimal, Decimal];
    const iva = D(pcts[0]!);
    if (q.mul(p).minus(a).abs().lte(TOL.plus(a.abs().mul("0.0005"))) && a.mul(D(1).plus(iva.div(100))).minus(t).abs().lte(TOL.plus(t.abs().mul("0.0005")))) {
      return { ref, description: desc, qty: nums.at(-4)!, unit, price: nums.at(-3)!, discountPct: null, vatPct: pcts[0]!, amount: nums.at(-2)! };
    }
  }
  if (nums.length >= 4 && pcts.length >= 1) {
    // Columna de descuento: cantidad × precio × (1 − dto) = importe.
    const [q, p, , a] = nums.slice(-4).map((n) => D(n)) as [Decimal, Decimal, Decimal, Decimal];
    const dto = D(pcts[0]!);
    const net = q.mul(p).mul(D(1).minus(dto.div(100)));
    if (net.minus(a).abs().lte(TOL.plus(a.abs().mul("0.0005")))) {
      return { ref, description: desc, qty: nums.at(-4)!, unit, price: nums.at(-3)!, discountPct: pcts[0]!, vatPct: null, amount: nums.at(-1)! };
    }
  }
  if (nums.length >= 4 && pcts.length === 0) {
    // Columna «Dto» sin símbolo: cantidad × precio × (1 − dto) = importe (dto entero entre 0 y 100).
    const [q, p, dto, a] = nums.slice(-4).map((n) => D(n)) as [Decimal, Decimal, Decimal, Decimal];
    if (dto.gt(0) && dto.lt(100) && dto.isInteger() && q.mul(p).mul(D(1).minus(dto.div(100))).minus(a).abs().lte(TOL.plus(a.abs().mul("0.0005")))) {
      return { ref, description: desc, qty: nums.at(-4)!, unit, price: nums.at(-3)!, discountPct: nums.at(-2)!, vatPct: null, amount: nums.at(-1)! };
    }
  }
  if (nums.length >= 3) {
    const [q, p, a] = nums.slice(-3).map((n) => D(n)) as [Decimal, Decimal, Decimal];
    if (q.mul(p).minus(a).abs().lte(TOL.plus(a.abs().mul("0.0005")))) {
      return { ref, description: desc, qty: nums.at(-3)!, unit, price: nums.at(-2)!, discountPct: null, vatPct: null, amount: nums.at(-1)! };
    }
  }
  return leadingQtyLine(text);
}

/**
 * Cantidad al principio y números dentro de la descripción: «6 Tónica botella 20 cl 0,80 4,80», «2 Hielo bolsa 10 kg
 * 3,10 6,20». La cantidad es el primer número; precio e importe, los dos últimos; lo de en medio («20 cl») es parte de
 * la descripción. Solo vale si cantidad × precio = importe, como el resto de formas.
 */
function leadingQtyLine(text: string): DocLine | null {
  const toks = text.trim().split(/\s+/).filter((t) => t !== "€");
  if (toks.length < 4) return null;
  const qty = parseNumber(toks[0]!);
  const price = parseNumber(toks.at(-2)!);
  const amount = parseNumber(toks.at(-1)!);
  if (qty === null || price === null || amount === null || /%$/.test(toks.at(-2)!)) return null;
  if (D(qty).mul(price).minus(amount).abs().gt(TOL.plus(D(amount).abs().mul("0.0005")))) return null;
  let middle = toks.slice(1, -2);
  // «6 cajas Tónica…»: la unidad va justo detrás de la cantidad; la de «20 cl» es de la descripción.
  const unit = middle.length > 1 && UNITS.has(middle[0]!.toLowerCase()) ? middle[0]!.toLowerCase() : null;
  if (unit) middle = middle.slice(1);
  const description = middle.join(" ").trim();
  if (!/\p{L}/u.test(description)) return null;
  return { ref: null, description, qty, unit, price, discountPct: null, vatPct: null, amount };
}

export function readDocumentText(text: string): DocRead {
  const rawLines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const issues: string[] = [];
  const head = rawLines.slice(0, 12).join(" ");
  const kind: DocKind = /albar[áa]n/i.test(head) ? "albaran" : /factura/i.test(head) ? "factura" : /albar[áa]n/i.test(text) ? "albaran" : /factura/i.test(text) ? "factura" : "desconocido";

  let number: string | null = null;
  let date: string | null = null;
  // «Factura ES-001», «Albarán 2024/117»: el número va justo después de la palabra.
  for (const l of rawLines.slice(0, 15)) {
    const h = /(?:factura|albar[áa]n)\s+(?:n[º°.]?\s*)?([A-Za-z]{0,4}[-/]?\d[\w/-]*)/i.exec(l);
    if (!number && h) number = h[1]!;
  }
  for (const l of rawLines) {
    const m = /(?:n[º°.]?\s*(?:de\s*)?(?:albar[áa]n|factura)|n[º°]|n[úu]mero)\s*[:.]?\s*([A-Za-z0-9/.-]*\d[A-Za-z0-9/.-]*)/i.exec(l);
    if (!number && m) number = m[1]!;
    const d = /fecha[^\d]*(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/i.exec(l);
    if (!date && d && !RE_DUE_WORD.test(l)) date = parseDate(d[1]!);
  }
  if (!date) for (const l of rawLines) {
    if (RE_DUE_WORD.test(l)) continue;
    const d = /(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/.exec(l);
    const iso = d ? parseDate(d[1]!) : null;
    if (iso) { date = iso; break; }
  }

  const lines: DocLine[] = [];
  let subtotal: string | null = null;
  let discountPct: string | null = null;
  let base: string | null = null;
  let surcharge: string | null = null;
  let total: string | null = null;
  const vatRows: VatRow[] = [];
  let pendingVatRate: string | null = null;
  let pendingLabel: "subtotal_descuento" | "bloque" | "total" | null = null;

  for (const l of rawLines) {
    const { words, nums, pcts } = tokens(l);
    if (pendingLabel === "subtotal_descuento") {
      // «Subtotal Descuento» en una línea y «2.800,00 € 15,0%» en la siguiente.
      pendingLabel = null;
      if (nums.length && pcts.length) { subtotal = nums[0]!; discountPct = pcts[0]!; continue; }
    }
    if (words.length === 0 && nums.length === 1 && pendingVatRate !== null) {
      // Cuota de IVA suelta debajo de su etiqueta («Subtotal IVA 21%» → «34,65»).
      vatRows.push({ rate: pendingVatRate, vat: nums[0]! });
      pendingVatRate = null;
      continue;
    }
    if (pendingLabel === "bloque") {
      // «B. Imponible IVA Total Albarán» y debajo «7.711,87 € (21.00%) 1.619,49 €»; el total va en la línea siguiente.
      pendingLabel = null;
      if (pcts.length === 1 && nums.length === 2 && words.length === 0) {
        base = nums[0]!;
        vatRows.push({ rate: pcts[0]!, vat: nums[1]! });
        pendingLabel = "total";
        continue;
      }
    }
    if (pendingLabel === "total") {
      // «Total Albarán» en una línea y su importe en la siguiente.
      pendingLabel = null;
      if (nums.length && words.length === 0) { total = nums.at(-1)!; continue; }
    }
    if (RE_TOTAL.test(l)) {
      if (nums.length) total = nums.at(-1)!;
      else if (/^total( albar[áa]n| factura)?\s*:?\s*$/i.test(l)) pendingLabel = "total";
      continue;
    }
    if (RE_SUBTOTAL.test(l)) {
      if (/descuento/i.test(l) && !nums.length) { pendingLabel = "subtotal_descuento"; continue; }
      if (nums.length) subtotal = nums[0]!;
      if (pcts.length && /iva/i.test(l)) { pendingVatRate = pcts[0]!; if (nums.length === 2) { vatRows.push({ rate: pcts[0]!, vat: nums.at(-1)! }); pendingVatRate = null; } }
      else if (pcts.length) discountPct = pcts[0]!;
      continue;
    }
    if (RE_BLOCK.test(l) && !nums.length) { pendingLabel = "bloque"; continue; }
    if (RE_BASE.test(l)) { if (nums.length) base = nums.at(-1)!; continue; }
    if (RE_DISCOUNT.test(l)) { if (pcts.length) discountPct = pcts[0]!; continue; }
    if (RE_SURCHARGE.test(l)) { if (nums.length) surcharge = nums.at(-1)!; continue; }
    if (RE_VAT.test(l)) {
      if (pcts.length && nums.length) vatRows.push({ rate: pcts[0]!, vat: nums.at(-1)! });
      else if (pcts.length) pendingVatRate = pcts[0]!;
      continue;
    }
    // Tabla de tipos sin etiqueta: «10,00% 280,00 €».
    if (pcts.length === 1 && nums.length === 1 && words.length === 0) { vatRows.push({ rate: pcts[0]!, vat: nums[0]! }); continue; }
    const p = productLine(l);
    if (p) lines.push(p);
  }

  const linesTotal = money(lines.reduce((s, x) => s.plus(x.amount), D(0)));
  if (!lines.length) issues.push("No se reconoce ninguna línea de producto.");
  if (subtotal !== null && lines.length && D(subtotal).minus(linesTotal).abs().gt(TOL)) {
    issues.push(`Las líneas suman ${linesTotal} y el subtotal del documento es ${money(D(subtotal))}.`);
  }
  // Sin subtotal escrito, la base se compara con lo que suman las líneas (menos el descuento de cabecera): si no, una
  // línea que no se ha leído pasaría por buena.
  if (subtotal === null && base !== null && lines.length) {
    const exp = discountPct !== null ? D(linesTotal).minus(D(linesTotal).mul(discountPct).div(100)) : D(linesTotal);
    if (exp.minus(base).abs().gt(TOL)) issues.push(`Las líneas suman ${linesTotal}${discountPct !== null ? ` (con el descuento, ${money(exp)})` : ""} y la base imponible es ${money(D(base))}.`);
  }
  // Base imponible: subtotal menos descuento de cabecera (si la base no viene escrita).
  const sub = subtotal !== null ? D(subtotal) : lines.length ? D(linesTotal) : null;
  let expectedBase: Decimal | null = base !== null ? D(base) : sub;
  if (base === null && sub !== null && discountPct !== null) expectedBase = sub.minus(sub.mul(discountPct).div(100));
  if (base !== null && sub !== null && discountPct !== null) {
    const exp = sub.minus(sub.mul(discountPct).div(100));
    if (exp.minus(base).abs().gt(TOL)) issues.push(`Subtotal menos descuento ${discountPct} % es ${money(exp)} y la base leída es ${money(D(base))}.`);
  }
  const vatSum = vatRows.length ? vatRows.reduce((s, r) => s.plus(r.vat), D(0)) : null;
  for (const r of vatRows) {
    if (expectedBase !== null && vatRows.length === 1 && base !== null) {
      const exp = D(base).mul(r.rate).div(100);
      if (exp.minus(r.vat).abs().gt(TOL)) issues.push(`IVA ${r.rate} %: ${money(exp)} esperado y ${money(D(r.vat))} leído.`);
    }
  }
  if (total !== null && expectedBase !== null && vatSum !== null) {
    const exp = expectedBase.plus(vatSum).plus(surcharge !== null ? D(surcharge) : 0);
    if (exp.minus(total).abs().gt(TOL)) issues.push(`Base + IVA${surcharge !== null ? " + recargo" : ""} es ${money(exp)} y el total leído es ${money(D(total))}.`);
  }
  if (total === null) issues.push("No se lee el total del documento.");

  const status: DocRead["status"] = !lines.length ? "sin_lineas" : issues.length ? "revisar" : "cuadra";
  return { kind, number, date, lines, linesTotal, subtotal, discountPct, base, vatRows, surcharge, total, status, issues };
}
