import { describe, expect, it } from "vitest";
import { parseDate, parseNumber, productLine, readDocumentText } from "./documento-texto";

// Documentos inventados con la maquetación de los ejemplos del Drive (factura sencilla, albarán con
// descuento y tabla de IVA, factura con cuotas separadas). Las filas llegan como las daría el texto de un PDF.

describe("parseNumber", () => {
  it.each([
    ["1.234,56", "1234.56"],
    ["1,234.56", "1234.56"],
    ["100.00", "100.00"],
    ["7 900,00 €", "7900.00"],
    ["2.800,00 €", "2800.00"],
    ["-420,00 €", "-420.00"],
    ["15,0%", "15.0"],
    ["10,00%", "10.00"],
    ["1.250", "1.250"], // «1.250» sin coma = 1,25 (en un albarán manda el decimal)
    ["abc", null],
    ["Total", null],
  ])("%s → %s", (raw, value) => expect(parseNumber(raw)).toBe(value));
});

describe("parseDate", () => {
  it("fechas dd/mm/aaaa y dd.mm.aa", () => {
    expect(parseDate("04/03/2014")).toBe("2014-03-04");
    expect(parseDate("9.8.23")).toBe("2023-08-09");
    expect(parseDate("31/02/2014")).toBeNull();
  });
});

describe("líneas de producto", () => {
  it("cantidad × precio = importe", () => {
    expect(productLine("1 Talla pequeña traje de luces en rojo 100.00 100.00")).toMatchObject({ qty: "1", price: "100.00", amount: "100.00", description: "Talla pequeña traje de luces en rojo" });
  });
  it("con columna de IVA (cantidad, precio, importe, % IVA, total)", () => {
    expect(productLine("100 6,00 € 600,00 € 10,00% 660,00 €")).toMatchObject({ qty: "100", price: "6.00", amount: "600.00", vatPct: "10.00", discountPct: null });
  });
  it("con descuento de línea (bruto, % y neto)", () => {
    expect(productLine("Vino blanco 2 10,00 € 20,00 € 10% 18,00 €")).toMatchObject({ qty: "2", discountPct: "10", amount: "18.00" });
  });
  it("con descuento que no cuadra no es línea", () => {
    expect(productLine("Vino blanco 2 10,00 € 20,00 € 10% 19,00 €")).toBeNull();
  });
  it("una fila que no cuadra no es línea", () => {
    expect(productLine("Tomate 3 2,00 € 9,00 €")).toBeNull();
  });
});

describe("factura sencilla (modelo con IVA 21 %)", () => {
  const doc = [
    "Factura ES-001",
    "Fecha 29/01/2019",
    "Cant. Descripción Precio unitario Importe",
    "1 Talla pequeña traje de luces en rojo 100.00 100.00",
    "2 Mui grande churrolito 25.00 50.00",
    "3 Equipaje de Fútbol 5.00 15.00",
    "Subtotal 165.00",
    "IVA 21.0% 34.65",
    "TOTAL 199.65 €",
  ].join("\n");

  it("lee cabecera, líneas y totales, y cuadra", () => {
    const r = readDocumentText(doc);
    expect(r.kind).toBe("factura");
    expect(r.number).toBe("ES-001");
    expect(r.date).toBe("2019-01-29");
    expect(r.lines.map((l) => [l.qty, l.price, l.amount])).toEqual([["1", "100.00", "100.00"], ["2", "25.00", "50.00"], ["3", "5.00", "15.00"]]);
    expect(r.subtotal).toBe("165.00");
    expect(r.vatRows).toEqual([{ rate: "21.0", vat: "34.65" }]);
    expect(r.total).toBe("199.65");
    expect(r.status).toBe("cuadra");
    expect(r.issues).toEqual([]);
  });

  it("si el total no encaja con base + IVA, lo dice", () => {
    const r = readDocumentText(doc.replace("TOTAL 199.65 €", "TOTAL 200.00 €"));
    expect(r.status).toBe("revisar");
    expect(r.issues[0]).toMatch(/Base \+ IVA es 199\.65/);
  });

  it("si la cuota de IVA va en la línea siguiente a su etiqueta, también la lee", () => {
    const r = readDocumentText(doc.replace("IVA 21.0% 34.65", "Subtotal IVA 21.0%\n34.65"));
    expect(r.subtotal).toBe("165.00");
    expect(r.vatRows).toEqual([{ rate: "21.0", vat: "34.65" }]);
    expect(r.status).toBe("cuadra");
  });
});

