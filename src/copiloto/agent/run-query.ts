// Ejecución de una consulta de inventario (stock, movimientos, precios, reposición…): llama a la
// herramienta, pide a Jev que valore lo que merece atención, y emite la tabla, el gráfico y los botones
// de seguimiento. Las cifras salen siempre de la herramienta, nunca de un modelo.
import { randomUUID } from "node:crypto";
import { businessDay } from "../../lib/business-day";
import { Analytics, VIEW_FOR_TOOL } from "../analytics/analytics";
import type { AppRoute, Emit } from "../contract/index";
import type { SessionContext } from "../domain";
import { asNoul, asScore } from "../jev/gates/gate";
import { evaluationQuestions, URGENCY_KEYS } from "../jev/catalog";
import type { StageTimer } from "../metrics/metrics";
import { daysInclusive, horizon, pastPeriod } from "../tools/periods";
import type { ToolName, Tools } from "../tools/tools";
import { movementTypesIn, type EvalItem, type ToolParams } from "../tools/types";
import { reorderTable, tableFor } from "../writer/table";
import { followUpsFor } from "./followups";
import { locationLabel } from "../jev/interpret";
import type { QueryPlan } from "./plans";
import type { AgentDeps } from "./loop";
import type { Evaluation, ReportOutcome } from "./report";
import { asksSeveralData, referencesPrevious, wantsAreaBreakdown, wantsLocationBreakdown } from "../entities/signals";
import { tokenize } from "../entities/normalize";
import { isUnitWord } from "../entities/quantity-parser";
import { familyOf } from "../entities/family";
import { mentionedSupplier } from "../entities/catalog-parser";
import { unknownSupplier } from "../tools/text-filters";
import type { Session } from "./session";

type QueryDeps = Pick<AgentDeps, "jev" | "sessions" | "metrics" | "thresholds">;

/** Máximo de ítems evaluados por Jev en la llamada nº 2. */
const MAX_EVAL_ITEMS = 15;

/** Pantalla a la que lleva cada consulta ("Ver en…"). Las que tienen gráfica van a /informes. */
const TOOL_ROUTE: Record<ToolName, AppRoute> = {
  query_stock: "/stock",
  query_movements: "/informes",
  query_prices: "/informes",
  query_pending_transfers: "/traspasos",
  query_count_variance: "/informes",
  query_reorder: "/informes",
  query_orders: "/pedidos",
  query_spend: "/recepciones",
  query_product: "/productos",
  query_top_usage: "/informes",
};

/** Consultas cuya gráfica repite la tabla. */
const CHART_REPEATS_TABLE = new Set<ToolName>(["query_stock", "query_spend"]);

const DEFAULT_PERIOD: Partial<Record<ToolName, "semana" | "mes">> = { query_movements: "semana", query_spend: "mes", query_top_usage: "mes" };

/**
 * Tipos de movimiento: los que nombra el mensaje o, si continúa el anterior («¿y en el Vivero?» tras
 * «¿cuántas mermas en La Oliva?»), los de ese mensaje.
 */
function movementFilter(message: string, plan: QueryPlan, session: Session): { movementTypes?: ToolParams["movementTypes"] } {
  const own = movementTypesIn(message);
  if (own.length > 0) return { movementTypes: own };
  if (!plan.inherited?.length && !referencesPrevious(message)) return {};
  const previous = [...session.turns].reverse().find((t) => t.role === "user");
  const types = previous ? movementTypesIn(previous.text) : [];
  return types.length > 0 ? { movementTypes: types } : {};
}

/** «¿Cuánto he gastado en bebida?»: la familia que nombra (o los productos que resolvió Jev). */
function spendFamily(message: string, plan: QueryPlan, ctx: SessionContext): { family?: ToolParams["family"]; supplier?: string } {
  // «Lo gastado en Bebidas del Sur»: un proveedor nombrado filtra por él (antes que leer «bebidas» como familia).
  const supplier = mentionedSupplier(message, ctx.suppliers);
  if (supplier) return { supplier: supplier.name };
  const family = familyOf(message, ctx.products);
  if (family && family.products.length > 0) return { family: { label: family.label, productIds: family.products.map((p) => p.id) } };
  if (plan.products.length > 0) return { family: { label: plan.familia ?? plan.products.map((p) => p.product.name).slice(0, 2).join(", "), productIds: plan.products.map((p) => p.product.id) } };
  return {};
}

