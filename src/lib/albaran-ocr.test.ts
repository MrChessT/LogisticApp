import { describe, expect, it } from "vitest";
import { bestProduct, guessSupplier, lineCode, nameMatch, packForUnit, searchTerms } from "./albaran-ocr";

const t = (text: string) => ({ text, box: [[0, 0], [1, 0], [1, 1], [0, 1]] });

describe("emparejar un albarán con lo nuestro", () => {
  it("proveedor por su nombre en el albarán", () => {
    const suppliers = [{ id: "1", name: "Carnes Ejemplo" }, { id: "2", name: "Bebidas del Sur S.L." }, { id: "3", name: "Carnes Ejemplo Premium" }];
    expect(guessSupplier([t("CARNES EJEMPLO, S.L."), t("Albarán 123")], suppliers)?.id).toBe("1");
    expect(guessSupplier([t("CARNESEJEMPLOPREMIUM")], suppliers)?.id).toBe("3");
    expect(guessSupplier([t("Frutas Pepe")], suppliers)).toBeNull();
  });

  it("parecido de nombres en las dos direcciones", () => {
    expect(nameMatch("MOZZARELA BARRA", "Mozzarella")).toBe(0.5);
    expect(nameMatch("MOZZARELA", "Mozzarella")).toBe(1);
    expect(nameMatch("COSTILLA DE CERDO", "Costilla de cerdo ibérico")).toBeCloseTo(2 / 3);
    expect(nameMatch("COSTILLA DE CERDO", "Costilla de Atún para paella")).toBeLessThan(0.5);
    expect(nameMatch("", "Algo")).toBe(0);
  });

  it("clave para recordar la línea: referencia o descripción", () => {
    expect(lineCode({ ref: "0000000192", description: "COSTILLA" })).toBe("0000000192");
    expect(lineCode({ ref: null, description: "Pechuga  de Pollo " })).toBe("txt:pechuga de pollo");
    expect(lineCode({ ref: null, description: "" })).toBeNull();
  });

  it("formato según la unidad del albarán", () => {
    const packs = [{ id: "caja", qty: "5000", purchase: true }, { id: "kilo", qty: "1000", purchase: false }];
    expect(packForUnit(packs, "mass", "kg")?.id).toBe("kilo");
    expect(packForUnit(packs, "mass", null)).toBeNull();
    expect(packForUnit([{ id: "ud", qty: "1", purchase: true }], "count", "ud")?.id).toBe("ud");
    // Sin unidad en el papel, «0,600» de algo que se pesa va por kilos; «2» no se sabe.
    expect(packForUnit(packs, "mass", null, 0.6)?.id).toBe("kilo");
    expect(packForUnit(packs, "mass", null, 2)).toBeNull();
  });

  it("producto elegido solo si está claro", () => {
    const cat = [{ name: "Mozzarella" }, { name: "Mozzarella Rallada" }, { name: "Costilla de Atún para paella" }, { name: "Costilla de cerdo" }];
    expect(bestProduct("MOZZARELA BARRA", cat)?.name).toBe("Mozzarella");
    expect(bestProduct("COSTILLA DE CERDO", cat)?.name).toBe("Costilla de cerdo");
    expect(bestProduct("LONGANIZA FINA SECA", cat)).toBeNull();
    expect(bestProduct("COSTILLA", [{ name: "Costilla de cerdo" }, { name: "Costilla de ternera" }])).toBeNull();
  });

  it("palabras de búsqueda: las más largas, recortadas para admitir erratas", () => {
    expect(searchTerms("MOZZARELA BARRA")).toEqual(["mozza", "barra"]);
    expect(searchTerms("LONGANIZA FINA SECA 500")).toEqual(["longa", "fina", "seca"]);
  });
});
