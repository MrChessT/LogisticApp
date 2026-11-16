import { describe, expect, it } from "vitest";
import { albaranNumber, productDraft, supplierNameGuess, unitMeasure } from "./albaran-cabecera";

describe("número del albarán", () => {
  it.each([
    ["ALBARAN N° A-26/10291\nFecha:29/10/2026", "A-26/10291"],
    ["Albarán: 2841", "2841"],
    ["N°Albaran Fecha Albaran\nA/129 28-04-2023", "A/129"],
    ["ALBARAN DISTRIBUCIONES EJEMPLO, S.A.\nNumero:\nFecha: 04/03/2014", null],
    ["TOTAL ALBARAN 2.660,00", null],
  ])("%j → %s", (text, number) => expect(albaranNumber(text)).toBe(number));
});

describe("nombre del proveedor", () => {
  it("el renglón de arriba con forma social, sin la palabra «Albarán»", () => {
    expect(supplierNameGuess("ALBARAN DISTRIBUCIONES EJEMPLO, S.A.\nDomicilio")).toBe("Distribuciones Ejemplo");
    expect(supplierNameGuess("CARNES DE EJEMPLO S.L Fecha:29/10/2026")).toBe("Carnes de Ejemplo");
  });
  it("el cliente no es el proveedor; sin forma social no se adivina", () => {
    expect(supplierNameGuess("Cliente: FRITOS DE PRUEBA S.L.\nFecha 01/01/2026")).toBeNull();
    expect(supplierNameGuess("Albarán 12\n2 Harina 3,00 6,00")).toBeNull();
  });
});

describe("alta de un producto desde una línea", () => {
  it.each([
    ["kg", "mass", "Kg", 1000], ["g", "mass", "g", 1], ["gr", "mass", "g", 1],
    ["l", "volume", "Litro", 1000], ["cl", "volume", "cl", 10], ["ml", "volume", "ml", 1],
    ["ud", "count", "Unidad", 1], ["uds", "count", "Unidad", 1],
  ])("la unidad %s conserva su medida y su factor", (unit, dimension, packName, qtyBase) => {
    expect(productDraft({ description: "COSTILLA DE CERDO", unit })).toEqual({ name: "Costilla de cerdo", dimension, packName, qtyBase, assumed: false });
  });
  it("sin unidad (o con una que no es de medida) no se adivina: se propone «Unidad» y queda por confirmar", () => {
    expect(productDraft({ description: "QUESO", unit: null })).toMatchObject({ dimension: "count", packName: "Unidad", qtyBase: 1, assumed: true });
    expect(productDraft({ description: "Válvula DN50", unit: "caja" })).toMatchObject({ name: "Válvula DN50", assumed: true });
  });
  it("sin descripción no se da de alta", () => {
    expect(productDraft({ description: " ", unit: null })).toBeNull();
  });
  it("unitMeasure: lo que no es una medida da null", () => {
    expect([unitMeasure("bot"), unitMeasure(null), unitMeasure("")]).toEqual([null, null, null]);
  });
});
