// Lee las líneas de un albarán a partir del texto que devuelve el OCR (cada trozo con su caja en la foto).
//
// No depende del diseño de cada proveedor ni de palabras clave: una línea es cualquier trío de números
// alineados (de izquierda a derecha) que cumple cantidad × precio = importe (o con un % de descuento en
// medio). La base es el número que coincide con la suma de las líneas, el IVA es esa base al 21/10/5/4 %
// y el total, base + IVA. Si algo se lee mal, las cuentas no cuadran y la recepción sale marcada para
// revisar: nunca se cuela un dato malo sin avisar.

export type OcrText = { text: string; box: number[][] };

type AlbaranLine = {
  /** Referencia del proveedor (su código de artículo), si la trae. */
  ref: string | null;
  description: string;
  qty: number;
  unit: string | null;
  price: number;
  discountPct: number | null;
  amount: number;
  lot: string | null;
};

export type AlbaranRead = {
  lines: AlbaranLine[];
  linesTotal: number;
  base: number | null;
  /** Tipo de IVA, si es uno solo de los habituales; con varios tipos mezclados, null (la cuota sí se lee). */
  vatRate: number | null;
  vat: number | null;
  total: number | null;
  /** Descuento de cabecera (%): la base es la suma de las líneas menos este descuento. */
  headerDiscountPct: number | null;
  /** cuadra: líneas = base y base + IVA = total · parcial: las líneas suman la base pero no se ve el total ·
   *  no_cuadra: algo no encaja · sin_lineas: no se ha reconocido ninguna línea. */
  status: "cuadra" | "parcial" | "no_cuadra" | "sin_lineas";
  /** Fecha del albarán (AAAA-MM-DD), si aparece una razonable. */
  date: string | null;
};

type Pt = { x: number; y: number };
type Token = { text: string; x: number; y: number; box: number };
type Num = Token & { value: number };

const VAT_RATES = [21, 10, 5, 4, 2];
const UNITS = new Set(["kg", "kgs", "k", "g", "gr", "ud", "uds", "u", "un", "und", "l", "lt", "lts", "cl", "ml", "caja", "cajas", "cj", "pz", "paq", "bot"]);

/** «1.234,56» → 1234.56 · «12,950» → 12.95 · «7.77» → 7.77 · «1O,5» → 10.5. Lo que no es un número, null. */
export function parseAmount(raw: string): number | null {
  let t = raw.trim();
  if (!/\d/.test(t)) return null;
  t = t.replace(/[oO](?=[\d.,]|$)/g, "0").replace(/(?<=\d)[oO]/g, "0");
  if (!/^\d{1,3}([.,]\d{3})*([.,]\d{1,3})?$|^\d+([.,]\d{1,3})?$/.test(t)) return null;
  // El último separador es el decimal («12,950» → 12,95; «1.234,56» → 1234,56). Un «1.250» suelto es
  // ambiguo; en un albarán manda el decimal (1,25 kg), y si fuera otra cosa las cuentas no cuadrarían.
  const last = Math.max(t.lastIndexOf(","), t.lastIndexOf("."));
  if (last >= 0) return Number(`${t.slice(0, last).replace(/[.,]/g, "")}.${t.slice(last + 1)}`);
  return Number(t);
}

function edgeMids(box: number[][]): { left: Pt; right: Pt; height: number } {
  const pts = box.map(([x, y]) => ({ x: x!, y: y! })).sort((a, b) => a.x - b.x);
  const [a, b, c, d] = pts as [Pt, Pt, Pt, Pt];
  const left = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const right = { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 };
  return { left, right, height: (Math.abs(a.y - b.y) + Math.abs(c.y - d.y)) / 2 };
}