describe("albarán con descuento de cabecera y tabla de IVA", () => {
  const albaran = [
    "ALBARÁN",
    "Fecha: 04/03/2014",
    "Unidades Precio Un. Subtotal % IVA Total con IVA",
    "100 6,00 € 600,00 € 10,00% 660,00 €",
    "120 10,00 € 1.200,00 € 10,00% 1.320,00 €",
    "200 5,00 € 1.000,00 € 10,00% 1.100,00 €",
    "Subtotal Descuento",
    "2.800,00 € 15,0%",
    "Base Imponible -420,00 € 2.380,00 €",
    "I.V.A. 4,00% 0,00 €",
    "10,00% 280,00 €",
    "21,00% 0,00 €",
    "280,00 €",
    "TOTAL ALBARÁN 2.660,00 €",
  ].join("\n");

  it("lee las tres líneas con su IVA, el descuento y la tabla de tipos", () => {
    const r = readDocumentText(albaran);
    expect(r.kind).toBe("albaran");
    expect(r.date).toBe("2014-03-04");
    expect(r.lines.map((l) => [l.qty, l.amount, l.vatPct])).toEqual([["100", "600.00", "10.00"], ["120", "1200.00", "10.00"], ["200", "1000.00", "10.00"]]);
    expect(r.subtotal).toBe("2800.00");
    expect(r.discountPct).toBe("15.0");
    expect(r.base).toBe("2380.00");
    expect(r.vatRows).toEqual([{ rate: "4.00", vat: "0.00" }, { rate: "10.00", vat: "280.00" }, { rate: "21.00", vat: "0.00" }]);
    expect(r.total).toBe("2660.00");
    expect(r.status).toBe("cuadra");
  });
});

describe("factura con el total en otra línea y la tabla de productos rota", () => {
  it("sin líneas reconocibles, lo marca para revisar en lugar de inventar", () => {
    const r = readDocumentText("Factura\n300,00\n1500,00\n250,00\n200 uds\nTotal (EUR): 7 900,00 €");
    expect(r.total).toBe("7900.00");
    expect(r.status).toBe("sin_lineas");
    expect(r.issues).toContain("No se reconoce ninguna línea de producto.");
  });
});

describe("albarán con columnas Ud., Precio, Dto e Importe (IVA y totales en bloque)", () => {
  // Maquetación de un albarán de gestión: el descuento va como número en la columna «Dto», el IVA lleva su
  // porcentaje entre paréntesis y el total está en la línea siguiente a su etiqueta. Datos inventados.
  const doc = [
    "ALBARÁN",
    "Nº Albarán Fecha Albarán",
    "B / 1 12.05.2024",
    "Cod. Concepto Ud. Precio Dto Importe",
    "000113 Válvula de ejemplo DN50 20.00 48.83 976.60",
    "77 Membrana de ejemplo 12.00 25.00 5 285.00",
    "00120 Racor de ejemplo 4.00 1.38 5.52",
    "97 Caldera de ejemplo 3.00 2.101,00 6.303,00",
    "B. Imponible IVA Total Albarán",
    "7.711,87 € (21.00%) 1.619,49 €",
    "9.331,36 €",
  ].join("\n");

  it("lee el descuento de la columna Dto y los totales de bloque", () => {
    const r = readDocumentText(doc);
    expect(r.lines.map((l) => [l.ref, l.qty, l.price, l.discountPct, l.amount])).toEqual([
      ["000113", "20.00", "48.83", null, "976.60"],
      ["77", "12.00", "25.00", "5", "285.00"],
      ["00120", "4.00", "1.38", null, "5.52"],
      ["97", "3.00", "2101.00", null, "6303.00"],
    ]);
    expect(r.base).toBe("7711.87");
    expect(r.vatRows).toEqual([{ rate: "21.00", vat: "1619.49" }]);
    expect(r.total).toBe("9331.36");
    expect(r.status).toBe("cuadra");
  });
});

describe("fecha de vencimiento de una factura", () => {
  it("separa la fecha del documento de la de vencimiento", () => {
    const r = readDocumentText(["Factura F-2019/7", "Fecha 29/01/2019", "Vencimiento: 28/02/2019", "1 Harina 2,00 2,00", "Total 2,00"].join("\n"));
    expect([r.date, r.dueDate]).toEqual(["2019-01-29", "2019-02-28"]);
  });

  it("una línea «Fecha de vencimiento» no se toma como fecha del documento", () => {
    const r = readDocumentText(["Factura F-2019/8", "Fecha de vencimiento 28.02.2019", "1 Harina 2,00 2,00", "Total 2,00"].join("\n"));
    expect([r.date, r.dueDate]).toEqual([null, "2019-02-28"]);
  });
});