/** Dos datos del mismo producto en una pregunta: la ficha entera (stock, precio, consumo y mínimos). */
function bothParts(plan: QueryPlan, message: string): QueryPlan {
  if (plan.products.length === 0 || !["query_stock", "query_prices", "query_product", "query_movements"].includes(plan.tool) || !asksSeveralData(message)) return plan;
  // Con varios candidatos («beefeater»: Beefeater y Ginebra Beefeater Black), el que se nombra entero.
  const said = new Set(tokenize(message));
  const whole = plan.products.filter((p) => tokenize(p.product.name).filter((w) => !/^\d/.test(w) && !isUnitWord(w)).every((w) => said.has(w)));
  const products = plan.products.length === 1 ? plan.products : whole.length === 1 ? whole : null;
  if (!products) return plan;
  const { dato: _dato, familia: _familia, ...rest } = plan;
  void _dato;
  void _familia;
  return { ...rest, products, tool: "query_product" };
}

export async function runQuery(deps: QueryDeps, now: Date, asked: QueryPlan, message: string, ctx: SessionContext, emit: Emit, timer: StageTimer, tools: Tools, session: Session): Promise<ReportOutcome> {
  const plan = bothParts(asked, message);
  const tzLocation = ctx.locations.find((l) => l.id === plan.locationIds[0]);
  const today = businessDay(now, tzLocation?.timezone ?? "Europe/Madrid", tzLocation?.dayCutoff ?? "06:00");
  // Comparar locales con una semana suele dar ceros: sin periodo dicho, el último mes.
  const byLocation = plan.tool === "query_movements" && wantsLocationBreakdown(message) && plan.locationIds.length > 1;
  const fallback = byLocation ? "mes" : DEFAULT_PERIOD[plan.tool];
  const period = fallback || plan.periodo !== "no_indicado" ? pastPeriod(plan.periodo, today, message, fallback ?? "mes") : null;
  const h = horizon(plan.periodo, today);
  const params: ToolParams = {
    locationIds: plan.locationIds,
    areaId: plan.areaId,
    productIds: plan.products.map((p) => p.product.id),
    period,
    horizonDays: h.days,
    horizonLabel: h.label,
    now,
    ...(plan.tool === "query_stock" && wantsAreaBreakdown(message) ? { byArea: true } : {}),
    ...(plan.tool === "query_movements" ? movementFilter(message, plan, session) : {}),
    ...(byLocation ? { byLocation: true } : {}),
    ...(plan.tool === "query_spend" ? spendFamily(message, plan, ctx) : {}),
  };

  // «¿Cuánto llevamos gastado en Frutas Paco?» sin ese proveedor dado de alta: se dice, no se da el total de todos.
  if (plan.tool === "query_spend" && !params.supplier) {
    const unknown = unknownSupplier(message, [...ctx.suppliers.map((s) => s.name), ...ctx.products.map((p) => p.name)], ctx.locations.map((l) => l.name));
    if (unknown) return { kind: "error", message: `No tengo ningún proveedor llamado «${unknown}». Pregúntame el gasto de uno de los tuyos o el total («¿cuánto he gastado este mes?»).` };
  }
  let result = await timer.time("herramientas", () => tools.run(plan.tool, params, ctx));
  // «¿qué hay en cada sección?» sin stock repartido por zonas: no es «no hay stock», es que no hay
  // secciones con stock. Se dice y se enseña el total del local.
  const noSections = params.byArea === true && result.count === 0;
  if (noSections) result = await timer.time("herramientas", () => tools.run(plan.tool, { ...params, byArea: false }, ctx));
  // «En tus 4 locales» ya lo dice el titular: sin avisos que lo repitan.
  // Lo heredado («¿y en Parador?») ya se ve en el titular («Stock de Barceló en Parador»); solo
  // «los mismos productos» (el titular dice «de 7 productos») necesita decirse.
  const notices: string[] = [];
  if (plan.inherited?.includes("los mismos productos")) notices.push("Sigo con los mismos productos.");
  if (noSections) notices.push("Aún no hay stock repartido por secciones aquí (se reparte al contar por zonas); te enseño el total.");

  // Lo que ya se sabe sale ya: la tabla no espera a la valoración de Jev (llamada nº 2), y la gráfica
  // se calcula a la vez que esa valoración.
  const evaluated = result.evalItems.length > 0;
  const table = tableFor(result, evaluated, plan.dato);
  if (table) await emit({ event: "table", data: table });

  // «¿cuánto ron hay en el Parador?» y allí no queda: dónde sí hay, en vez de solo «no hay».
  let elsewhere: string[] | undefined;
  if (plan.tool === "query_stock" && result.count === 0 && plan.locationIds.length === 1 && plan.products.length > 0 && ctx.locations.length > 1) {
    const all = await timer.time("herramientas", () => tools.run("query_stock", { ...params, locationIds: ctx.locations.map((l) => l.id), areaId: null, byArea: false }, ctx));
    if (all.count > 0) {
      const places = new Set(all.rows.flatMap((r) => String(r.desglose ?? r.local ?? "").split(" · ").map((part) => part.replace(/\s+\d.*$/, "").trim())).filter(Boolean));
      elsewhere = ctx.locations.map((l) => l.name).filter((name) => places.has(name));
      const other = tableFor(all, false, plan.dato);
      if (other) await emit({ event: "table", data: other });
      // Con un solo producto no hay tabla: el reparto va en el texto.
      else elsewhere = [...elsewhere, ...all.rows.map((r) => `— ${r.producto}: ${r.desglose ?? r.cantidad}`)];
    }
  }

  const scope = {
    locales: plan.locationIds.map((id) => locationLabel(ctx, id)),
    espacio: plan.areaId ? ctx.areas.find((a) => a.id === plan.areaId)?.name ?? null : null,
    productos: plan.products.map((p) => p.product.name),
    periodo: plan.tool === "query_reorder" ? h.label : period?.label ?? null,
    ...(plan.familia ? { familia: plan.familia } : {}),
  };

  // Gráfica calculada por el código (decimal.js), solo si añade algo a la tabla: el stock y el gasto
  // por proveedor serían las mismas cifras en barras (y así se ahorra su consulta).
  const days = period ? daysInclusive(period.from, period.to) : 30;
  const chartPromise =
    table && CHART_REPEATS_TABLE.has(plan.tool)
      ? Promise.resolve(null)
      : timer
          .time("herramientas", () =>
            new Analytics(tools.source).chartForTool(
              plan.tool,
              { ctx, locationIds: plan.locationIds, productIds: plan.products.map((p) => p.product.id), days: Math.max(days, 7), now },
              h.days,
            ),
          )
          .catch(() => null);
  const [evaluations, chart] = await Promise.all([timer.time("jev2", () => evaluate(deps, result.evalItems, message, h.label)), chartPromise]);
  if (evaluated && evaluations === null) notices.push("No he podido valorar la urgencia; te muestro los datos tal cual.");
  // Reposición: en tabla, ya ordenada por la urgencia que ha valorado Jev.
  const reorder = !table ? reorderTable(result, evaluations ?? []) : null;
  if (reorder) await emit({ event: "table", data: reorder });
  if (chart) await emit({ event: "chart", data: chart });

  const route = TOOL_ROUTE[plan.tool];
  await emit({
    event: "navigate",
    data: {
      route,
      filters: {
        ...(route === "/informes" ? { view: params.movementTypes?.includes("waste") ? "mermas" : VIEW_FOR_TOOL[plan.tool], days: Math.max(days, 7) } : {}),
        ...(plan.locationIds.length === 1 ? { locationId: plan.locationIds[0]! } : {}),
        ...(plan.areaId ? { areaId: plan.areaId } : {}),
        ...(plan.products.length === 1 ? { productId: plan.products[0]!.product.id } : {}),
        ...(plan.tool === "query_pending_transfers" ? { status: "in_transit" } : {}),
      },
      auto: false,
    },
  });

  // Botones para seguir («Precios», «Consumo del mes», «Ficha»…): se ejecutan sin Jev.
  const followUps = followUpsFor(plan, result.rows.some((r) => r.bajo_minimo === true)).map((f) => ({ ...f, id: randomUUID().slice(0, 12) }));
  if (followUps.length > 0 && result.count > 0) {
    deps.sessions.setFollowUps(session, followUps);
    await emit({ event: "actions", data: { actions: followUps.map((f) => ({ id: f.id, label: f.label })) } });
  }

  return {
    kind: "consulta",
    tool: plan.tool,
    scope,
    result,
    evaluations: evaluations ?? [],
    notices,
    ...(table || reorder ? { tabulated: true } : {}),
    ...(plan.dato ? { dato: plan.dato } : {}),
    ...(elsewhere?.length ? { elsewhere } : {}),
  };
}

/** Llamada nº 2: Jev juzga las cifras calculadas. Devuelve null si Jev falla (se degrada sin valoración). */
async function evaluate(deps: QueryDeps, items: EvalItem[], request: string, horizonLabel: string): Promise<Evaluation[] | null> {
  if (items.length === 0) return [];
  const selected = items.slice(0, MAX_EVAL_ITEMS);
  const state = { request, horizon: horizonLabel, items: selected.map((i) => i.data) };
  try {
    const { answers } = await deps.jev.evaluate(state, evaluationQuestions(selected.map((i) => i.kind), false));
    return selected.map((item, i) => {
      const relevance = asNoul(answers[`${item.kind}_${i}`])?.noul ?? 0;
      const urgency = asScore(answers[`urgencia_${i}`]);
      const level = Math.max(0, Math.min(3, Math.round(urgency?.score ?? 0)));
      return {
        kind: item.kind,
        data: item.data,
        relevance,
        urgency: URGENCY_KEYS[level]!,
        urgencyScore: urgency?.score ?? 0,
        confidence: urgency?.confidence ?? 0,
      };
    });
  } catch {
    return null;
  }
}
