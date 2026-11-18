// Tareas de reposición: «preparar pedidos» y «equilibrar locales». Las dos salen de la misma decisión
// (tools/reorder-plan.ts): primero lo que se cubre con un traspaso, luego lo que toca pedir HOY a cada proveedor según
// su ficha, y lo que se acaba antes de que llegue cualquier pedido, lo primero de todo.
import Decimal from "decimal.js";
import { formatDayLong } from "../../lib/supplier-terms";
import type { ActionPlan } from "../agent/plans";
import { formatDecimal, formatMoney, formatStock } from "../entities/units";
import { planReplenishment, type PlannedTransfer, type ReplenishmentPlan, type SupplierBatch } from "../tools/reorder-plan";
import { locationName, MAX_BUTTONS, MAX_ROWS, plural, TAREAS, type TareaFollowUp, type TareaInput, type TareaResult } from "./tarea-types";

const MAX_LISTED = 3;

function transferPlan(m: PlannedTransfer): ActionPlan {
  return {
    type: "accion",
    accion: "traspaso",
    locationId: m.fromLocationId,
    locationOutcome: "actuar",
    toLocationId: m.toLocationId,
    toLocationOutcome: "actuar",
    areaId: null,
    // En unidad base (ml, g, ud): la cantidad exacta, sin elegir formato.
    products: [{ product: m.product, segmentIndex: 0, amount: m.qty.toString(), unit: m.product.baseUnit, price: null, quantityOutcome: "actuar", productOutcome: "actuar" }],
    motivo: "no_indicado",
    ambiguous: 0,
  };
}

function transferButton(ctx: TareaInput["ctx"], m: PlannedTransfer): TareaFollowUp {
  return {
    label: `Pasar ${formatStock(m.qty, m.product)} de ${m.product.name} · ${locationName(ctx, m.fromLocationId)} → ${locationName(ctx, m.toLocationId)}`,
    plan: transferPlan(m),
  };
}

const linesOf = (batches: SupplierBatch[]) => batches.reduce((n, b) => n + b.lines.length, 0);

/** Lo urgente, en una frase: qué se acaba antes de que llegue un pedido y qué lo arregla. */
function urgentText(ctx: TareaInput["ctx"], plan: ReplenishmentPlan): string | null {
  if (plan.urgent.length === 0) return null;
  const items = plan.urgent.slice(0, MAX_LISTED).map((u) => {
    const where = `${u.product.name} en ${locationName(ctx, u.locationId)}`;
    const facts = [u.days ? `da para ${formatDecimal(u.days, 1)} días` : null, u.arrives ? `lo próximo llega el ${formatDayLong(u.arrives)}` : null].filter(Boolean);
    const days = facts.length ? ` (${facts.join("; ")})` : "";
    return `${where}${days}${u.fix === "traspaso" ? ", que se cubre con un traspaso" : ", sin pedido que llegue a tiempo: llama al proveedor o cómpralo fuera"}`;
  });
  const more = plan.urgent.length > MAX_LISTED ? ` y ${plan.urgent.length - MAX_LISTED} más` : "";
  return `Se acaba antes de que llegue un pedido: ${items.join("; ")}${more}.`;
}

/** «Bebidas del Sur el jueves 24 sep (2 productos)»: lo que espera al día de pedido de su proveedor. */
function laterText(plan: ReplenishmentPlan): string | null {
  if (plan.later.length === 0) return null;
  const bySupplier = new Map<string, { date: string; lines: number }>();
  for (const b of plan.later) {
    const cur = bySupplier.get(b.supplierName);
    const date = b.cycle!.next.orderDate;
    bySupplier.set(b.supplierName, { date: cur && cur.date < date ? cur.date : date, lines: (cur?.lines ?? 0) + b.lines.length });
  }
  const items = [...bySupplier].slice(0, MAX_LISTED).map(([name, v]) => `${name} el ${formatDayLong(v.date)} (${plural(v.lines, "producto", "productos")})`);
  const more = bySupplier.size > MAX_LISTED ? ` y ${bySupplier.size - MAX_LISTED} proveedores más` : "";
  return `Esperan a su día de pedido: ${items.join(", ")}${more}.`;
}

