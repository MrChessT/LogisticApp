import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { bestUnit, economics, foodCostTone, lineCost, lineQtyBase, productUnits, subRecipeUnits, wastePct } from "./recipes";

const D = (v: number | string) => new Decimal(v);

describe("escandallos", () => {
  it("cantidades en su unidad y merma de limpieza", () => {
    const kg = productUnits("mass").find((u) => u.id === "kg")!;
    expect(lineQtyBase("1,5", kg)!.toNumber()).toBe(1500);
    expect(lineQtyBase("0", kg)).toBeNull();
    expect(lineQtyBase("abc", kg)).toBeNull();
    expect(wastePct("")!.toNumber()).toBe(0);
    expect(wastePct("20")!.toNumber()).toBe(20);
    expect(wastePct("99")).toBeNull();
    // 1 kg a 2 €/kg con 20 % de merma cuesta 2,50 €.
    expect(lineCost(D(1000), D(20), D(0.002))!.toNumber()).toBe(2.5);
    expect(lineCost(D(1000), D(0), null)).toBeNull();
  });

  it("unidades de una subreceta según lo que rinde", () => {
    expect(subRecipeUnits("g").map((u) => u.id)).toEqual(["g", "kg"]);
    expect(subRecipeUnits("racion").map((u) => u.id)).toEqual(["racion"]);
    expect(bestUnit(productUnits("mass"), 1500).id).toBe("kg");
    expect(bestUnit(productUnits("mass"), 250).id).toBe("g");
    expect(bestUnit(productUnits("volume"), 700).id).toBe("cl");
  });

  it("mismo cálculo que la base de datos (tostada de la prueba pgTAP)", () => {
    const e = economics({ total: D(1.625), yieldQty: D(2), yieldUnit: "racion", salePrice: D(6.6), vatRate: D(10), targetPct: D(25) });
    expect(e.portion!.toNumber()).toBe(0.8125);
    expect(e.net!.toNumber()).toBe(6);
    expect(e.foodCostPct!.toDecimalPlaces(1).toNumber()).toBe(13.5);
    expect(e.margin!.toDecimalPlaces(2).toNumber()).toBe(5.19);
    expect(e.recommended!.toDecimalPlaces(2).toNumber()).toBe(3.58);
  });

  it("una elaboración por kilo no tiene ración ni food cost", () => {
    const e = economics({ total: D(3.3), yieldQty: D(800), yieldUnit: "g", salePrice: null, vatRate: D(10), targetPct: D(30) });
    expect(e.perYieldUnit.toNumber()).toBe(0.004125);
    expect(e.portion).toBeNull();
    expect(e.foodCostPct).toBeNull();
  });

  it("semáforo del food cost", () => {
    expect(foodCostTone(28, 30)).toBe("good");
    expect(foodCostTone(33, 30)).toBe("warn");
    expect(foodCostTone(40, 30)).toBe("bad");
    expect(foodCostTone(null, 30)).toBe("none");
  });
});
