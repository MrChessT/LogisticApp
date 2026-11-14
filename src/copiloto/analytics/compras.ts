// Compras de /informes («Compras»): de dónde sale el dinero que entra. Todo sale de las líneas de los albaranes
// cerrados (cantidad × precio del formato), así que cada gráfica suma exactamente lo mismo que el KPI total.
import Decimal from "decimal.js";
import type { ChartSeries, ChartSpec, Kpi } from "../contract/index";
import type { SessionContext } from "../domain";
import { formatDecimal, formatMoney } from "../entities/units";
import type { PurchaseLineRaw } from "../tools/types";
import { departmentOf, leafOf, SIN_CATEGORIA } from "./categories";
import { daysBetween, dayLabel, point } from "./points";

const TOP_N = 8;
/** Series de la evolución diaria: hasta 4 (la paleta validada); el resto se agrupa en «Otros». */
const MAX_LINES = 4;
const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export interface PurchaseWindow {
  from: string;
  to: string;
  label: string;
}

const sum = (values: Iterable<Decimal>) => [...values].reduce((acc, v) => acc.plus(v), new Decimal(0));

/** Suma por clave, de mayor a menor. */
function rank(totals: Map<string, Decimal>): Array<[string, Decimal]> {
  return [...totals.entries()].filter(([, v]) => v.gt(0)).sort((a, b) => b[1].cmp(a[1]));
}

function addTo(totals: Map<string, Decimal>, key: string, value: Decimal) {
  totals.set(key, (totals.get(key) ?? new Decimal(0)).plus(value));
}

/** Un punto con su importe y el porcentaje que representa sobre el total del periodo. */
function withShare(name: string, value: Decimal, total: Decimal) {
  const pct = total.isZero() ? "0" : formatDecimal(value.div(total).mul(100), 0);
  return point(name, name, value, "money", ` · ${pct} %`);
}

function ranking(id: string, title: string, subtitle: string, totals: Map<string, Decimal>, total: Decimal, labelOf: (key: string) => string, empty: string): ChartSpec {
  const points = rank(totals).slice(0, TOP_N).map(([key, v]) => ({ ...withShare(key, v, total), label: labelOf(key) }));
  return {
    id,
    kind: "bar",
    title,
    subtitle,
    format: "money",
    series: [{ key: "importe", name: "Importe", points }],
    ...(points.length === 0 ? { empty } : {}),
  };
}

export interface ComprasView {
  kpis: Kpi[];
  charts: ChartSpec[];
}

/** Vista «Compras»: KPIs y cuatro gráficas (departamento, familia, evolución diaria, día de la semana y proveedor). */
export function comprasView(lines: PurchaseLineRaw[], ctx: SessionContext, w: PurchaseWindow, productIds: string[]): ComprasView {
  const category = new Map(ctx.products.map((p) => [p.id, p.category]));
  const inPeriod = lines.filter((l) => l.docDate >= w.from && l.docDate <= w.to && (productIds.length === 0 || productIds.includes(l.productId)));
  const amount = (l: PurchaseLineRaw) => new Decimal(l.amount);
  const total = sum(inPeriod.map(amount));
  const empty = "Sin compras en este periodo.";

  const byDepartment = new Map<string, Decimal>();
  const byFamily = new Map<string, Decimal>();
  const bySupplier = new Map<string, Decimal>();
  const byDay = new Map<string, Map<string, Decimal>>();
  const byWeekday = new Map<number, Decimal>();
  for (const l of inPeriod) {
    const cat = category.get(l.productId) ?? null;
    const department = departmentOf(cat);
    addTo(byDepartment, department, amount(l));
    addTo(byFamily, cat ?? SIN_CATEGORIA, amount(l));
    addTo(bySupplier, l.supplierName ?? "Sin proveedor", amount(l));
    const days = byDay.get(department) ?? new Map<string, Decimal>();
    addTo(days, l.docDate, amount(l));
    byDay.set(department, days);
    // getUTCDay sobre el mediodía evita que la zona horaria cambie el día. Lunes es el primero.
    const weekday = (new Date(`${l.docDate}T12:00:00Z`).getUTCDay() + 6) % 7;
    byWeekday.set(weekday, (byWeekday.get(weekday) ?? new Decimal(0)).plus(amount(l)));
  }

  const receipts = new Set(inPeriod.map((l) => l.receiptId)).size;
  const topDepartment = rank(byDepartment)[0];
  const kpis: Kpi[] = [
    { id: "compras", label: "Compras", value: formatMoney(total), hint: w.label },
    { id: "albaranes", label: "Albaranes", value: String(receipts), hint: "recepciones cerradas" },
    { id: "proveedores", label: "Proveedores", value: String(new Set(inPeriod.map((l) => l.supplierName ?? "")).size), hint: "con compras en el periodo" },
    {
      id: "departamento_principal",
      label: "Departamento principal",
      value: topDepartment ? topDepartment[0] : "—",
      hint: topDepartment ? `${formatDecimal(topDepartment[1].div(total).mul(100), 0)} % de lo comprado` : "Sin compras en el periodo",
    },
  ];

  // Evolución diaria: un departamento por línea (los cuatro primeros); el resto suma en «Otros».
  const departments = rank(byDepartment).map(([name]) => name);
  const shown = departments.length > MAX_LINES ? departments.slice(0, MAX_LINES - 1) : departments;
  const days = daysBetween(w.from, w.to);
  const series: ChartSeries[] = shown.map((name) => ({
    key: name,
    name,
    points: days.map((d) => point(d, dayLabel(d), byDay.get(name)?.get(d) ?? new Decimal(0), "money")),
  }));
  if (departments.length > shown.length) {
    const rest = departments.slice(shown.length);
    series.push({
      key: "otros",
      name: "Otros",
      points: days.map((d) => point(d, dayLabel(d), sum(rest.map((name) => byDay.get(name)?.get(d) ?? new Decimal(0))), "money")),
    });
  }

  const weekdays: ChartSpec = {
    id: "compras-dia-semana",
    kind: "column",
    title: "Compras por día de la semana",
    subtitle: "Qué días se compra más, para cuadrar pedidos y recepciones",
    format: "money",
    series: [{ key: "importe", name: "Importe", points: WEEKDAYS.map((name, i) => point(String(i), name, byWeekday.get(i) ?? new Decimal(0), "money")) }],
    ...(total.isZero() ? { empty } : {}),
  };

  return {
    kpis,
    charts: [
      ranking("compras-departamento", "Compras por departamento", `Primer nivel del catálogo, ${w.label}`, byDepartment, total, (k) => k, empty),
      ranking("compras-familia", "Compras por familia", `Categoría completa del catálogo, ${w.label}`, byFamily, total, (k) => leafOf(k), empty),
      {
        id: "compras-diarias",
        kind: "line",
        title: "Compras por día y departamento",
        subtitle: `Importe cada día del periodo, ${w.label}`,
        format: "money",
        series,
        ...(total.isZero() ? { empty } : {}),
      },
      weekdays,
      ranking("compras-proveedor", "Compras por proveedor", `Albaranes cerrados, ${w.label}`, bySupplier, total, (k) => k, empty),
    ],
  };
}
