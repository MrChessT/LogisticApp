// Tareas del asistente: trabajo que el panel no hace solo. Cada una cruza datos de todos los locales y
// termina en algo que se puede confirmar (borradores de pedido o de traspaso) o arreglar (el catálogo).
// Todo el cálculo es determinista (decimal.js); Jev solo interviene al comprobar los borradores.
//
//   · pedidos     — qué hay que pedir la próxima semana en cada local, por proveedor y en cajas enteras.
//   · equilibrar  — lo que sobra en un local y falta en otro: traspasos en vez de compras.
//   · catalogo    — lo que da cifras falsas o impide trabajar (sin precio, stock negativo, costes raros…).
//   · parte       — el día de ayer en cada local: consumo, mermas, compras y lo que requiere atención.
import Decimal from "decimal.js";
import type { NavigateEvent, TableEvent } from "../contract/index";
import type { Pack, Product, SessionContext } from "../domain";
import type { ActionPlan, CatalogPlan, QueryPlan } from "../agent/plans";
import { formatDecimal, formatMoney, formatStock } from "../entities/units";
import { businessDay } from "../../lib/business-day";
import { isLoss } from "../../lib/exit-kinds";
import { addDays } from "../tools/periods";
import { computeReorder } from "../tools/tools";
import type { InventoryDataSource } from "../tools/types";

export const TAREAS = {
  pedidos: { label: "Preparar pedidos", hint: "Todos los locales, por proveedor y en cajas" },
  equilibrar: { label: "Equilibrar locales", hint: "Traspasos de donde sobra a donde falta" },
  catalogo: { label: "Revisar catálogo", hint: "Precios, formatos y stock que no cuadran" },
  parte: { label: "Parte de ayer", hint: "Consumo, mermas y alertas por local" },
} as const;
export type TareaId = keyof typeof TAREAS;

export interface TareaPlan {
  type: "tarea";
  tarea: TareaId;
  locationIds: string[];
}

/** Lo que una tarea deja preparado para un toque: borradores o consultas ya resueltas. */
export interface TareaFollowUp {
  label: string;
  plan: QueryPlan | CatalogPlan | ActionPlan | TareaPlan;
}

export interface TareaResult {
  tarea: TareaId;
  /** Respuesta en una o dos frases (las cifras, ya formateadas). */
  text: string;
  table: TableEvent | null;
  followUps: TareaFollowUp[];
  navigate?: NavigateEvent;
}

interface TareaInput {
  ctx: SessionContext;
  source: InventoryDataSource;
  locationIds: string[];
  now: Date;
}

const ORDER_DAYS = 7;
const MAX_ROWS = 15;
const MAX_BUTTONS = 4;

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

const locationName = (ctx: SessionContext, id: string) => ctx.locations.find((l) => l.id === id)?.name ?? "local";
const purchasePack = (p: Product): Pack | null => p.packs.find((k) => k.isPurchaseDefault) ?? (p.packs.length === 1 ? p.packs[0]! : null);
/** Unidad en que se cuenta: 1 ud, o la botella / barril / kg (en unidad base). */
const countUnit = (p: Product): Decimal => (p.dimension === "count" ? new Decimal(1) : new Decimal(p.packs.find((k) => k.isCountDefault)?.qtyBase ?? 1));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function today(ctx: SessionContext, locationId: string | undefined, now: Date): string {
  const l = ctx.locations.find((x) => x.id === locationId) ?? ctx.locations[0];
  return businessDay(now, l?.timezone ?? "Europe/Madrid", l?.dayCutoff ?? "06:00");
}

// Pedidos ---------------------------------------------------------------------------------------------

