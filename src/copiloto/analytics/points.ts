// Puntos y etiquetas de las gráficas. Cada cifra sale como cadena decimal exacta (`value`) y con su texto ya
// formateado (`display`); la interfaz solo dibuja.
import Decimal from "decimal.js";
import type { ChartFormat, ChartPoint } from "../contract/index";
import { formatDecimal, formatMoney } from "../entities/units";
import { addDays } from "../tools/periods";

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function dayLabel(day: string): string {
  const [, m, d] = day.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
}

/** «16–22 sep» (o «29 sep–5 oct» si cambia de mes). */
export function weekLabel(from: string, to: string): string {
  const [a, b] = [dayLabel(from), dayLabel(to)];
  return a.split(" ")[1] === b.split(" ")[1] ? `${a.split(" ")[0]}–${b}` : `${a}–${b}`;
}

function display(value: Decimal, format: ChartFormat): string {
  switch (format) {
    case "money":
      return formatMoney(value);
    case "days":
      return `${formatDecimal(value, 1)} días`;
    case "percent":
      return `${formatDecimal(value, 1)} %`;
    case "number":
      return formatDecimal(value, 2);
  }
}

/** Un punto; `suffix` añade texto tras el valor (p. ej. el porcentaje sobre el total). */
export function point(x: string, label: string, value: Decimal, format: ChartFormat, suffix = ""): ChartPoint {
  const rounded = value.toDecimalPlaces(2);
  return { x, label, value: rounded.toString(), display: `${display(rounded, format)}${suffix}` };
}


export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
