import Decimal from "decimal.js";
import type { CountingPacks, UnitDimension } from "@/lib/units";

// Formatos de un producto (botella, caja 6, barril…) tal como los necesitan los formularios.

export type PackRow = { id?: string; name: string; qty_base: number | string; is_count_default: boolean; is_purchase_default?: boolean; active: boolean };
/** Cómo se escribe una cantidad: en botellas, cajas, unidades… (factor = unidades base por cada una). */
export type UnitChoice = { id: string; label: string; factor: string };

const BASE_LABEL: Record<UnitDimension, string> = { count: "Unidades", volume: "ml", mass: "g" };

/** Formatos para escribir cantidades: primero como se cuenta (botella, o unidades en refrescos), luego cajas; ml/g al final. */
export function unitChoices(dimension: UnitDimension, packs: PackRow[]): UnitChoice[] {
  const active = packs.filter((k) => k.active && new Decimal(String(k.qty_base)).gt(0));
  const base: UnitChoice = { id: "base", label: BASE_LABEL[dimension], factor: "1" };
  const byPack = [...active]
    .filter((k) => dimension !== "count" || new Decimal(String(k.qty_base)).gt(1))
    .sort((a, b) => Number(b.is_count_default) - Number(a.is_count_default) || new Decimal(String(a.qty_base)).cmp(String(b.qty_base)))
    .map((k) => ({ id: k.id ?? k.name, label: k.name, factor: String(k.qty_base) }));
  return dimension === "count" ? [base, ...byPack] : [...byPack, base];
}

/** Formato de conteo y caja de compra de un producto (para «2 cajas + 5 ud»). */
export function countingPacks(dimension: UnitDimension, packs: PackRow[]): CountingPacks {
  const active = packs.filter((k) => k.active);
  const count = active.find((k) => k.is_count_default);
  const box = [...active]
    .filter((k) => new Decimal(String(k.qty_base)).gt(1))
    .sort((a, b) => Number(b.is_purchase_default ?? false) - Number(a.is_purchase_default ?? false) || new Decimal(String(b.qty_base)).cmp(String(a.qty_base)))[0];
  return {
    dimension,
    countPack: count ? { name: count.name, qtyBase: String(count.qty_base) } : null,
    purchasePack: box ? { name: box.name, qtyBase: String(box.qty_base) } : null,
  };
}

/** Cantidad escrita en un formato → unidad base (ml, g, ud) con decimal.js. */
export function toBaseQty(units: UnitChoice[], qty: string, unitId: string): number {
  const unit = units.find((u) => u.id === unitId) ?? units[0];
  return new Decimal(qty).mul(unit?.factor ?? "1").toNumber();
}