/** Parte cada trozo en palabras y sitúa cada una a lo largo de su caja (la caja puede estar inclinada). */
function tokenize(texts: OcrText[]): { tokens: Token[]; height: number } {
  const tokens: Token[] = [];
  const heights: number[] = [];
  texts.forEach((t, boxIndex) => {
    if (!t.box || t.box.length < 4) return;
    const { left, right, height } = edgeMids(t.box);
    heights.push(height);
    const text = t.text
      .replace(/(\d):(\d{2})(?!\d)/g, "$1,$2") // «8:90» es 8,90 mal leído
      .replace(/(\d)([.,]) (\d{2,3})(?![\d.,])/g, "$1$2$3") // «0, 600» es 0,600 partido por el OCR
      .replace(/[€:;|＊*（）()[\]]/g, " ")
      .replace(/(^|\s)-(?=\d)/g, "$1") // «-420,00» (un descuento) cuenta como 420,00
      // Solo se separa la unidad pegada a la cantidad («2,100kg») y el importe pegado a su etiqueta («IVA3,13»):
      // «DN50» o «359GCu» son parte de la descripción.
      .replace(/(\d)(kgs?|gr|uds?|und|lts?|cl|ml)(?![A-Za-z])/gi, "$1 $2")
      .replace(/([A-Za-zÁÉÍÓÚÑáéíóúñ]{2,})(\d+[.,]\d)/g, "$1 $2");
    const len = Math.max(1, text.length);
    let pos = 0;
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const at = text.indexOf(word, pos);
      pos = at + word.length;
      const f = (at + word.length / 2) / len;
      tokens.push({ text: word, x: left.x + f * (right.x - left.x), y: left.y + f * (right.y - left.y), box: boxIndex });
    }
  });
  heights.sort((a, b) => a - b);
  return { tokens, height: heights[Math.floor(heights.length / 2)] ?? 20 };
}

const REF = /^(\d{4,}|[A-Z]{1,3}[-.]?\d{3,}[A-Z0-9-]*)$/;
const isLot = (t: string) => /^\d{6,}$/.test(t) || /^L[-.]?\d{3,}$/i.test(t);
const close = (a: number, b: number, tol = 0.011) => Math.abs(a - b) <= tol;
const round2 = (n: number) => Math.round(n * 100) / 100;

function isoDate(tokens: Token[]): string | null {
  const today = new Date();
  for (const t of tokens) {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t.text);
    if (!m) continue;
    const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const d = new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[1])));
    if (d.getUTCMonth() !== Number(m[2]) - 1) continue;
    // Una fecha futura (más allá de mañana) o de hace más de un año no es la del albarán.
    const days = (d.getTime() - today.getTime()) / 86_400_000;
    if (days > 1 || days < -366) continue;
    return d.toISOString().slice(0, 10);
  }
  return null;
}

const REF_HEADER = /^(ref\.?|referencia|c[oó]d\.?|c[oó]digo)$/i;
const COLUMN_HEADER = /^(cant|precio|importe|descrip|art[ií]c)/i;

/**
 * Columna de la referencia según la cabecera de la tabla («Ref.», «Referencia», «Cód. artículo»…): va desde esa
 * cabecera hasta la de la descripción (a mitad de camino entre las dos). Solo cuenta una cabecera que esté en
 * la misma fila que otras columnas de la tabla, para no confundirla con un «Cód. cliente» suelto. null si el
 * albarán no trae cabecera: entonces la referencia se deduce de lo que hay a la izquierda de cada línea.
 */
function refColumn(tokens: Token[], h: number, firstLineY: number): { from: number; to: number } | null {
  const above = tokens.filter((t) => t.y < firstLineY - 0.5 * h);
  for (const head of above.filter((t) => REF_HEADER.test(t.text))) {
    const row = above.filter((t) => Math.abs(t.y - head.y) < 0.6 * h);
    if (!row.some((t) => COLUMN_HEADER.test(t.text))) continue;
    const desc = row.find((t) => /^descrip/i.test(t.text));
    return desc ? { from: head.x - 2 * h, to: (head.x + desc.x) / 2 } : { from: head.x - 2 * h, to: head.x + 3 * h };
  }
  return null;
}