export async function pedidos({ ctx, source, locationIds, now }: TareaInput): Promise<TareaResult> {
  const plan = await planReplenishment({ ctx, source, locationIds, now });
  const todayLines = linesOf(plan.today);
  if (plan.transfers.length === 0 && todayLines === 0 && plan.later.length === 0 && plan.noSupplier.length === 0 && plan.noPack.length === 0) {
    return {
      tarea: "pedidos",
      text: "No hace falta pedir ni mover nada: con el stock, los mínimos y lo que ya está en camino se llega al próximo pedido de cada proveedor.",
      table: null,
      followUps: [],
    };
  }

  const total = plan.today.reduce((acc, b) => acc.plus(b.total), new Decimal(0));
  const saved = plan.transfers.reduce((acc, m) => acc.plus(m.value), new Decimal(0));
  const locations = new Set(plan.today.map((b) => b.locationId));
  const suppliers = new Set(plan.today.map((b) => b.supplierId));
  const parts = [urgentText(ctx, plan)];
  if (plan.transfers.length > 0) {
    parts.push(`Antes de comprar: ${plural(plan.transfers.length, "producto se cubre", "productos se cubren")} con stock de otro local${saved.gt(0) ? ` (${formatMoney(saved)} a coste)` : ""}.`);
  }
  parts.push(
    todayLines > 0
      ? `Hoy toca pedir ${plural(todayLines, "producto", "productos")} a ${plural(suppliers.size, "proveedor", "proveedores")} en ${plural(locations.size, "local", "locales")}${total.gt(0) ? `, unos ${formatMoney(total)} sin IVA` : ""}.`
      : "Hoy no toca hacer ningún pedido.",
  );
  parts.push(laterText(plan));
  const short = plan.today.filter((b) => b.minShortfall);
  if (short.length > 0) {
    parts.push(`No llegan al pedido mínimo: ${short.slice(0, MAX_LISTED).map((b) => `${b.supplierName} en ${locationName(ctx, b.locationId)} (faltan ${formatMoney(b.minShortfall!)})`).join(", ")}.`);
  }
  if (plan.missingTerms.length > 0) {
    parts.push(`Sin días de pedido en su ficha (se cubre una semana): ${plan.missingTerms.slice(0, 4).join(", ")}${plan.missingTerms.length > 4 ? "…" : ""}.`);
  }
  const noSupplier = [...new Set([...plan.noSupplier, ...plan.noPack].map((x) => x.product.name))];
  if (noSupplier.length > 0) parts.push(`Sin proveedor o formato de compra (no entran): ${noSupplier.slice(0, 4).join(", ")}${noSupplier.length > 4 ? "…" : ""}.`);

  // Botones: primero los traspasos de lo urgente, luego el pedido de hoy de cada local.
  const transfers = [...plan.transfers].sort((a, b) => Number(isUrgent(plan, b)) - Number(isUrgent(plan, a)) || b.value.cmp(a.value));
  const orderButtons: TareaFollowUp[] = [...locations].map((locationId) => ({
    label: `Preparar pedido · ${locationName(ctx, locationId)}`,
    plan: { type: "catalogo", accion: "preparar_pedido", locationId, locationOutcome: "actuar", products: [], periodo: "no_indicado" },
  }));
  const transferRoom = Math.max(MAX_BUTTONS - orderButtons.length, Math.min(2, transfers.length));
  const followUps = [...transfers.slice(0, transferRoom).map((m) => transferButton(ctx, m)), ...orderButtons].slice(0, MAX_BUTTONS);
  if (followUps.length > 0) parts.push("Cada botón deja el traspaso o el pedido en borrador para que lo revises.");

  const rows = [...plan.today].sort((a, b) => locationName(ctx, a.locationId).localeCompare(locationName(ctx, b.locationId)) || b.total.cmp(a.total));
  return {
    tarea: "pedidos",
    text: parts.filter((p): p is string => !!p).join(" "),
    table: rows.length
      ? {
          columns: [
            { key: "local", label: "Local" },
            { key: "proveedor", label: "Proveedor" },
            { key: "productos", label: "Productos", align: "right" },
            { key: "importe", label: "Importe aprox.", align: "right" },
            { key: "entrega", label: "Llega" },
          ],
          rows: rows.slice(0, MAX_ROWS).map((b) => ({
            local: locationName(ctx, b.locationId),
            proveedor: b.supplierName,
            productos: String(b.lines.length),
            importe: formatMoney(b.total),
            entrega: b.cycle?.next.deliveryDate ? formatDayLong(b.cycle.next.deliveryDate) : "—",
          })),
          ...(rows.length > MAX_ROWS ? { more: rows.length - MAX_ROWS } : {}),
        }
      : null,
    followUps,
    navigate: { route: "/pedidos", filters: {}, auto: false },
  };
}

const isUrgent = (plan: ReplenishmentPlan, m: PlannedTransfer) => plan.urgent.some((u) => u.fix === "traspaso" && u.locationId === m.toLocationId && u.product.id === m.product.id);

export async function equilibrar({ ctx, source, locationIds, now }: TareaInput): Promise<TareaResult> {
  if (ctx.locations.length < 2) return { tarea: "equilibrar", text: "Solo tienes un local: no hay nada que equilibrar.", table: null, followUps: [] };
  const plan = await planReplenishment({ ctx, source, locationIds, now });
  const moves = [...plan.transfers].sort((a, b) => Number(isUrgent(plan, b)) - Number(isUrgent(plan, a)) || b.value.cmp(a.value));
  if (moves.length === 0) {
    const short = linesOf(plan.today) + linesOf(plan.later) + plan.noSupplier.length + plan.noPack.length;
    return {
      tarea: "equilibrar",
      text: short > 0
        ? `Faltan ${plural(short, "producto", "productos")}, pero ningún otro local tiene de sobra para cederlos: tocará pedirlos.`
        : "Todos los locales llegan a su próximo pedido: no hace falta mover nada.",
      table: null,
      followUps: short > 0 ? [{ label: TAREAS.pedidos.label, plan: { type: "tarea", tarea: "pedidos", locationIds } }] : [],
    };
  }
  const saved = moves.reduce((acc, m) => acc.plus(m.value), new Decimal(0));
  const why = (m: PlannedTransfer) =>
    `${locationName(ctx, m.toLocationId)} tiene ${formatStock(m.stockAtTarget, m.product)}${m.minAtTarget.gt(0) ? ` (mínimo ${formatStock(m.minAtTarget, m.product)})` : ""}; ${locationName(ctx, m.fromLocationId)} puede ceder ${formatStock(m.free, m.product)}`;
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
      rows: moves.slice(0, MAX_ROWS).map((m) => ({ producto: m.product.name, de: locationName(ctx, m.fromLocationId), a: locationName(ctx, m.toLocationId), cantidad: formatStock(m.qty, m.product), motivo: why(m) })),
      ...(moves.length > MAX_ROWS ? { more: moves.length - MAX_ROWS } : {}),
    },
    followUps: moves.slice(0, MAX_BUTTONS).map((m) => transferButton(ctx, m)),
    navigate: { route: "/traspasos", filters: {}, auto: false },
  };
}
