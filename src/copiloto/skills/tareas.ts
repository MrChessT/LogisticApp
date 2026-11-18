// Tareas del asistente: trabajo que el panel no hace solo. Cada una cruza datos de todos los locales y
// termina en algo que se puede confirmar (borradores de pedido o de traspaso) o arreglar (el catálogo).
// Todo el cálculo es determinista (decimal.js); Jev solo interviene al comprobar los borradores.
//
//   · pedidos     — traspasos primero; luego lo que toca pedir hoy a cada proveedor según su ficha (reponer.ts).
//   · equilibrar  — lo que sobra en un local y falta en otro: traspasos en vez de compras (reponer.ts).
//   · catalogo    — lo que da cifras falsas o impide trabajar (sin precio, stock negativo, costes raros…).
//   · parte       — el día de ayer en cada local: consumo, mermas, compras y lo que requiere atención.
import Decimal from "decimal.js";
import type { SessionContext } from "../domain";
import { formatMoney } from "../entities/units";
import { businessDay } from "../../lib/business-day";
import { isLoss } from "../../lib/exit-kinds";
import { addDays } from "../tools/periods";

import { equilibrar, pedidos } from "./reponer";
import { locationName, MAX_ROWS, plural, TAREAS, type TareaFollowUp, type TareaId, type TareaInput, type TareaResult } from "./tarea-types";

export type { TareaId, TareaPlan, TareaResult } from "./tarea-types";

export async function runTarea(id: TareaId, input: TareaInput): Promise<TareaResult> {
  switch (id) {
    case "pedidos":
      return pedidos(input);
    case "equilibrar":
      return equilibrar(input);
    case "catalogo":
      return catalogo(input);
    case "parte":
      return parte(input);
  }
}


function today(ctx: SessionContext, locationId: string | undefined, now: Date): string {
  const l = ctx.locations.find((x) => x.id === locationId) ?? ctx.locations[0];
  return businessDay(now, l?.timezone ?? "Europe/Madrid", l?.dayCutoff ?? "06:00");
}

// Revisar catálogo -------------------------------------------------------------------------------------

const ISSUE_LABELS: Record<string, string> = {
  nombre_invalido: "Nombre no válido",
  sin_formatos: "Sin formatos",
  sin_formato_conteo: "Sin formato de conteo",
  sin_formato_compra: "Sin formato de compra",
  sin_precio: "Sin precio",
  sin_categoria: "Sin categoría",
  precio_dispar: "Precios muy distintos",
  coste_dispar: "Coste del stock incoherente",
  stock_negativo: "Stock negativo",
  sin_minimo: "Sin mínimo",
};
const SEVERITY_LABEL = { error: "Error", aviso: "Aviso", info: "Info" } as const;

