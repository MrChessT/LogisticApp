// Borrador de pedido a proveedor: uno por proveedor, que se guarda en BORRADOR al confirmar (enviarlo sigue siendo
// una decisión humana en /pedidos).
//
//   · Con cantidades en el mensaje («3 cajas de coca»): eso, en formatos de compra.
//   · Con proveedor o periodo dichos («el pedido de la semana a Makro»): lo que falta para ese periodo.
//   · Sin nada más («prepárame el pedido»): la decisión de reposición (tools/reorder-plan.ts). Lo que se cubre con
//     un traspaso no se compra, lo del proveedor que hoy no admite pedidos espera a su día, y cada proveedor cubre
//     hasta que llegue su pedido siguiente.
import Decimal from "decimal.js";
import type { DraftCheck, OrderDraft } from "../contract/index";
import type { Pack, Product } from "../domain";
import { businessDay } from "../../lib/business-day";
import { formatDayLong, minOrderShortfall, nextDelivery } from "../../lib/supplier-terms";
import { mentionedSupplier } from "../entities/catalog-parser";
import { formatDecimal, formatMoney, formatStock } from "../entities/units";
import { forOrdering } from "../tools/orderable";
import { horizon } from "../tools/periods";
import { planReplenishment, type ReplenishmentPlan } from "../tools/reorder-plan";
import { computeReorder } from "../tools/tools";
import type { BuildResult } from "./builder";
import { draftBase, resolveQuantity } from "./builder";
import type { CatalogBuildInput } from "./catalog-builder";
import { check, nameList } from "./draft-checks";
import { MAX_CHECKS, MAX_ORDER_LINES, MAX_ORDER_SUPPLIERS } from "./schemas";

const DECISION_LABEL = "hasta el próximo pedido";

type Wanted = { product: Product; pack: Pack; packs: Decimal; note: string; supplier?: { id: string; name: string }; price?: string | null };

const purchasePack = (p: Product): Pack | null => p.packs.find((k) => k.isPurchaseDefault) ?? (p.packs.length === 1 ? p.packs[0]! : null);

/** Lo que la decisión deja fuera del pedido de hoy, dicho en el borrador: traspasos, días de pedido y urgencias. */
function decisionChecks(plan: ReplenishmentPlan, locationName: (id: string) => string): DraftCheck[] {
  const out: DraftCheck[] = [];
  if (plan.transfers.length > 0) {
    const items = plan.transfers.map((m) => `${m.product.name} (${formatStock(m.qty, m.product)} desde ${locationName(m.fromLocationId)})`);
    out.push(check("traspaso", "Antes de comprar", "aviso", `Se cubre con traspaso, no se pide: ${nameList(items, 200)}. Prepáralo con «equilibrar locales».`));
  }
  if (plan.later.length > 0) {
    const items = plan.later.map((b) => `${b.supplierName} el ${formatDayLong(b.cycle!.next.orderDate)} (${b.lines.length})`);
    out.push(check("espera", "Día de pedido", "ok", `Esperan a su día, no van hoy: ${nameList(items, 200)}.`));
  }
  const stranded = plan.urgent.filter((u) => u.fix === "ninguno");
  if (stranded.length > 0) {
    out.push(check("urgente", "Se acaba antes", "aviso", `No llega a tiempo ningún pedido: ${nameList(stranded.map((u) => u.product.name), 180)}. Llama al proveedor o cómpralo fuera.`));
  }
  return out;
}