async function pedidos({ ctx, source, locationIds, now }: TareaInput): Promise<TareaResult> {
  type Group = { locationId: string; supplier: string; lines: number; total: Decimal; priced: boolean };
  const groups = new Map<string, Group>();
  const urgent: Array<{ name: string; days: Decimal; location: string }> = [];
  const perLocation = new Map<string, number>();
  const noSupplier = new Set<string>();

  for (const locationId of locationIds) {
    const lines = (
      await computeReorder(source, { locationIds: [locationId], areaId: null, productIds: [], period: null, horizonDays: ORDER_DAYS, horizonLabel: "la próxima semana", now }, ctx)
    ).filter((l) => l.suggested.gt(0));
    if (lines.length === 0) continue;
    const prices = await source.supplierPrices(lines.map((l) => purchasePack(l.product)?.id).filter((x): x is string => !!x));
    for (const l of lines) {
      const pack = purchasePack(l.product);
      const price = pack ? prices.find((p) => p.packId === pack.id) : undefined;
      if (l.coverage && l.coverage.lt(3)) urgent.push({ name: l.product.name, days: l.coverage, location: locationName(ctx, locationId) });
      perLocation.set(locationId, (perLocation.get(locationId) ?? 0) + 1);
      if (!pack || !price) {
        noSupplier.add(l.product.name);
        continue;
      }
      const packs = l.suggested.div(pack.qtyBase).ceil();
      const key = `${locationId}:${price.supplierId}`;
      const g = groups.get(key) ?? { locationId, supplier: price.supplierName, lines: 0, total: new Decimal(0), priced: true };
      g.lines += 1;
      g.total = g.total.plus(packs.mul(price.lastPrice));
      groups.set(key, g);
    }
  }

  const rows = [...groups.values()].sort((a, b) => locationName(ctx, a.locationId).localeCompare(locationName(ctx, b.locationId)) || b.total.cmp(a.total));
  if (rows.length === 0 && noSupplier.size === 0) {
    return { tarea: "pedidos", text: "No hace falta pedir nada para la próxima semana: con el stock, los mínimos y lo que ya está en camino llega en todos los locales.", table: null, followUps: [] };
  }
  const total = rows.reduce((acc, g) => acc.plus(g.total), new Decimal(0));
  const products = [...perLocation.values()].reduce((a, b) => a + b, 0);
  urgent.sort((a, b) => a.days.cmp(b.days));
  const parts = [
    `Para la próxima semana hay que pedir ${plural(products, "producto", "productos")} en ${plural(perLocation.size, "local", "locales")}${total.gt(0) ? `, unos ${formatMoney(total)} sin IVA` : ""}.`,
  ];
  if (urgent.length > 0) parts.push(`Lo más urgente: ${urgent.slice(0, 3).map((u) => `${u.name} en ${u.location} (${formatDecimal(u.days, 1)} días)`).join(", ")}.`);
  if (noSupplier.size > 0) parts.push(`Sin proveedor o precio (no entran en los pedidos): ${[...noSupplier].slice(0, 4).join(", ")}${noSupplier.size > 4 ? "…" : ""}.`);
  parts.push("Cada botón deja el pedido de ese local en borrador para que lo revises y lo envíes desde Pedidos.");

  const followUps: TareaFollowUp[] = [...perLocation.keys()]
    .sort((a, b) => (perLocation.get(b) ?? 0) - (perLocation.get(a) ?? 0))
    .slice(0, MAX_BUTTONS)
    .map((locationId) => ({
      label: `Preparar pedido · ${locationName(ctx, locationId)}`,
      plan: { type: "catalogo", accion: "preparar_pedido", locationId, locationOutcome: "actuar", products: [], periodo: "semana" },
    }));

  return {
    tarea: "pedidos",
    text: parts.join(" "),
    table: rows.length
      ? {
          columns: [
            { key: "local", label: "Local" },
            { key: "proveedor", label: "Proveedor" },
            { key: "productos", label: "Productos", align: "right" },
            { key: "importe", label: "Importe aprox.", align: "right" },
          ],
          rows: rows.slice(0, MAX_ROWS).map((g) => ({ local: locationName(ctx, g.locationId), proveedor: g.supplier, productos: String(g.lines), importe: formatMoney(g.total) })),
          ...(rows.length > MAX_ROWS ? { more: rows.length - MAX_ROWS } : {}),
        }
      : null,
    followUps,
    navigate: { route: "/pedidos", filters: {}, auto: false },
  };
}

// Equilibrar locales ------------------------------------------------------------------------------------