async function catalogo({ ctx, source, locationIds }: TareaInput): Promise<TareaResult> {
  const issues = await source.catalogHealth({ locationIds });
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "aviso");
  const info = issues.filter((i) => i.severity === "info");
  if (errors.length + warnings.length === 0) {
    return {
      tarea: "catalogo",
      text: info.length > 0
        ? `El catálogo está bien. Solo como mejora: ${plural(info.length, "producto no tiene", "productos no tienen")} mínimo o categoría (sin mínimo no entran en la reposición).`
        : "El catálogo está bien: todos los productos tienen formatos y precio, y no hay stock negativo ni costes incoherentes.",
      table: null,
      followUps: [],
      navigate: { route: "/productos", filters: {}, auto: false },
    };
  }
  const shown = [...errors, ...warnings];
  const byIssue = new Map<string, number>();
  for (const i of shown) byIssue.set(i.issue, (byIssue.get(i.issue) ?? 0) + 1);
  const summary = [...byIssue.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${(ISSUE_LABELS[k] ?? k).toLowerCase()} (${n})`).join(", ");
  return {
    tarea: "catalogo",
    text: [
      errors.length > 0 ? `Hay ${plural(errors.length, "problema que da", "problemas que dan")} cifras falsas y ${plural(warnings.length, "aviso", "avisos")}.` : `Hay ${plural(warnings.length, "aviso", "avisos")} en el catálogo.`,
      `Por tipo: ${summary}.`,
      errors.length > 0 ? "Empieza por los errores: el stock negativo y los costes incoherentes falsean el valor del stock y el consumo." : "",
      info.length > 0 ? `Además, ${plural(info.length, "producto", "productos")} sin mínimo o sin categoría.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    table: {
      columns: [
        { key: "gravedad", label: "Gravedad" },
        { key: "producto", label: "Producto" },
        { key: "problema", label: "Problema" },
        { key: "local", label: "Local" },
        { key: "detalle", label: "Detalle" },
      ],
      rows: shown.slice(0, MAX_ROWS).map((i) => ({
        gravedad: SEVERITY_LABEL[i.severity],
        producto: i.productName,
        problema: ISSUE_LABELS[i.issue] ?? i.issue,
        local: i.locationId ? locationName(ctx, i.locationId) : "—",
        detalle: i.detail,
      })),
      flagged: shown.slice(0, MAX_ROWS).flatMap((i, n) => (i.severity === "error" ? [n] : [])),
      ...(shown.length > MAX_ROWS ? { more: shown.length - MAX_ROWS } : {}),
    },
    followUps: [],
    navigate: { route: "/productos", filters: {}, auto: false },
  };
}

// Parte de ayer ----------------------------------------------------------------------------------------

