// Cuadrar en el chat una factura con su albarán, los dos leídos («¿cuadra la factura con el albarán?»): bases, y línea a
// línea por su descripción, qué falta en uno u otro y qué cambia de cantidad o de precio. Es lo que se mira a mano al
// recibir la factura; aquí solo se compara lo leído, no se guarda nada.
import Decimal from "decimal.js";
import type { ChatDocument, TableEvent } from "../contract/index";
import { STOPWORDS, tokenize } from "../entities/normalize";
import { formatMoney } from "../entities/units";

type Line = ChatDocument["lines"][number];

const words = (s: string) => tokenize(s).filter((w) => w.length > 2 && !STOPWORDS.has(w));
const near = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b.slice(0, 5)) || b.startsWith(a.slice(0, 5))));
/** Parecido de 0 a 1 entre dos descripciones (las palabras de la más corta que están en la otra). */
function similarity(a: string, b: string): number {
  const [x, y] = [words(a), words(b)];
  if (!x.length || !y.length) return 0;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.filter((w) => long.some((v) => near(w, v))).length / short.length;
}
const unitPrice = (l: Line) => (l.price ? new Decimal(l.price) : new Decimal(l.qty).gt(0) ? new Decimal(l.amount).div(l.qty) : new Decimal(0));
const qty = (v: Decimal.Value) => new Decimal(v).toDecimalPlaces(3).toString().replace(".", ",");
const baseOf = (d: ChatDocument) => (d.base ? new Decimal(d.base) : d.lines.reduce((s, l) => s.plus(l.amount), new Decimal(0)));
/** «de la factura F-1», «del albarán A-7». */
const ofName = (d: ChatDocument) => `${d.kind === "factura" ? "de la factura" : "del albarán"}${d.number ? ` ${d.number}` : ""}`;
const name = (d: ChatDocument) => `${d.kind === "factura" ? "la factura" : "el albarán"}${d.number ? ` ${d.number}` : ""}`;

export function compareDocuments(a: ChatDocument, b: ChatDocument): { text: string; table?: TableEvent } {
  const factura = a.kind === "factura" ? a : b;
  const albaran = a.kind === "factura" ? b : a;
  const used = new Set<number>();
  const rows: Array<Record<string, string>> = [];
  for (const l of albaran.lines) {
    const best = factura.lines.map((f, i) => ({ f, i, s: used.has(i) ? 0 : similarity(l.description, f.description) })).sort((x, y) => y.s - x.s)[0];
    if (!best || best.s < 0.5) {
      rows.push({ p: l.description, a: `${qty(l.qty)} × ${formatMoney(unitPrice(l))}`, f: "—", d: "No está en la factura" });
      continue;
    }
    used.add(best.i);
    const notes: string[] = [];
    if (!new Decimal(l.qty).eq(best.f.qty)) notes.push(`cantidad ${qty(l.qty)} → ${qty(best.f.qty)}`);
    const [pa, pf] = [unitPrice(l), unitPrice(best.f)];
    if (pa.gt(0) && pf.minus(pa).abs().div(pa).gt(0.01)) notes.push(`precio ${formatMoney(pa)} → ${formatMoney(pf)}`);
    if (notes.length) rows.push({ p: l.description, a: `${qty(l.qty)} × ${formatMoney(pa)}`, f: `${qty(best.f.qty)} × ${formatMoney(pf)}`, d: notes.join("; ") });
  }
  factura.lines.forEach((f, i) => {
    if (!used.has(i)) rows.push({ p: f.description, a: "—", f: `${qty(f.qty)} × ${formatMoney(unitPrice(f))}`, d: "No está en el albarán" });
  });

  const [bf, ba] = [baseOf(factura), baseOf(albaran)];
  const diff = bf.minus(ba);
  const bases = `Base ${ofName(factura)}: ${formatMoney(bf)}; ${ofName(albaran)}: ${formatMoney(ba)}`;
  if (rows.length === 0 && diff.abs().lte("0.02")) {
    return { text: `${name(factura)[0]!.toUpperCase()}${name(factura).slice(1)} y ${name(albaran)} cuadran: las mismas ${albaran.lines.length} líneas, con las mismas cantidades y precios. ${bases}.` };
  }
  const head = diff.abs().lte("0.02") ? `${bases}: la base cuadra, pero hay líneas distintas.` : `${bases}: la factura cobra ${formatMoney(diff.abs())} ${diff.gt(0) ? "más" : "menos"} que el albarán.`;
  return {
    text: `${head}${rows.length ? ` ${rows.length} ${rows.length === 1 ? "diferencia" : "diferencias"}:` : ""}`,
    ...(rows.length
      ? { table: { columns: [{ key: "p", label: "Producto" }, { key: "a", label: "Albarán", align: "right" as const }, { key: "f", label: "Factura", align: "right" as const }, { key: "d", label: "Diferencia" }], rows } }
      : {}),
  };
}
