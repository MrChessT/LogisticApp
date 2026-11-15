import { describe, expect, it } from "vitest";
import { albaranNumber, productDraft, supplierNameGuess } from "./albaran-cabecera";

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
  it("por kilos, por litros o por unidades según la unidad", () => {
    expect(productDraft({ description: "COSTILLA DE CERDO", unit: "kg", qty: 2.1 })).toEqual({ name: "Costilla de cerdo", dimension: "mass", packName: "Kg", qtyBase: 1000 });
    expect(productDraft({ description: "Aceite girasol", unit: "l", qty: 5 })).toMatchObject({ dimension: "volume", packName: "Litro" });
    expect(productDraft({ description: "Válvula DN50", unit: null, qty: 20 })).toMatchObject({ name: "Válvula DN50", dimension: "count", qtyBase: 1 });
  });
  it("sin unidad y con decimales es peso; sin descripción no se da de alta", () => {
    expect(productDraft({ description: "QUESO", unit: null, qty: 0.6 })?.dimension).toBe("mass");
    expect(productDraft({ description: " ", unit: null, qty: 1 })).toBeNull();
  });
});
