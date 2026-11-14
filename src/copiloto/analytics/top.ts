// Ranking para gráficas: los `n - 1` mayores y, si hay más, una categoría «Otros» con la suma del resto.
// Así una gráfica nunca descarta importes en silencio: siempre suma el total del periodo.
import Decimal from "decimal.js";

export function topWithOthers(entries: Array<[string, Decimal]>, n: number, otherLabel = "Otros"): Array<[string, Decimal]> {
  const sorted = [...entries].sort((a, b) => b[1].cmp(a[1]));
  if (sorted.length <= n) return sorted;
  const head = sorted.slice(0, n - 1);
  const rest = sorted.slice(n - 1).reduce((acc, [, v]) => acc.plus(v), new Decimal(0));
  return [...head, [otherLabel, rest]];
}
