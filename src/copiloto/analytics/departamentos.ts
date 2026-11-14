// Valor de consumo o de mermas repartido por departamento (primer nivel del catálogo). Lo usan Consumo y Mermas.
import Decimal from "decimal.js";
import type { ChartSpec } from "../contract/index";
import type { SessionContext } from "../domain";
import { formatDecimal } from "../entities/units";
import { departmentOf } from "./categories";
import { point } from "./points";

const TOP_N = 8;

/** Un ranking por departamento: el valor de cada producto se suma a su departamento. */
export function departmentChart(opts: {
  id: string;
  title: string;
  subtitle: string;
  values: Map<string, Decimal>;
  products: SessionContext["products"];
  empty: string;
}): ChartSpec {
  const category = new Map(opts.products.map((p) => [p.id, p.category]));
  const totals = new Map<string, Decimal>();
  for (const [productId, value] of opts.values) {
    const department = departmentOf(category.get(productId) ?? null);
    totals.set(department, (totals.get(department) ?? new Decimal(0)).plus(value));
  }
  const total = [...totals.values()].reduce((acc, v) => acc.plus(v), new Decimal(0));
  const points = [...totals.entries()]
    .filter(([, v]) => v.gt(0))
    .sort((a, b) => b[1].cmp(a[1]))
    .slice(0, TOP_N)
    .map(([name, v]) => {
      const pct = formatDecimal(v.div(total).mul(100), 0);
      return point(name, name, v, "money", ` · ${pct} %`);
    });
  return {
    id: opts.id,
    kind: "bar",
    title: opts.title,
    subtitle: opts.subtitle,
    format: "money",
    series: [{ key: "valor", name: "Valor", points }],
    ...(points.length === 0 ? { empty: opts.empty } : {}),
  };
}