async function parte({ ctx, source, locationIds, now }: TareaInput): Promise<TareaResult> {
  const day = addDays(today(ctx, locationIds[0], now), -1);
  const [movements, balances, lps, transfers, orders, health] = await Promise.all([
    source.movements({ locationIds, since: `${addDays(day, -1)}T00:00:00Z` }),
    source.balances({ locationIds }),
    source.locationProducts({ locationIds }),
    source.transfers({ locationIds, status: ["in_transit"] }),
    source.orders({ locationIds, statuses: ["sent", "partial"] }),
    source.catalogHealth({ locationIds }).catch(() => []),
  ]);
  const products = new Map(ctx.products.map((p) => [p.id, p]));
  type Row = { usage: Decimal; waste: Decimal; purchases: Decimal; low: number; out: number; incoming: number; late: number; topWaste: { name: string; value: Decimal } | null };
  const byLocation = new Map<string, Row>(locationIds.map((id) => [id, { usage: new Decimal(0), waste: new Decimal(0), purchases: new Decimal(0), low: 0, out: 0, incoming: 0, late: 0, topWaste: null }]));

  for (const m of movements) {
    const l = ctx.locations.find((x) => x.id === m.locationId);
    if (businessDay(new Date(m.occurredAt), l?.timezone ?? "Europe/Madrid", l?.dayCutoff ?? "06:00") !== day) continue;
    const row = byLocation.get(m.locationId);
    if (!row) continue;
    const value = new Decimal(m.qty).mul(m.unitCost ?? 0).abs();
    if (m.type === "purchase") row.purchases = row.purchases.plus(value);
    if (m.type === "waste" && isLoss(m.exitKind)) {
      row.waste = row.waste.plus(value);
      if (!row.topWaste || value.gt(row.topWaste.value)) row.topWaste = { name: products.get(m.productId)?.name ?? "producto", value };
    }
    if (m.type === "consumption" || m.type === "waste" || ((m.type === "count_adjustment" || m.type === "manual_adjustment") && new Decimal(m.qty).lt(0))) row.usage = row.usage.plus(value);
  }
  const stock = new Map(balances.map((b) => [`${b.locationId}:${b.productId}`, new Decimal(b.qty)]));
  for (const lp of lps) {
    const row = byLocation.get(lp.locationId);
    if (!row || new Decimal(lp.minQty).lte(0)) continue;
    const qty = stock.get(`${lp.locationId}:${lp.productId}`) ?? new Decimal(0);
    if (qty.lt(lp.minQty)) row.low += 1;
    if (qty.lte(0)) row.out += 1;
  }
  for (const t of transfers) {
    const row = byLocation.get(t.toLocationId);
    if (row) row.incoming += 1;
  }
  const todayStr = addDays(day, 1);
  for (const o of orders) {
    const row = byLocation.get(o.locationId);
    if (row && o.expectedDate && o.expectedDate < todayStr) row.late += 1;
  }

  const rows = [...byLocation.entries()].map(([id, r]) => ({ id, ...r }));
  const totalUsage = rows.reduce((a, r) => a.plus(r.usage), new Decimal(0));
  const totalWaste = rows.reduce((a, r) => a.plus(r.waste), new Decimal(0));
  const alerts: string[] = [];
  const out = rows.filter((r) => r.out > 0);
  if (out.length) alerts.push(`sin existencias de algo con mínimo en ${out.map((r) => `${locationName(ctx, r.id)} (${r.out})`).join(", ")}`);
  const late = rows.filter((r) => r.late > 0);
  if (late.length) alerts.push(`pedidos con retraso en ${late.map((r) => locationName(ctx, r.id)).join(", ")}`);
  const incoming = rows.reduce((a, r) => a + r.incoming, 0);
  if (incoming) alerts.push(`${plural(incoming, "traspaso", "traspasos")} por recibir`);
  const errors = health.filter((h) => h.severity === "error").length;
  if (errors) alerts.push(`${plural(errors, "error", "errores")} en el catálogo`);
  const worst = rows.filter((r) => r.topWaste).sort((a, b) => b.topWaste!.value.cmp(a.topWaste!.value))[0];

  const text = [
    `Ayer (${day.split("-").reverse().join("/")}) se consumieron ${formatMoney(totalUsage)} a coste${totalWaste.gt(0) ? `, de los que ${formatMoney(totalWaste)} fueron mermas` : " y no hubo mermas"}.`,
    worst?.topWaste ? `La merma mayor: ${worst.topWaste.name} en ${locationName(ctx, worst.id)} (${formatMoney(worst.topWaste.value)}).` : "",
    alerts.length ? `Atención: ${alerts.join("; ")}.` : "Nada urgente pendiente.",
  ]
    .filter(Boolean)
    .join(" ");

  const followUps: TareaFollowUp[] = [];
  if (rows.some((r) => r.low > 0)) followUps.push({ label: TAREAS.pedidos.label, plan: { type: "tarea", tarea: "pedidos", locationIds } });
  if (rows.some((r) => r.low > 0) && ctx.locations.length > 1) followUps.push({ label: TAREAS.equilibrar.label, plan: { type: "tarea", tarea: "equilibrar", locationIds } });
  if (errors) followUps.push({ label: TAREAS.catalogo.label, plan: { type: "tarea", tarea: "catalogo", locationIds } });

  return {
    tarea: "parte",
    text,
    table: {
      columns: [
        { key: "local", label: "Local" },
        { key: "consumo", label: "Consumo", align: "right" },
        { key: "mermas", label: "Mermas", align: "right" },
        { key: "compras", label: "Compras", align: "right" },
        { key: "bajo_minimo", label: "Bajo mínimo", align: "right" },
        { key: "pendiente", label: "Por recibir", align: "right" },
      ],
      rows: rows.map((r) => ({
        local: locationName(ctx, r.id),
        consumo: formatMoney(r.usage),
        mermas: formatMoney(r.waste),
        compras: formatMoney(r.purchases),
        bajo_minimo: String(r.low),
        pendiente: String(r.incoming + r.late),
      })),
      flagged: rows.flatMap((r, i) => (r.out > 0 || r.late > 0 ? [i] : [])),
    },
    followUps,
    navigate: { route: "/informes", filters: {}, auto: false },
  };
}
