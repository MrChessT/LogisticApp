// Escandallos: alérgenos, unidades de las líneas y el mismo cálculo de coste que la base de datos
// (recipe_costs) para enseñarlo mientras se escribe. La base de datos es la que manda al guardar.
import Decimal from "decimal.js";
import type { UnitDimension } from "./units";

export const ALLERGENS = [
  { id: "gluten", label: "Gluten", short: "GL" },
  { id: "crustaceos", label: "Crustáceos", short: "CR" },
  { id: "huevo", label: "Huevo", short: "HU" },
  { id: "pescado", label: "Pescado", short: "PE" },
  { id: "cacahuete", label: "Cacahuete", short: "CA" },
  { id: "soja", label: "Soja", short: "SO" },
  { id: "lacteos", label: "Lácteos", short: "LA" },
  { id: "frutos_cascara", label: "Frutos de cáscara", short: "FC" },
  { id: "apio", label: "Apio", short: "AP" },
  { id: "mostaza", label: "Mostaza", short: "MO" },
  { id: "sesamo", label: "Sésamo", short: "SE" },
  { id: "sulfitos", label: "Sulfitos", short: "SU" },
  { id: "altramuces", label: "Altramuces", short: "AL" },
  { id: "moluscos", label: "Moluscos", short: "ML" },
] as const;
export const ALLERGEN_LABEL = Object.fromEntries(ALLERGENS.map((a) => [a.id, a.label])) as Record<string, string>;

export type YieldUnit = "racion" | "g" | "ml" | "ud";
export const YIELD_UNITS: Array<{ id: YieldUnit; label: string }> = [
  { id: "racion", label: "raciones" },
  { id: "g", label: "g" },
  { id: "ml", label: "ml" },
  { id: "ud", label: "ud" },
];

/** Unidad en que se escribe la cantidad de una línea y cuántas unidades base son. */
export type LineUnit = { id: string; label: string; factor: number };

const BY_DIMENSION: Record<UnitDimension, LineUnit[]> = {
  mass: [{ id: "g", label: "g", factor: 1 }, { id: "kg", label: "kg", factor: 1000 }],
  volume: [{ id: "ml", label: "ml", factor: 1 }, { id: "cl", label: "cl", factor: 10 }, { id: "l", label: "l", factor: 1000 }],
  count: [{ id: "ud", label: "ud", factor: 1 }],
};

export function productUnits(dimension: UnitDimension): LineUnit[] {
  return BY_DIMENSION[dimension];
}

export function subRecipeUnits(yieldUnit: YieldUnit): LineUnit[] {
  if (yieldUnit === "g") return BY_DIMENSION.mass;
  if (yieldUnit === "ml") return BY_DIMENSION.volume;
  if (yieldUnit === "ud") return BY_DIMENSION.count;
  return [{ id: "racion", label: "raciones", factor: 1 }];
}

/** Unidad cómoda para enseñar una cantidad guardada en unidad base (1500 g → 1,5 kg). */
export function bestUnit(units: LineUnit[], qtyBase: number): LineUnit {
  const big = [...units].sort((a, b) => b.factor - a.factor).find((u) => u.factor > 1 && qtyBase >= u.factor && Number.isInteger((qtyBase / u.factor) * 100));
  return big ?? units[0]!;
}

const num = (s: string): Decimal | null => {
  const t = s.replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return new Decimal(t);
};

/** Cantidad base de una línea escrita por la persona («1,5» kg → 1500). null si no es válida o es 0. */
export function lineQtyBase(amount: string, unit: LineUnit): Decimal | null {
  const v = num(amount);
  return v && v.gt(0) ? v.mul(unit.factor) : null;
}

/** Merma de limpieza en %; vacío = 0. null si no es válida. */
export function wastePct(raw: string): Decimal | null {
  if (!raw.trim()) return new Decimal(0);
  const v = num(raw);
  return v && v.lt(95) ? v : null;
}

/** Coste de una línea: cantidad / (1 − merma) × coste por unidad base. */
export function lineCost(qtyBase: Decimal, waste: Decimal, unitCost: Decimal | null): Decimal | null {
  if (!unitCost) return null;
  return qtyBase.div(new Decimal(1).minus(waste.div(100))).mul(unitCost);
}

export type Economics = {
  total: Decimal;
  perYieldUnit: Decimal;
  portion: Decimal | null;
  net: Decimal | null;
  foodCostPct: Decimal | null;
  margin: Decimal | null;
  recommended: Decimal | null;
};

/** Lo mismo que recipe_costs: coste por ración, precio sin IVA, food cost, margen y precio recomendado. */
export function economics(input: { total: Decimal; yieldQty: Decimal; yieldUnit: YieldUnit; salePrice: Decimal | null; vatRate: Decimal; targetPct: Decimal }): Economics {
  const { total, yieldQty, yieldUnit, salePrice, vatRate, targetPct } = input;
  const perYieldUnit = total.div(yieldQty);
  const portion = yieldUnit === "racion" ? perYieldUnit : null;
  const net = salePrice ? salePrice.div(new Decimal(1).plus(vatRate.div(100))) : null;
  return {
    total,
    perYieldUnit,
    portion,
    net,
    foodCostPct: portion && net && net.gt(0) ? portion.div(net).mul(100) : null,
    margin: portion && net ? net.minus(portion) : null,
    recommended: portion && targetPct.gt(0) ? portion.div(targetPct.div(100)).mul(new Decimal(1).plus(vatRate.div(100))) : null,
  };
}

/** Semáforo del food cost frente al objetivo: verde hasta el objetivo, ámbar hasta +5 puntos, rojo después. */
export function foodCostTone(pct: number | null, target: number): "good" | "warn" | "bad" | "none" {
  if (pct === null) return "none";
  if (pct <= target) return "good";
  if (pct <= target + 5) return "warn";
  return "bad";
}
