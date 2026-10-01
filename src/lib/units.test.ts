import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { baseToPacks, countLayout, countTotal, formatQuantity, formatStock, openBottleFromWeight, packNoun, packsToBase } from "./units";

describe("units", () => {
  const bottle = { name: "botellas", qtyBase: "700" };

  it("converts packs to base units without floating point loss", () => {
    expect(packsToBase("6", bottle).toString()).toBe("4200");
    expect(baseToPacks("4200", bottle).toString()).toBe("6");
  });

  it("formats full packs and remainder", () => {
    expect(formatQuantity("8750", "volume", bottle)).toBe("12 botellas + 350 ml");
  });

  it("clamps open bottle weight to the valid range", () => {
    expect(openBottleFromWeight("840", "1180", "500", "700").toString()).toBe("350");
    expect(openBottleFromWeight("400", "1180", "500", "700").toString()).toBe("0");
    expect(openBottleFromWeight("840", "1180", "500", "700").lessThanOrEqualTo(new Decimal("700"))).toBe(true);
  });
});

describe("stock como se cuenta en barra", () => {
  const box = { name: "Caja 24", qtyBase: "24" };
  const bottle = { name: "Botella 70 cl", qtyBase: "700" };

  it("refrescos y cervezas: cajas y unidades sueltas", () => {
    expect(formatStock("53", { dimension: "count", purchasePack: box })).toBe("2 cajas + 5 ud");
    expect(formatStock("48", { dimension: "count", purchasePack: box })).toBe("2 cajas");
    expect(formatStock("24", { dimension: "count", purchasePack: box })).toBe("1 caja");
    expect(formatStock("7", { dimension: "count", purchasePack: box })).toBe("7 ud");
    expect(formatStock("7", { dimension: "count" })).toBe("7 ud");
    expect(formatStock("30", { dimension: "count", purchasePack: { name: "Bandeja 24", qtyBase: "24" } })).toBe("1 bandeja + 6 ud");
  });

  it("destilados, barriles y fruta: en su formato, sin ml", () => {
    expect(formatStock("8400", { dimension: "volume", countPack: bottle })).toBe("12 botellas");
    expect(formatStock("700", { dimension: "volume", countPack: bottle })).toBe("1 botella");
    expect(formatStock("8750", { dimension: "volume", countPack: bottle })).toBe("12,5 botellas");
    expect(formatStock("60000", { dimension: "volume", countPack: { name: "Barril 30 L", qtyBase: "30000" } })).toBe("2 barriles");
    expect(formatStock("3500", { dimension: "mass", countPack: { name: "Kg", qtyBase: "1000" } })).toBe("3,5 kg");
    expect(formatStock("1500", { dimension: "volume" })).toBe("1,5 l");
  });

  it("nombres de formato en plural", () => {
    expect(packNoun("Botellín 250 ml", 2)).toBe("botellines");
    expect(packNoun("Pack 12", 3)).toBe("packs");
    expect(packNoun("Saco 10 kg", 2)).toBe("sacos");
  });
});

describe("hoja de inventario: cajas y sueltas", () => {
  const coca = { dimension: "count" as const, countPack: null, purchasePack: { name: "Caja 24", qtyBase: "24" } };
  const ginebra = { dimension: "volume" as const, countPack: { name: "Botella 70 cl", qtyBase: "700" }, purchasePack: { name: "Caja 6", qtyBase: "4200" } };
  const magnum = { dimension: "volume" as const, countPack: { name: "Botella 175 cl", qtyBase: "1750" }, purchasePack: { name: "Botella 175 cl", qtyBase: "1750" } };
  const limones = { dimension: "mass" as const, countPack: { name: "Kg", qtyBase: "1000" }, purchasePack: { name: "Kg", qtyBase: "1000" } };
  const d = (v: string) => new Decimal(v);

  it("refrescos: cajas de 24 y unidades sueltas", () => {
    const layout = countLayout(coca);
    expect(layout.box?.units.toString()).toBe("24");
    expect(layout.unit).toMatchObject({ plural: "ud", decimals: false });
    expect(countTotal(layout, d("3"), d("5"))?.toString()).toBe("77");
    expect(countTotal(layout, null, d("5"))?.toString()).toBe("5");
    expect(countTotal(layout, d("1.5"), null)).toBeNull();
    expect(countTotal(layout, null, d("2.5"))).toBeNull();
  });

  it("destilados: cajas de 6 botellas y botellas sueltas, con media abierta", () => {
    const layout = countLayout(ginebra);
    expect(layout.box?.units.toString()).toBe("6");
    expect(layout.unit).toMatchObject({ plural: "botellas", decimals: true });
    expect(countTotal(layout, d("1"), d("2.5"))?.toString()).toBe("5950");
  });

  it("sin caja de varias unidades: solo la cantidad suelta (botellas, kg)", () => {
    expect(countLayout(magnum).box).toBeNull();
    const kg = countLayout(limones);
    expect(kg.box).toBeNull();
    expect(kg.unit.plural).toBe("kg");
    expect(countTotal(kg, null, d("1.6"))?.toString()).toBe("1600");
  });

  it("nada tecleado o negativo no cuenta", () => {
    expect(countTotal(countLayout(coca), null, null)).toBeNull();
    expect(countTotal(countLayout(coca), d("-1"), null)).toBeNull();
  });
});
