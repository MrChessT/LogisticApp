import { describe, expect, it } from "vitest";
import { classifyCsv, classifySheets } from "./import-classify";

const SALES = [
  ["Ventas del día"],
  ["Fecha", "10/11/2026"],
  ["Código", "Descripción", "Cantidad", "Unidad", "Importe"],
  ["101", "Croquetas de jamón", "3", "ud", "27,00"],
  ["102", "Ensalada", "2", "ud", "16,00"],
];

const ESCANDALLO = [
  ["", "Descripción", "Alérgenos", "", "", "", "", "Rendimiento", "Unidad"],
  ["", "Croquetas de jamón", "gluten, lácteos", "", "", "", "", "10", "ración"],
  ["", "Harina", "", "1", "kg", "2,10"],
];

describe("clasificar hojas por lo que contienen", () => {
  it("las hojas del catálogo se reconocen por su nombre", () => {
    const [c] = classifySheets({ Proveedores: [["Nombre"], ["Makro"]] });
    expect(c!.kind).toBe("catalogo");
  });

  it("ventas del TPV por sus columnas", () => {
    expect(classifySheets({ Hoja1: SALES })[0]!.kind).toBe("ventas");
  });

  it("escandallos por la ficha de descripción y alérgenos", () => {
    const [c] = classifySheets({ Recetas: ESCANDALLO });
    expect(c!.kind).toBe("escandallos");
  });

  it("lo que no encaja es desconocido, sin adivinar", () => {
    const [c] = classifySheets({ Varios: [["Foo", "Bar"], ["1", "2"]] });
    expect(c!.kind).toBe("desconocido");
    expect(c!.reason).toMatch(/hay que decir qué es/);
  });
});

describe("clasificar un CSV", () => {
  it("un CSV de ventas se reconoce igual que una hoja", () => {
    const csv = "Código;Descripción;Cantidad;Unidad;Importe\n101;Croquetas;3;ud;27,00\n";
    expect(classifyCsv("ventas-noviembre.csv", csv)).toMatchObject({ sheet: "ventas-noviembre", kind: "ventas" });
  });
});
