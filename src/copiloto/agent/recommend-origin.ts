// «¿Desde qué local sale la mercancía?» con la opción recomendada primero: el local al que le sobra ese producto
// (stock por encima de su objetivo), con el motivo. Es la misma idea que «equilibrar locales». Recomendar no es
// actuar: sin pulsar (o escribir) un local no hay borrador.
import Decimal from "decimal.js";
import type { Product, SessionContext } from "../domain";
import { formatStock } from "../entities/units";
import { asChoice } from "../jev/gates/gate";
import type { JevResult } from "../jev/client";
import type { RoutingMeta } from "../jev/request";
import type { InventoryDataSource } from "../tools/types";
import type { ClarifyPlan } from "./plans";

/** El producto del traspaso: el elegido al aclarar o el que Jev pone primero. */
function productOf(routing: { meta: RoutingMeta; jev: JevResult } | undefined, overrides: Record<string, string>, ctx: SessionContext): Product | undefined {
  if (overrides.producto_elegido) return ctx.products.find((p) => p.id === overrides.producto_elegido);
  const segment = routing?.meta.segments[0];
  const answer = asChoice(routing?.jev.answers.producto_0);
  return answer && segment ? segment.candidates.get(answer.choice) : undefined;
}

export async function recommendOrigin(
  plan: ClarifyPlan,
  input: { routing: { meta: RoutingMeta; jev: JevResult } | undefined; overrides: Record<string, string>; ctx: SessionContext; source: InventoryDataSource },
): Promise<ClarifyPlan> {
  if (plan.field !== "local" || !plan.question.startsWith("¿Desde qué local sale") || plan.options.length < 2) return plan;
  const product = productOf(input.routing, input.overrides, input.ctx);
  if (!product) return plan;
  const byName = new Map(input.ctx.locations.map((l) => [l.name, l.id]));
  const idOf = (option: string) => input.routing?.meta.locationKeys.get(option) ?? byName.get(option);
  const ids = plan.options.map((o) => idOf(o.id)).filter((id): id is string => id !== undefined);
  if (ids.length === 0) return plan;
  const [balances, levels] = await Promise.all([
    input.source.balances({ locationIds: ids, productIds: [product.id] }).catch(() => []),
    input.source.locationProducts({ locationIds: ids, productIds: [product.id] }).catch(() => []),
  ]);
  const surplus = new Map(
    ids.map((id) => {
      const qty = new Decimal(balances.find((b) => b.locationId === id)?.qty ?? 0);
      const level = levels.find((l) => l.locationId === id);
      const target = Decimal.max(level?.minQty ?? 0, level?.parQty ?? 0);
      return [id, qty.minus(target)] as const;
    }),
  );
  const best = [...surplus.entries()].filter(([, s]) => s.gt(0)).sort((a, b) => b[1].cmp(a[1]))[0];
  if (!best) return plan;
  const [bestId, extra] = best;
  const first = plan.options.find((o) => idOf(o.id) === bestId)!;
  return {
    ...plan,
    options: [{ ...first, label: `${first.label} (recomendado: le sobran ${formatStock(extra, product)} de ${product.name})` }, ...plan.options.filter((o) => o !== first)],
  };
}
