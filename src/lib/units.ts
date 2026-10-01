import Decimal from "decimal.js";
import { decimalText, quantity } from "./format";

export type UnitDimension = "mass" | "volume" | "count";

export type Pack = {
  name: string;
  qtyBase: string;
};

export function packsToBase(packs: Decimal.Value, pack: Pack): Decimal {
  return new Decimal(packs).mul(pack.qtyBase);
}

export function baseToPacks(quantity: Decimal.Value, pack: Pack): Decimal {
  return new Decimal(quantity).div(pack.qtyBase);
}

export function openBottleFromWeight(weight: Decimal.Value, fullWeight: Decimal.Value, emptyWeight: Decimal.Value, qtyBase: Decimal.Value): Decimal {
  const result = new Decimal(weight).minus(emptyWeight).div(new Decimal(fullWeight).minus(emptyWeight)).mul(qtyBase);
  return Decimal.max(0, Decimal.min(new Decimal(qtyBase), result));
}

export function formatQuantity(quantity: Decimal.Value, dimension: UnitDimension, pack?: Pack): string {
  const value = new Decimal(quantity);
  if (pack && value.gte(pack.qtyBase)) {
    const fullPacks = value.div(pack.qtyBase).floor();
    const remainder = value.mod(pack.qtyBase);
    if (remainder.isZero()) return `${fullPacks.toString()} ${pack.name}`;
    return `${fullPacks.toString()} ${pack.name} + ${formatBase(remainder, dimension)}`;
  }
  return formatBase(value, dimension);
}

function formatBase(value: Decimal, dimension: UnitDimension): string {
  const unit = dimension === "volume" ? "ml" : dimension === "mass" ? "g" : "ud";
  return `${value.toString()} ${unit}`;
}

/** Formatos que sirven para contar un producto: el de conteo (botella) y el de compra (caja de 24). */
export type CountingPacks = {
  dimension: UnitDimension;
  /** Formato en que se cuenta (Botella 70 cl, Barril 30 L, Kg…). */
  countPack?: Pack | null;
  /** Formato de compra de varias unidades (Caja 24, Caja 6…). */
  purchasePack?: Pack | null;
};

const METRIC_PACK = /^(kg|kilo|g|gramo|l|litro|ml|cl|unidad|ud)s?$/i;

/** «Botella 70 cl» → «botella» / «botellas»; «Barril 30 L» → «barriles»; «Botellín» → «botellines». */
export function packNoun(packName: string, count: Decimal.Value): string {
  const word = (packName.trim().split(/\s+/)[0] ?? "").toLowerCase();
  if (new Decimal(count).eq(1)) return word;
  if (/[áéíóú]n$/.test(word)) return `${word.slice(0, -2)}${word.at(-2)!.normalize("NFD")[0]}nes`;
  if (/[aeiouáéó]$/.test(word) || /k$/.test(word)) return `${word}s`;
  return `${word}es`;
}

function packCount(value: Decimal, pack: Pack): string {
  const n = value.div(pack.qtyBase);
  return `${decimalText(n, 2)} ${packNoun(pack.name, n.toDecimalPlaces(2))}`;
}

/**
 * Stock como se cuenta en barra, sin ml ni gramos cuando hay un formato:
 * refrescos y cervezas → «2 cajas + 5 ud» (o «5 ud»); destilados y vino → «12 botellas»;
 * barriles → «2 barriles»; fruta a granel → «3,5 kg». Sin formato, en unidad base legible.
 */
export function formatStock(qty: Decimal.Value, packs: CountingPacks): string {
  const value = new Decimal(qty);
  const { dimension, countPack, purchasePack } = packs;
  if (dimension === "count") {
    const box = purchasePack && new Decimal(purchasePack.qtyBase).gt(1) ? purchasePack : null;
    if (!box || value.abs().lt(box.qtyBase)) return `${decimalText(value, 2)} ud`;
    const boxes = value.div(box.qtyBase).trunc();
    const rest = value.minus(boxes.mul(box.qtyBase));
    const head = `${decimalText(boxes, 0)} ${packNoun(box.name, boxes)}`;
    return rest.isZero() ? head : `${head} + ${decimalText(rest.abs(), 2)} ud`;
  }
  if (countPack && !METRIC_PACK.test(countPack.name.trim()) && new Decimal(countPack.qtyBase).gt(0)) return packCount(value, countPack);
  return quantity(value, dimension === "mass" ? "g" : "ml");
}

/** Cómo se cuenta un producto en la hoja de inventario: cajas (si las hay) y unidades sueltas. */
export type CountLayout = {
  /** Caja o bandeja de varias unidades («Caja 24», «Caja 6»); null si se cuenta solo suelto. */
  box: { name: string; qty: Decimal; units: Decimal } | null;
  /** Lo suelto: ud, botellas, barriles o kg. `qty` en unidad base; `decimals` admite «0,5» (botella abierta). */
  unit: { name: string; qty: Decimal; plural: string; decimals: boolean };
};

export function countLayout(packs: CountingPacks): CountLayout {
  const { dimension, countPack, purchasePack } = packs;
  const unit =
    dimension === "count"
      ? { name: "Unidad", qty: new Decimal(1), plural: "ud", decimals: false }
      : countPack && new Decimal(countPack.qtyBase).gt(0)
        ? {
            name: countPack.name,
            qty: new Decimal(countPack.qtyBase),
            plural: METRIC_PACK.test(countPack.name.trim()) ? countPack.name.trim().toLowerCase() : packNoun(countPack.name, 2),
            decimals: true,
          }
        : { name: dimension === "mass" ? "g" : "ml", qty: new Decimal(1), plural: dimension === "mass" ? "g" : "ml", decimals: true };
  const boxQty = purchasePack ? new Decimal(purchasePack.qtyBase) : null;
  // Una caja solo tiene sentido si lleva un número entero (> 1) de lo que se cuenta suelto.
  const units = boxQty ? boxQty.div(unit.qty) : null;
  const box = purchasePack && boxQty && units && units.gt(1) && units.isInteger() ? { name: purchasePack.name, qty: boxQty, units } : null;
  return { box, unit };
}

/** Cantidad contada en unidad base: cajas × su contenido + sueltas × la unidad. null si algo no es válido. */
export function countTotal(layout: CountLayout, boxes: Decimal | null, loose: Decimal | null): Decimal | null {
  if (boxes && (boxes.isNegative() || !boxes.isInteger())) return null;
  if (loose && (loose.isNegative() || (!layout.unit.decimals && !loose.isInteger()))) return null;
  if (!boxes && !loose) return null;
  return (boxes && layout.box ? boxes.mul(layout.box.qty) : new Decimal(0)).plus(loose ? loose.mul(layout.unit.qty) : 0);
}
