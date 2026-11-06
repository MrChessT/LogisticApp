// Conteo fino (bloque 1.4): botella abierta por fracción o por peso y formatos de servicio fuera del conteo.
import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { countLayout, openQty } from "./units";
import { countingPacks, unitChoices } from "./packs";

const gin = countingPacks("volume", [
  { name: "Botella 70 cl", qty_base: 700, is_count_default: true, full_weight_g: 1130, empty_weight_g: 480, active: true },
  { name: "Caja 6 botellas", qty_base: 4200, is_count_default: false, is_purchase_default: true, active: true },
  { name: "Copa combinado 50 ml", qty_base: 50, is_count_default: false, is_serving: true, active: true },
]);

describe("conteo fino", () => {
  it("la botella se puede apuntar abierta y, con sus pesos, pesándola", () => {
    const layout = countLayout(gin);
    expect(layout.open?.weights?.full.toString()).toBe("1130");
    expect(openQty(layout, { fraction: "0.5" })?.toString()).toBe("350");
    expect(openQty(layout, { fraction: "0.75" })?.toString()).toBe("525");
    // 805 g: (805 − 480) / (1130 − 480) = la mitad → 350 ml.
    expect(openQty(layout, { weightG: "805" })?.toString()).toBe("350");
    expect(openQty(layout, { weightG: "805,0" })?.toString()).toBe("350");
    // Más que llena o menos que vacía se queda en los límites.
    expect(openQty(layout, { weightG: "2000" })?.toString()).toBe("700");
    expect(openQty(layout, { weightG: "300" })?.toString()).toBe("0");
    expect(openQty(layout, { weightG: "abc" })).toBeNull();
    expect(openQty(layout, { fraction: "1" })).toBeNull();
  });

  it("sin pesos solo hay fracciones; por unidades o en kg sueltos no hay botella abierta", () => {
    const noWeights = countLayout(countingPacks("volume", [{ name: "Botella 75 cl", qty_base: 750, is_count_default: true, active: true }]));
    expect(noWeights.open).toEqual({ weights: null });
    expect(openQty(noWeights, { weightG: "800" })).toBeNull();
    expect(countLayout(countingPacks("count", [{ name: "Caja 24", qty_base: 24, is_count_default: false, is_purchase_default: true, active: true }])).open).toBeNull();
    expect(countLayout(countingPacks("mass", [{ name: "Kg", qty_base: 1000, is_count_default: true, active: true }])).open).toBeNull();
  });

  it("los formatos de servicio no son ni el de conteo ni la caja, pero sí sirven para escribir cantidades", () => {
    expect(gin.countPack?.name).toBe("Botella 70 cl");
    expect(gin.purchasePack?.name).toBe("Caja 6 botellas");
    const onlyServing = countingPacks("volume", [{ name: "Copa de vino 150 ml", qty_base: 150, is_count_default: false, is_serving: true, active: true }]);
    expect(onlyServing.countPack).toBeNull();
    expect(onlyServing.purchasePack).toBeNull();
    const units = unitChoices("volume", [
      { name: "Botella 70 cl", qty_base: 700, is_count_default: true, active: true },
      { name: "Copa combinado 50 ml", qty_base: 50, is_count_default: false, is_serving: true, active: true },
    ]);
    expect(units.map((u) => u.label)).toEqual(["Botella 70 cl", "Copa combinado 50 ml", "ml"]);
    expect(new Decimal(units[1]!.factor).toString()).toBe("50");
  });
});