export async function buildOrder({ plan, message, ctx, source, overrides, now }: CatalogBuildInput): Promise<BuildResult> {
  const locationId = plan.locationId;
  const location = ctx.locations.find((l) => l.id === locationId);
  if (!locationId || !location) return { kind: "error", message: "Necesito saber para qué local es el pedido." };
  const locationName = (id: string) => ctx.locations.find((l) => l.id === id)?.name ?? "otro local";
  const today = businessDay(now, location.timezone, location.dayCutoff);
  const periodo = plan.periodo ?? "no_indicado";
  const chosenSupplier = ctx.suppliers.find((s) => s.id === overrides.proveedor) ?? mentionedSupplier(message, ctx.suppliers);
  const fmt = (v: Decimal.Value, p: Product) => formatStock(v, p);

  const wanted: Wanted[] = [];
  const warnings: string[] = [];
  const noPack: string[] = [];
  const noConsumption: string[] = [];
  const decision: DraftCheck[] = [];
  const noSupplier: string[] = [];
  const explicit = plan.products.filter((p) => p.amount !== null);
  const useDecision = explicit.length === 0 && !chosenSupplier && (periodo === "no_indicado" || periodo === "hoy");
  // Sin periodo, un pedido cubre una semana (no los 3 días de la consulta «¿qué me falta?»).
  const h = useDecision
    ? { days: 0, label: DECISION_LABEL }
    : periodo === "no_indicado" || periodo === "hoy" || periodo === "ayer" || periodo === "personalizado"
      ? { days: 7, label: "la próxima semana" }
      : horizon(periodo, today);
  let missingTerms: string[] = [];

  if (explicit.length > 0) {
    for (const p of explicit) {
      const q = resolveQuantity(p, overrides);
      if ("type" in q) return { kind: "clarify", plan: q };
      warnings.push(...q.warnings);
      const pack = q.pack ?? purchasePack(p.product);
      if (!pack) {
        noPack.push(p.product.name);
        continue;
      }
      // Si lo pide en ese formato, esa cantidad; si lo pide en ml/g/ud, formatos enteros hacia arriba.
      const packs = q.pack ? new Decimal(q.input.amount) : q.qtyBase.div(pack.qtyBase).ceil();
      wanted.push({ product: p.product, pack, packs, note: "cantidad indicada por ti" });
    }
  } else if (useDecision) {
    const decided = await planReplenishment({ ctx, source, locationIds: [locationId], now, productIds: plan.products.map((p) => p.product.id) });
    for (const b of decided.today) {
      for (const l of b.lines) {
        if (l.line.avg.isZero()) noConsumption.push(l.line.product.name);
        const parts = [`quedan ${fmt(l.line.qty, l.line.product)}`];
        if (l.line.pendingIn.gt(0)) parts.push(`en camino ${fmt(l.line.pendingIn, l.line.product)}`);
        if (l.line.coverage) parts.push(`da para ${formatDecimal(l.line.coverage, 1)} días`);
        wanted.push({ product: l.line.product, pack: l.pack, packs: l.packs, note: parts.join(" · "), supplier: { id: b.supplierId, name: b.supplierName }, price: l.price });
      }
    }
    noPack.push(...decided.noPack.map((x) => x.product.name));
    missingTerms = decided.missingTerms;
    decision.push(...decisionChecks(decided, locationName));
    noSupplier.push(...decided.noSupplier.map((x) => x.product.name));
    if (wanted.length === 0 && decision.length > 0) {
      const orphans = noSupplier.length > 0 ? ` Sin proveedor (no sé a quién pedirlos): ${nameList(noSupplier, 160)}.` : "";
      return {
        kind: "error",
        message: `Hoy no toca pedir nada en ${location.name}. ${decision.map((c) => c.detail).join(" ")}${orphans}`.trim(),
        navigate: { route: "/pedidos", filters: { locationId }, auto: false },
      };
    }
  } else {
    const productIds = plan.products.map((p) => p.product.id);
    const lines = (
      await computeReorder(source, { locationIds: [locationId], areaId: null, productIds, period: null, horizonDays: h.days, horizonLabel: h.label, now }, ctx)
    ).filter((l) => l.suggested.gt(0));
    for (const l of lines) {
      const pack = purchasePack(l.product);
      if (!pack) {
        noPack.push(l.product.name);
        continue;
      }
      if (l.avg.isZero()) noConsumption.push(l.product.name);
      const parts = [`quedan ${fmt(l.qty, l.product)}`];
      if (l.pendingIn.gt(0)) parts.push(`en camino ${fmt(l.pendingIn, l.product)}`);
      if (l.coverage) parts.push(`da para ${formatDecimal(l.coverage, 1)} días`);
      wanted.push({ product: l.product, pack, packs: l.suggested.div(pack.qtyBase).ceil(), note: parts.join(" · ") });
    }
  }

  // Proveedor: el que diga el mensaje para todo el pedido; el de la decisión; si no, el del último precio de cada
  // formato entre los que sirven a este local (un proveedor sin locales marcados sirve a todos). Nunca una fuente
  // de precio: con el último precio se llevaba el pedido entero.
  const prices = forOrdering(await source.supplierPrices(wanted.map((w) => w.pack.id)));
  const termsList = await source.supplierTerms([...new Set([...prices.map((p) => p.supplierId), ...wanted.flatMap((w) => (w.supplier ? [w.supplier.id] : [])), ...(chosenSupplier ? [chosenSupplier.id] : [])])]);
  const termsOf = new Map(termsList.map((t) => [t.supplierId, t]));
  const serves = (supplierId: string) => {
    const ids = termsOf.get(supplierId)?.locationIds;
    return !ids || ids.includes(locationId);
  };
  const groups = new Map<string, OrderDraft["orders"][number]>();
  const noPrice: string[] = [];
  for (const w of wanted) {
    const price = w.supplier
      ? prices.find((p) => p.packId === w.pack.id && p.supplierId === w.supplier!.id)
      : chosenSupplier
        ? prices.find((p) => p.packId === w.pack.id && p.supplierId === chosenSupplier.id)
        : prices.find((p) => p.packId === w.pack.id && serves(p.supplierId)) ?? prices.find((p) => p.packId === w.pack.id);
    const supplier = w.supplier ?? chosenSupplier ?? (price ? { id: price.supplierId, name: price.supplierName } : null);
    if (!supplier) {
      noSupplier.push(w.product.name);
      continue;
    }
    if (!price) noPrice.push(w.product.name);
    const group = groups.get(supplier.id) ?? { supplierId: supplier.id, supplierName: supplier.name, lines: [] };
    group.lines.push({
      productId: w.product.id,
      productName: w.product.name,
      packId: w.pack.id,
      packName: w.pack.name,
      packsQty: w.packs.toString(),
      packPrice: price ? new Decimal(price.lastPrice).toString() : (w.price ?? null),
      note: w.note,
    });
    groups.set(supplier.id, group);
  }
  // Un pedido muy largo no cabe en la tarjeta del chat: por proveedor van las líneas más urgentes
  // (computeReorder las da ordenadas por cobertura) y se avisa de cuántas quedan fuera.
  let left = 0;
  const orders = [...groups.values()].slice(0, MAX_ORDER_SUPPLIERS);
  for (const g of [...groups.values()].slice(MAX_ORDER_SUPPLIERS)) left += g.lines.length;
  for (const o of orders) {
    if (o.lines.length > MAX_ORDER_LINES) {
      left += o.lines.length - MAX_ORDER_LINES;
      o.lines = o.lines.slice(0, MAX_ORDER_LINES);
    }
  }
  // Entrega prevista y pedido mínimo de cada proveedor (condiciones de su ficha).
  const tz = location.timezone;
  const termsChecks: DraftCheck[] = [];
  for (const o of orders) {
    const t = termsOf.get(o.supplierId);
    if (!t) continue;
    const next = nextDelivery(t, now, tz);
    o.expectedDate = next.deliveryDate;
    if (next.deliveryDate) {
      termsChecks.push(
        check(`entrega-${o.supplierId}`, "Entrega", "ok", `${o.supplierName}: ${next.orderToday ? "si se pide hoy" : `se puede pedir el ${formatDayLong(next.orderDate)}`}, llegaría el ${formatDayLong(next.deliveryDate)}.`),
      );
    } else if (!next.orderToday) {
      termsChecks.push(check(`entrega-${o.supplierId}`, "Día de pedido", "aviso", `${o.supplierName} no admite pedidos hoy: el próximo día es el ${formatDayLong(next.orderDate)}.`));
    }
    const subtotal = o.lines.reduce((acc, l) => (l.packPrice ? acc.plus(new Decimal(l.packsQty).mul(l.packPrice)) : acc), new Decimal(0));
    const missing = minOrderShortfall(subtotal, t.minOrder);
    if (missing) {
      termsChecks.push(
        check(`minimo-${o.supplierId}`, "Pedido mínimo", "aviso", `${o.supplierName} pide un mínimo de ${formatMoney(new Decimal(t.minOrder!))}: faltan ${formatMoney(missing)}. Añade algo más o júntalo con el siguiente pedido.`),
      );
    }
    if (!serves(o.supplierId)) {
      termsChecks.push(check(`local-${o.supplierId}`, "Local", "aviso", `${o.supplierName} no tiene marcado ${location.name} entre los locales a los que sirve.`));
    }
  }

  if (orders.length === 0) {
    if (noSupplier.length > 0) {
      return {
        kind: "error",
        message: `No sé a qué proveedor pedir ${nameList(noSupplier)}. Dime el proveedor (por ejemplo «… a Makro») o añade su precio en la ficha del producto.`,
      };
    }
    if (noPack.length > 0) return { kind: "error", message: `${nameList(noPack)} no ${noPack.length === 1 ? "tiene" : "tienen"} formato de compra: añádelo en su ficha.` };
    // Sin mínimos puestos el cálculo no tiene con qué comparar: decirlo, no «no hace falta nada».
    const lps = await source.locationProducts({ locationIds: [locationId] });
    if (!lps.some((lp) => new Decimal(lp.minQty).gt(0) || new Decimal(lp.parQty).gt(0))) {
      return {
        kind: "error",
        message: `${location.name} no tiene mínimos puestos, así que no puedo calcular qué pedir. Ponlos en Stock o dime los productos y cantidades (por ejemplo «pide 3 cajas de coca para ${location.name}»).`,
        navigate: { route: "/stock", filters: { locationId }, auto: false },
      };
    }
    return {
      kind: "error",
      message: `No hace falta pedir nada en ${location.name} ${useDecision ? "hasta el próximo pedido de cada proveedor" : `para ${h.label}`}: con el stock, los mínimos y lo que ya está en camino es suficiente.`,
      navigate: { route: "/pedidos", filters: { locationId }, auto: false },
    };
  }

  const notes: DraftCheck[] = [...decision];
  if (left > 0) {
    notes.push(
      check("largo", "Pedido largo", "aviso", `Van las ${MAX_ORDER_LINES} líneas más urgentes de cada proveedor; quedan fuera ${left}. Para verlo entero, usa «Sugerir pedido» en Pedidos.`),
    );
  }
  if (noConsumption.length > 0) {
    notes.push(check("consumo", "Sin consumo", "aviso", `Sin consumo registrado: ${nameList(noConsumption)}. Se pide solo lo necesario para llegar al mínimo u objetivo.`));
  }
  if (noSupplier.length > 0) notes.push(check("proveedor", "Sin proveedor", "aviso", `No se incluyen (no sé a quién pedirlos): ${nameList(noSupplier)}.`));
  if (noPack.length > 0) notes.push(check("formato", "Sin formato", "aviso", `No se incluyen (sin formato de compra): ${nameList(noPack)}.`));
  if (noPrice.length > 0) notes.push(check("precio", "Sin precio", "aviso", `Sin precio con ese proveedor: ${nameList(noPrice)}. El total es aproximado.`));
  // Con muchos proveedores las condiciones de entrega no caben todas: primero los avisos de entrega y
  // mínimo, que piden hacer algo; la fecha prevista sigue en cada pedido.
  const room = Math.max(0, MAX_CHECKS - 1 - notes.length);
  const terms = termsChecks.length <= room ? termsChecks : termsChecks.filter((c) => c.status !== "ok").concat(termsChecks.filter((c) => c.status === "ok")).slice(0, room);
  const origin =
    explicit.length > 0
      ? check("origen", "Cantidades", "ok", "Las que has indicado, en formatos de compra.")
      : useDecision
        ? check(
            "origen",
            "Cálculo",
            "ok",
            `Consumo real, mínimos y objetivo, descontando lo que ya está en camino; cada proveedor cubre hasta que llegue su pedido siguiente${missingTerms.length ? ` (sin días de pedido en su ficha, una semana: ${nameList(missingTerms, 80)})` : ""}.`,
          )
        : check("origen", "Cálculo", "ok", `Consumo real de las últimas semanas, mínimos y objetivo, descontando lo que ya está en camino, para ${h.label}.`);
  const checks: DraftCheck[] = [origin, ...terms, ...notes].slice(0, MAX_CHECKS);
  if (plan.locationOutcome === "confirmar") warnings.push("Revisa el local.");

  const total = orders.flatMap((o) => o.lines).reduce((acc, l) => (l.packPrice ? acc.plus(new Decimal(l.packsQty).mul(l.packPrice)) : acc), new Decimal(0));
  const count = orders.reduce((n, o) => n + o.lines.length, 0);
  const described = orders.flatMap((o) => o.lines.map((l) => `${formatDecimal(l.packsQty, 2)} × ${l.packName} de ${l.productName} (${o.supplierName})`));
  const title = `Pedido para ${location.name} (${h.label}): ${count} ${count === 1 ? "producto" : "productos"} a ${orders.map((o) => o.supplierName).join(", ")}${total.gt(0) ? ` · ${formatMoney(total)}` : ""}`;
  const draft: OrderDraft = {
    ...draftBase("pedido", title, ctx, warnings, now),
    kind: "pedido",
    locationId,
    locationName: location.name,
    horizonLabel: h.label,
    orders,
    checks,
  };
  return {
    kind: "draft",
    draft,
    summary: {
      operation: "prepare purchase orders to suppliers (saved as drafts, not sent)",
      venue: location.name,
      period: h.label,
      lines: described.join("; ").slice(0, 900),
    },
  };
}
