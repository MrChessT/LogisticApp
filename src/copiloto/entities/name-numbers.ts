// Nombres de producto con cifras («Boj 570 Albariño», «Licor 43»): el lector de cantidades ve el «570» como otra
// cantidad y parte «1 de Boj 570 Albariño» en dos productos («Boj» y 570 de «Albariño»). Si un fragmento y el siguiente
// juntos contienen el nombre entero de un producto del catálogo con cifras, son uno solo: la cantidad es la del primero.
import { normalize } from "./normalize";
import type { Segment } from "./quantity-parser";

const clean = (s: string) => ` ${normalize(s).replace(/[^a-z0-9]+/g, " ").trim()} `;

export function joinNamesWithNumbers(segments: Segment[], productNames: string[]): Segment[] {
  const withDigits = productNames.filter((n) => /\d/.test(n)).map(clean);
  if (withDigits.length === 0 || segments.length < 2) return segments;
  const out: Segment[] = [];
  for (const segment of segments) {
    const prev = out[out.length - 1];
    if (prev) {
      const joined = clean(`${prev.productText} ${segment.text}`);
      const before = clean(prev.productText);
      if (withDigits.some((n) => joined.includes(n) && !before.includes(n))) {
        out[out.length - 1] = { ...prev, text: `${prev.text} ${segment.text}`, productText: `${prev.productText} ${segment.text}` };
        continue;
      }
    }
    out.push(segment);
  }
  return out;
}
