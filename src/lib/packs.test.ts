import { describe, expect, it } from "vitest";
import { countingPacks, toBaseQty, unitChoices } from "./packs";
import { lookupPackRows, purchasePack, type LookupProduct } from "./product-lookup";

const gin: LookupProduct = {
  id: "g",
  name: "Ginebra",
  dimension: "volume",
  base_unit: "ml",
  category: "Ginebra",
  family: "Destilados",
  in_location: true,
  stock: "1400.0000",
  packs: [
    { id: "b", name: "Botella 70 cl", qty: "700.0000", count: true, purchase: false, price: null },
    { id: "c", name: "Caja 6", qty: "4200.0000", count: false, purchase: true, price: "60.0000" },
  ],
};

describe("formatos de un producto del buscador", () => {
  it("escribe primero en botellas, luego cajas y por último en ml", () => {
    expect(unitChoices("volume", lookupPackRows(gin)).map((u) => u.label)).toEqual(["Botella 70 cl", "Caja 6", "ml"]);
  });

  it("los refrescos se escriben en unidades y cajas, sin el formato de una unidad", () => {
    const rows = [
      { name: "Botella", qty_base: "1", is_count_default: true, active: true },
      { id: "k", name: "Caja 24", qty_base: "24", is_count_default: false, is_purchase_default: true, active: true },
    ];
    expect(unitChoices("count", rows).map((u) => u.label)).toEqual(["Unidades", "Caja 24"]);
  });

  it("pasa la cantidad escrita a unidad base sin errores de redondeo", () => {
    const units = unitChoices("volume", lookupPackRows(gin));
    expect(toBaseQty(units, "1.5", "b")).toBe(1050);
    expect(toBaseQty(units, "2", "c")).toBe(8400);
    expect(toBaseQty(units, "0.1", "base")).toBe(0.1);
  });

  it("el formato de compra es el marcado o, si no hay, el más grande", () => {
    expect(purchasePack(gin)?.name).toBe("Caja 6");
    const sinMarcar = { ...gin, packs: gin.packs.map((k) => ({ ...k, purchase: false })) };
    expect(purchasePack(sinMarcar)?.name).toBe("Caja 6");
    expect(purchasePack({ ...gin, packs: [] })).toBeNull();
  });

  it("conteo en botellas y caja de compra para «2 cajas + 3 botellas»", () => {
    const packs = countingPacks("volume", lookupPackRows(gin));
    expect(packs.countPack).toEqual({ name: "Botella 70 cl", qtyBase: "700.0000" });
    expect(packs.purchasePack).toEqual({ name: "Caja 6", qtyBase: "4200.0000" });
  });
});