async function equilibrar({ ctx, source, locationIds, now }: TareaInput): Promise<TareaResult> {
  if (ctx.locations.length < 2) return { tarea: "equilibrar", text: "Solo tienes un local: no hay nada que equilibrar.", table: null, followUps: [] };
  // Lo que falta, en los locales pedidos; lo que sobra, en cualquiera de los del usuario.
  const all = ctx.locations.map((l) => l.id);
  const [needs, balances, lps, movements] = await Promise.all([
    computeReorder(source, { locationIds, areaId: null, productIds: [], period: null, horizonDays: 3, horizonLabel: "los próximos 3 días", now }, ctx),
    source.balances({ locationIds: all }),
    source.locationProducts({ locationIds: all }),
    source.movements({ locationIds: all, since: `${addDays(today(ctx, all[0], now), -28)}T00:00:00Z` }),
  ]);
  const key = (l: string, p: string) => `${l}:${p}`;
  const stock = new Map(balances.map((b) => [key(b.locationId, b.productId), new Decimal(b.qty)]));
  const levels = new Map(lps.map((lp) => [key(lp.locationId, lp.productId), { min: new Decimal(lp.minQty), par: new Decimal(lp.parQty) }]));
  const usedPerDay = new Map<string, Decimal>();
  for (const m of movements) {
    const q = new Decimal(m.qty);
    if (m.type === "consumption" || m.type === "waste" || ((m.type === "count_adjustment" || m.type === "manual_adjustment") && q.lt(0))) {
      usedPerDay.set(key(m.locationId, m.productId), (usedPerDay.get(key(m.locationId, m.productId)) ?? new Decimal(0)).plus(q.abs().div(28)));
    }
  }
  // Lo que un local puede ceder sin quedarse corto: por encima de su objetivo, de su mínimo más una
  // semana de consumo y, si no tiene niveles, de una semana de consumo.
  const surplus = (locationId: string, productId: string): Decimal => {
    const qty = stock.get(key(locationId, productId)) ?? new Decimal(0);
    const lv = levels.get(key(locationId, productId)) ?? { min: new Decimal(0), par: new Decimal(0) };
    const week = (usedPerDay.get(key(locationId, productId)) ?? new Decimal(0)).mul(7);
    return Decimal.max(0, qty.minus(Decimal.max(lv.par, lv.min.plus(week), week)));
  };

  type Move = { product: Product; from: string; to: string; qty: Decimal; why: string; value: Decimal };
  const moves: Move[] = [];
  const given = new Map<string, Decimal>();
  for (const need of needs) {
    if (need.suggested.lte(0)) continue;
    const unit = countUnit(need.product);
    const donors = all
      .filter((l) => l !== need.lp.locationId)
      .map((l) => ({ l, free: surplus(l, need.product.id).minus(given.get(key(l, need.product.id)) ?? 0) }))
      .filter((d) => d.free.gte(unit))
      .sort((a, b) => b.free.cmp(a.free));
    const donor = donors[0];
    if (!donor) continue;
    // Botellas o unidades enteras: no se traspasa media botella.
    const qty = Decimal.min(need.suggested, donor.free).div(unit).floor().mul(unit);
    if (qty.lte(0)) continue;
    given.set(key(donor.l, need.product.id), (given.get(key(donor.l, need.product.id)) ?? new Decimal(0)).plus(qty));
    const cost = balances.find((b) => b.locationId === donor.l && b.productId === need.product.id)?.avgCost ?? "0";
    moves.push({
      product: need.product,
      from: donor.l,
      to: need.lp.locationId,
      qty,
      value: qty.mul(cost),
      why: `${locationName(ctx, need.lp.locationId)} tiene ${formatStock(need.qty, need.product)}${need.min.gt(0) ? ` (mínimo ${formatStock(need.min, need.product)})` : ""}; ${locationName(ctx, donor.l)} puede ceder ${formatStock(donor.free, need.product)}`,
    });
  }

  if (moves.length === 0) {
    const short = needs.filter((n) => n.suggested.gt(0)).length;
    return {
      tarea: "equilibrar",
      text: short > 0
        ? `Faltan ${plural(short, "producto", "productos")}, pero ningún otro local tiene de sobra para cederlos: tocará pedirlos.`
        : "Todos los locales están por encima de sus mínimos: no hace falta mover nada.",
      table: null,
      followUps: short > 0 ? [{ label: TAREAS.pedidos.label, plan: { type: "tarea", tarea: "pedidos", locationIds } }] : [],
    };
  }
  moves.sort((a, b) => b.value.cmp(a.value));
  const saved = moves.reduce((acc, m) => acc.plus(m.value), new Decimal(0));
  const followUps: TareaFollowUp[] = moves.slice(0, MAX_BUTTONS).map((m) => ({
    label: `Pasar ${formatStock(m.qty, m.product)} de ${m.product.name} · ${locationName(ctx, m.from)} → ${locationName(ctx, m.to)}`,
    plan: {
      type: "accion",
      accion: "traspaso",
      locationId: m.from,
      locationOutcome: "actuar",
      toLocationId: m.to,
      toLocationOutcome: "actuar",
      areaId: null,
      // En unidad base (ml, g, ud): la cantidad exacta, sin elegir formato.
      products: [{ product: m.product, segmentIndex: 0, amount: m.qty.toString(), unit: m.product.baseUnit, price: null, quantityOutcome: "actuar", productOutcome: "actuar" }],
      motivo: "no_indicado",
      ambiguous: 0,
    },
  }));
  return {
    tarea: "equilibrar",
    text: `${plural(moves.length, "producto se puede", "productos se pueden")} cubrir con stock de otro local en vez de comprarlo${saved.gt(0) ? ` (${formatMoney(saved)} a coste)` : ""}. Cada botón prepara el traspaso para confirmarlo.`,
    table: {
      columns: [
        { key: "producto", label: "Producto" },
        { key: "de", label: "De" },
        { key: "a", label: "A" },
        { key: "cantidad", label: "Cantidad", align: "right" },
        { key: "motivo", label: "Por qué" },
      ],
      rows: moves.slice(0, MAX_ROWS).map((m) => ({ producto: m.product.name, de: locationName(ctx, m.from), a: locationName(ctx, m.to), cantidad: formatStock(m.qty, m.product), motivo: m.why })),
      ...(moves.length > MAX_ROWS ? { more: moves.length - MAX_ROWS } : {}),
    },
    followUps,
    navigate: { route: "/traspasos", filters: {}, auto: false },
  };
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
