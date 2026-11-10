import { describe, expect, it } from "vitest";
import { excelDate, guessLocation, parseSalesBook } from "./sales-import";

// Forma de la exportación «Ventas» del TPV (datos inventados).
const book: string[][] = [
  [],
  ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "Ventas"],
  ["", "Fecha", "46336.73936454861"],
  ["", "Restaurante", "Ejemplo SL"],
  ["", "Centro de coste", "Casa Ejemplo del Puerto"],
  ["", "Fecha venta", "46325.0"],
  ["", "Nombre", "TPV BDP"],
  ["", "Importe", "40.0"],
  [],
  ["", "Cliente", "Fecha", "Comentario", "Núm. Albarán", "Nota de entrega", "Descripción", "Detalle", "Código", "Comentario", "Enviado", "Lote", "Cantidad", "Unidad", "Importe"],
  ["", "TPV BDP", "46325.99", "", "", "", "\"COPA DE LA CASA \"", "", "201", "", "No", "", "1.0", "Pax", "5.0"],
  ["", "TPV BDP", "46325.99", "", "", "", "Arroz de la casa", "", "41", "", "Si", "", "2.0", "Pax", "40.0"],
  ["", "TPV BDP", "46325.99", "", "", "", "Vino blanco", "", "91", "", "Si", "", "1.0", "Copa de Vino (0,2 Botella)", "4.54999"],
  ["", "TPV BDP", "46325.99", "", "", "", "", "", "", "", "", "", "", "", ""],
  ["", "TPV BDP", "46325.99", "", "", "", "Sin cantidad", "", "99", "", "No", "", "", "Pax", "3"],
];

describe("ventas del TPV", () => {
  it("lee la fecha de venta, el centro de coste y todas las líneas (enlazadas o no en el origen)", () => {
    const p = parseSalesBook(book)!;
    expect(p.date).toBe("2026-10-30");
    expect(p.costCentre).toBe("Casa Ejemplo del Puerto");
    expect(p.source).toBe("TPV BDP");
    expect(p.lines).toEqual([
      { code: "201", name: "COPA DE LA CASA", qty: 1, unit: "Pax", amount: 5 },
      { code: "41", name: "Arroz de la casa", qty: 2, unit: "Pax", amount: 40 },
      { code: "91", name: "Vino blanco", qty: 1, unit: "Copa de Vino (0,2 Botella)", amount: 4.55 },
    ]);
    // La venta del día es la suma de todas las líneas, no el «Importe» de la cabecera.
    expect(p.total).toBe(49.55);
    expect(p.issues).toEqual(["Fila 15: falta la cantidad; no se importa."]);
  });

  it("fechas de Excel y escritas a mano", () => {
    expect(excelDate("46325.0")).toBe("2026-10-30");
    expect(excelDate("30/10/2026")).toBe("2026-10-30");
    expect(excelDate("hoy")).toBeNull();
  });

  it("adivina el local por el centro de coste", () => {
    const locs = [{ id: "a", name: "Parador" }, { id: "b", name: "Vivero" }, { id: "c", name: "La Oliva" }];
    expect(guessLocation("Parador del Mar Menor", locs)?.id).toBe("a");
    expect(guessLocation("Restaurante La Oliva", locs)?.id).toBe("c");
    expect(guessLocation("Otro sitio", locs)).toBeNull();
  });

  it("un fichero que no es de ventas no se lee", () => {
    expect(parseSalesBook([["Producto", "Precio"], ["Agua", "1"]])).toBeNull();
  });
});
