import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { PRODUCTS } from "../dev/fixture";
import { lineBasePrice } from "./document-prices";

const limones = PRODUCTS[7]!; // masa, saco 5 kg
const coca = PRODUCTS[3]!; // unidades, caja 24
const line = (price: string, unit: string | null = null) => ({ code: null, description: "x", qty: "1", unit, price, amount: price });

describe("precio de una línea por unidad base", () => {
  it("con la unidad que dice la línea", () => {
    expect(lineBasePrice(line("1.25", "kg"), limones, new Decimal("0.0011"))?.toString()).toBe("0.00125");
  });

  it("sin unidad: la lectura más cercana a nuestro precio (por kilo, por unidad o por caja)", () => {
    expect(lineBasePrice(line("1.25"), limones, new Decimal("0.0011"))?.toString()).toBe("0.00125");
    expect(lineBasePrice(line("13.90"), coca, new Decimal("0.55"))?.toFixed(4)).toBe("0.5792");
    expect(lineBasePrice(line("0.60"), coca, new Decimal("0.55"))?.toString()).toBe("0.6");
  });

  it("si ninguna lectura se parece a nuestro precio, no compara", () => {
    expect(lineBasePrice(line("90", "kg"), limones, new Decimal("0.0011"))).toBeNull();
  });
});
