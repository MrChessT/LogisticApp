import { describe, expect, it } from "vitest";
import type { OcrText } from "./albaran-reader";
import { descripcionDeRecorte, fechaDeRecorte, lineasDeRecorte, numeroDeRecorte, proveedorDeRecorte } from "./albaran-recorte";

const caja = (text: string, y: number): OcrText => ({ text, box: [[0, y], [400, y], [400, y + 14], [0, y + 14]] });

describe("recuadro: fecha y número", () => {
  it.each([["Fecha: 28-04-2023", "2023-04-28"], ["04/03/14", "2014-03-04"], ["28 / 04 / 2023", "2023-04-28"], ["sin fecha", null]])("fecha %j → %s", (t, iso) => expect(fechaDeRecorte(t)).toBe(iso));
  it.each([["N° Albarán A/129", "A/129"], ["Albaran: A-26/10291", "A-26/10291"], ["2841", "2841"], ["Fecha 28-04-2023", null], ["Albarán", null]])("número %j → %s", (t, n) => expect(numeroDeRecorte(t)).toBe(n));
});

describe("recuadro: proveedor, línea y descripción", () => {
  it("proveedor con forma social o texto limpio; sin letras no hay nombre", () => {
    expect(proveedorDeRecorte("DISTRIBUCIONES DEL CENTRO, S.A.")).toBe("Distribuciones del Centro");
    expect(proveedorDeRecorte("  FRITOS Y SECOS  ")).toBe("Fritos y Secos");
    expect(proveedorDeRecorte("1234")).toBeNull();
  });
  it("una línea completa se lee y una que no cuadra no", () => {
    expect(lineasDeRecorte([caja("Costilla de cerdo 2,100 kg 6,950 14,60", 0)])).toMatchObject([{ description: "Costilla de cerdo", qty: "2.100", price: "6.950", amount: "14.60" }]);
    expect(lineasDeRecorte([caja("Costilla de cerdo 2,100 kg 6,950 99,99", 0)])).toEqual([]);
  });
  it("un recuadro con varios renglones lee cada uno por separado (palabras pegadas, código corto y descuento incluidos)", () => {
    const lines = lineasDeRecorte([
      caja("77 Membrana flujostatovalvula5vias 12.00 25.00 5 285.00", 0),
      caja("00120 Racor359GCurectopara gasc/precinto 1/2x15 4.00 1.38 5.52", 30),
      caja("97 Caldera Cel", 60),
    ]);
    expect(lines.map((l) => [l.ref, l.qty, l.price, l.discountPct, l.amount])).toEqual([["77", "12.00", "25.00", "5", "285.00"], ["00120", "4.00", "1.38", null, "5.52"]]);
  });
  it("la descripción se queda sin las cifras sueltas", () => {
    expect(descripcionDeRecorte("COSTILLA DE CERDO 2,100 kg 6,950 14,60")).toBe("Costilla de Cerdo");
    expect(descripcionDeRecorte("Válvula DN50")).toBe("Válvula DN50");
  });
});