export function readAlbaran(texts: OcrText[]): AlbaranRead {
  const { tokens, height: h } = tokenize(texts);
  const nums: Num[] = [];
  for (const t of tokens) {
    if (isLot(t.text) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(t.text)) continue;
    const value = parseAmount(t.text);
    if (value !== null) nums.push({ ...t, value });
  }

  // 1) Líneas: cantidad × precio (× (1 − dto)) = importe, alineados en la foto.
  type Cand = { dev: number; q: Num; p: Num; d: Num | null; a: Num; implied?: number };
  const cands: Cand[] = [];
  const aligned = (q: Num, mid: Num, a: Num) => {
    if (!(q.x < mid.x && mid.x < a.x)) return null;
    const yExp = q.y + ((a.y - q.y) * (mid.x - q.x)) / (a.x - q.x);
    const dev = Math.abs(mid.y - yExp) + Math.max(0, Math.abs(a.y - q.y) - 0.1 * (a.x - q.x));
    return dev <= 0.8 * h ? dev : null;
  };
  for (const q of nums) {
    if (q.value <= 0) continue;
    for (const p of nums) {
      if (p === q || p.value <= 0 || p.x <= q.x) continue;
      for (const a of nums) {
        // Un importe siempre lleva céntimos («14,60»): así un «8» o un «10» sueltos no pasan por importe.
        if (a === q || a === p || a.value <= 0 || a.x <= p.x || !/[.,]\d{2}$/.test(a.text)) continue;
        const exact = q.value * p.value;
        const tol = Math.max(0.011, a.value * 0.0005);
        if (close(exact, a.value, tol)) {
          const dev = aligned(q, p, a);
          // Un «1 × X = X» suelto solo cuenta si la cantidad está a la izquierda del precio en su renglón.
          if (dev !== null) cands.push({ dev, q, p, d: null, a });
          continue;
        }
        let explicit = false;
        for (const d of nums) {
          if (d === q || d === p || d === a || d.value <= 0 || d.value >= 100 || !(p.x < d.x && d.x < a.x)) continue;
          if (!close(exact * (1 - d.value / 100), a.value, tol)) continue;
          const dev = aligned(q, p, a);
          // Con descuento solo si no hay lectura sin él: la columna del IVA (10, 21) también cae en medio.
          if (dev !== null && aligned(q, d, a) !== null) { cands.push({ dev: dev + h, q, p, d, a }); explicit = true; }
        }
        // El OCR a veces no lee la columna «Dto»: si el importe es el bruto menos un % entero (1 a 60), es un
        // descuento. Es la lectura de menor prioridad y, si es falsa, los totales no cuadran.
        const pct = Math.round((1 - a.value / exact) * 100);
        if (!explicit && pct >= 1 && pct <= 60 && close(exact * (1 - pct / 100), a.value, tol)) {
          const dev = aligned(q, p, a);
          // Solo con cantidad, precio e importe seguidos: un número en medio en su renglón sería otra columna.
          const between = nums.some((m) => m !== q && m !== p && m !== a && m.x > q.x && m.x < a.x && aligned(q, m, a) !== null);
          if (dev !== null && !between) cands.push({ dev: dev + 2 * h, q, p, d: null, a, implied: pct });
        }
      }
    }
  }
  const used = new Set<Num>();
  const picked: Cand[] = [];
  for (const c of cands.sort((x, y) => x.dev - y.dev)) {
    if (used.has(c.q) || used.has(c.p) || used.has(c.a) || (c.d && used.has(c.d))) continue;
    [c.q, c.p, c.a, ...(c.d ? [c.d] : [])].forEach((n) => used.add(n));
    picked.push(c);
  }
  picked.sort((x, y) => x.q.y - y.q.y);

  // 2) Descripción y referencia: lo escrito a la izquierda de la cantidad, en su renglón.
  const qtyColumn = picked.length ? Math.min(...picked.map((c) => c.q.x)) : 0;
  const slopeOf = (c: Cand) => (c.a.y - c.q.y) / (c.a.x - c.q.x);
  const refCol = picked.length ? refColumn(tokens, h, Math.min(...picked.map((c) => c.q.y))) : null;
  const lines: AlbaranLine[] = picked.map((c) => {
    const slope = slopeOf(c);
    const near = (t: Token) => Math.abs(t.y - (c.q.y + slope * (t.x - c.q.x))) < 0.6 * h;
    const words = tokens.filter((t) => t.x < c.q.x - 2 && near(t) && !used.has(t as Num)).sort((a, b) => a.x - b.x);
    // Con cabecera de referencia, el código es lo que cae bajo ella (puede no haber ninguno en esa línea).
    // Sin cabecera, la referencia va primero: «0000000192», «A-0101», «REF123», o un código corto («77») si
    // después viene la descripción.
    const refTok = refCol
      ? words.find((t) => t.x >= refCol.from && t.x < refCol.to)
      : words[0] && (REF.test(words[0].text) || (/^\d{1,3}$/.test(words[0].text) && words.length > 1 && /[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}/.test(words[1]!.text))) ? words[0] : undefined;
    // En la descripción se quedan los enteros («1/2 x 15»); los decimales sueltos son números de otra columna.
    const desc = words.filter((t) => t !== refTok && !UNITS.has(t.text.toLowerCase()) && !isLot(t.text) && (parseAmount(t.text) === null || /^\d{1,4}$/.test(t.text))).map((t) => t.text).join(" ");
    const unitTok = tokens.find((t) => UNITS.has(t.text.toLowerCase()) && near(t) && t.x > c.q.x - 2 * h && t.x < c.p.x);
    const lotTok = tokens.find((t) => isLot(t.text) && t !== refTok && near(t) && t.x > c.p.x - h && t.x < c.a.x + h && !(refTok && t.text === refTok.text));
    return {
      ref: refTok?.text ?? null,
      description: desc,
      qty: c.q.value,
      unit: unitTok ? unitTok.text.toLowerCase() : null,
      price: c.p.value,
      discountPct: c.d ? c.d.value : (c.implied ?? null),
      amount: c.a.value,
      lot: lotTok?.text ?? null,
    };
  });

  // Papel curvado: las descripciones pueden caer un renglón más arriba o más abajo de sus números. Si hay
  // tantas descripciones con referencia en la columna de la izquierda como líneas, se emparejan por orden.
  if (lines.length > 1) {
    const ys = picked.map((c) => c.q.y);
    const coded = texts
      .map((t) => ({ t, m: /^\s*(\d{4,}|[A-Z]{1,3}[-.]?\d{3,}[A-Z0-9-]*)\s+(.*[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}.*)$/.exec(t.text.replace(/(\d)([A-Za-z]{3})/, "$1 $2")) }))
      .filter((x): x is { t: OcrText; m: RegExpExecArray } => x.m !== null)
      .map(({ t, m }) => ({ y: edgeMids(t.box).left.y, x: edgeMids(t.box).left.x, ref: m[1]!, rest: m[2]! }))
      .filter((c) => c.x < qtyColumn && c.y > Math.min(...ys) - 3 * h && c.y < Math.max(...ys) + 3 * h)
      .sort((a, b) => a.y - b.y);
    if (coded.length === lines.length) {
      coded.forEach((c, i) => {
        // Solo la descripción: corta en el primer número (cantidades de otro renglón pegadas al texto).
        const desc = c.rest.split(/\s+(?=\d+(?:[.,]\d+)?(?:\s|$))/)[0]!.trim();
        lines[i] = { ...lines[i]!, ref: c.ref, description: desc };
      });
    }
  }

  // 3) Totales por las cuentas, sin buscar palabras.
  const linesTotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const free = nums.filter((n) => !used.has(n));
  let base: number | null = null;
  let vatRate: number | null = null;
  let vat: number | null = null;
  let total: number | null = null;
  let headerDiscountPct: number | null = null;
  if (lines.length) {
    const subTok = free.find((n) => close(n.value, linesTotal, 0.015));
    // Descuento de cabecera: subtotal − descuento = base, los tres escritos, y el descuento es un % redondo.
    let baseTok: Num | undefined;
    let dtoTok: Num | undefined;
    for (const d of free) {
      if (d === subTok || d.value <= 0 || d.value > linesTotal * 0.6) continue;
      const pct = (d.value / linesTotal) * 100;
      const b = free.find((n) => n !== d && n !== subTok && close(n.value, round2(linesTotal - d.value), 0.015));
      if (b && Math.abs(pct * 2 - Math.round(pct * 2)) < 0.02) {
        baseTok = b;
        dtoTok = d;
        headerDiscountPct = Math.round(pct * 2) / 2;
        break;
      }
    }
    baseTok ??= subTok;
    if (baseTok) {
      base = baseTok.value;
      const others = free.filter((n) => n !== baseTok && n !== subTok && n !== dtoTok && n.value > 0);
      for (const r of VAT_RATES) {
        const v = round2((base * r) / 100);
        const vatTok = others.find((n) => close(n.value, v, 0.015));
        const totTok = others.find((n) => close(n.value, round2(base! + v), 0.015) && n !== vatTok);
        if (vatTok && totTok) {
          vatRate = r;
          vat = vatTok.value;
          total = totTok.value;
          break;
        }
      }
      // Varios tipos de IVA en el mismo albarán: la cuota y el total están escritos y base + cuota = total.
      if (total === null) {
        for (const v of others) {
          if (v.value < base * 0.02 || v.value > base * 0.215) continue;
          const totTok = others.find((n) => n !== v && close(n.value, round2(base! + v.value), 0.015));
          if (totTok) {
            vat = v.value;
            total = totTok.value;
            break;
          }
        }
      }
    }
  }
  const status: AlbaranRead["status"] = !lines.length ? "sin_lineas" : base !== null && total !== null ? "cuadra" : base !== null ? "parcial" : "no_cuadra";
  return { lines, linesTotal, base, vatRate, vat, total, headerDiscountPct, status, date: isoDate(tokens) };
}
