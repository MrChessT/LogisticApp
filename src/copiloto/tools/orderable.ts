import type { SupplierPriceRaw } from "./types";

/**
 * Los precios de los que se puede pedir: fuera las fuentes de precio (escandallos importados, estimados, 0061).
 * Valorar sí las usa; elegir a quién pedir, nunca: si no, la fuente con el último precio recibía el pedido.
 */
export function forOrdering<T extends Pick<SupplierPriceRaw, "priceSource">>(prices: T[]): T[] {
  return prices.filter((p) => !p.priceSource);
}
