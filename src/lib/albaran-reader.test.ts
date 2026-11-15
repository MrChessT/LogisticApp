import { describe, expect, it } from "vitest";
import { parseAmount, readAlbaran, type OcrText } from "./albaran-reader";

// Albaranes inventados (no son de ningún proveedor real). Cada trozo de texto lleva su caja como la
// devuelve el OCR: 4 esquinas; `slope` inclina el papel (foto torcida).
function box(text: string, x: number, y: number, w: number, slope = 0, h = 24): OcrText {
  return { text, box: [[x, y], [x + w, y + slope * w], [x + w, y + slope * w + h], [x, y + h]] };
}
const today = new Date();
const dd = `${String(today.getDate()).padStart(2, "0")}/${String(today.getMonth() + 1).padStart(2, "0")}/${today.getFullYear()}`;

describe("parseAmount", () => {
  it.each([
    ["12,950", 12.95],
    ["2,100", 2.1],
    ["7.77", 7.77],
    ["1.234,56", 1234.56],
    ["10", 10],
    ["1O,50", 10.5],
    ["abc", null],
    ["20261029", 20261029],
  ])("%s → %s", (raw, value) => expect(parseAmount(raw)).toBe(value));
});

describe("leer un albarán", () => {
  it("líneas, lotes, unidades, totales y fecha de un albarán derecho", () => {
    const r = readAlbaran([
      box("DISTRIBUCIONES EJEMPLO S.L.", 40, 20, 300),
      box(`Fecha: ${dd}`, 600, 20, 160),
      box("REF DESCRIPCION CANT PRECIO LOTE IMPORTE", 40, 120, 700),
      box("A-0101 PECHUGA DE POLLO", 40, 160, 260), box("3,250 kg", 330, 160, 90), box("5,40", 450, 160, 60), box("L2611", 540, 160, 70), box("17,55", 680, 160, 70),
      box("A-0102 HUEVOS CAMPEROS", 40, 200, 260), box("2 cj", 330, 200, 90), box("21,00", 450, 200, 60), box("42,00", 680, 200, 70),
      box("A-0103 NATA 35%", 40, 240, 260), box("6 ud", 330, 240, 90), box("3,15", 450, 240, 60), box("18,90", 680, 240, 70),
      box("Base imponible: 78,45 €", 450, 400, 300), box("IVA 10%: 7,85 €", 450, 440, 300), box("TOTAL: 86,30 €", 450, 480, 300),
    ]);
    expect(r.status).toBe("cuadra");
    expect(r.lines.map((l) => [l.ref, l.description, l.qty, l.unit, l.price, l.amount])).toEqual([
      ["A-0101", "PECHUGA DE POLLO", 3.25, "kg", 5.4, 17.55],
      ["A-0102", "HUEVOS CAMPEROS", 2, "cj", 21, 42],
      ["A-0103", "NATA 35%", 6, "ud", 3.15, 18.9],
    ]);
    expect(r.lines[0]!.lot).toBe("L2611");
    expect([r.linesTotal, r.base, r.vatRate, r.vat, r.total]).toEqual([78.45, 78.45, 10, 7.85, 86.3]);
    expect(r.date).toBe(today.toISOString().slice(0, 10));
  });

  it("foto torcida: el OCR junta la descripción de una línea con los números de la anterior", () => {
    // Como en una foto real de un papel inclinado: cada caja mezcla dos renglones.
    const s = 0.04;
    const r = readAlbaran([
      box("REF DESCRIPCION CANT PRECIO IMPORTE", 40, 100, 700, s),
      box("0000000501 SOLOMILLO DE TERNERA", 40, 140, 300, s),
      box("0000000502 PANCETA CURADA 1,200 24,500 29,40", 40, 172, 700, s),
      box("0000000503 QUESO CURADO 0,800 9,750 7,80", 40, 204, 700, s),
      box("1,000 15,000 15,00", 400, 248, 340, s),
      box("52,20 10,00 5,22", 400, 400, 300, s),
      box("Importe 57,42", 500, 460, 200, s),
    ]);
    expect(r.status).toBe("cuadra");
    expect(r.lines.map((l) => [l.ref, l.description, l.qty, l.price, l.amount])).toEqual([
      ["0000000501", "SOLOMILLO DE TERNERA", 1.2, 24.5, 29.4],
      ["0000000502", "PANCETA CURADA", 0.8, 9.75, 7.8],
      ["0000000503", "QUESO CURADO", 1, 15, 15],
    ]);
    expect([r.base, r.vatRate, r.total]).toEqual([52.2, 10, 57.42]);
  });

  it("descuento por línea (cantidad × precio × (1 − dto) = importe) e IVA del 21 %", () => {
    const r = readAlbaran([
      box("LIMPIADOR MULTIUSOS 5L", 40, 160, 260), box("4", 330, 160, 40), box("12,00", 420, 160, 60), box("15", 520, 160, 40), box("40,80", 680, 160, 70),
      box("BOLSAS BASURA 100L", 40, 200, 260), box("10", 330, 200, 40), box("2,35", 420, 200, 60), box("23,50", 680, 200, 70),
      box("Base 64,30", 450, 400, 200), box("IVA 21% 13,50", 450, 440, 200), box("Total 77,80", 450, 480, 200),
    ]);
    expect(r.lines.map((l) => [l.description, l.qty, l.price, l.discountPct, l.amount])).toEqual([
      ["LIMPIADOR MULTIUSOS 5L", 4, 12, 15, 40.8],
      ["BOLSAS BASURA 100L", 10, 2.35, null, 23.5],
    ]);
    expect([r.status, r.vatRate, r.vat, r.total]).toEqual(["cuadra", 21, 13.5, 77.8]);
  });

  it("la columna del IVA entre precio e importe no se toma por descuento", () => {
    const r = readAlbaran([box("ACEITE OLIVA 5L 2 31,50 10 63,00", 40, 160, 700)]);
    expect(r.lines).toMatchObject([{ description: "ACEITE OLIVA 5L", qty: 2, price: 31.5, discountPct: null, amount: 63 }]);
  });

  it("si los números no casan (mal leídos o alterados), la línea no entra y el albarán no cuadra", () => {
    const r = readAlbaran([
      box("SALMON FRESCO 2,100 6,650 14,50", 40, 160, 700), // 2,1 × 6,65 = 13,97, no 14,50
      box("MANTEQUILLA 1,000 8,900 10 8:90", 40, 200, 700), // «8:90» es 8,90 mal leído
      box("31,27 3,15 34,40", 400, 400, 300),
    ]);
    expect(r.lines).toMatchObject([{ description: "MANTEQUILLA", qty: 1, price: 8.9, amount: 8.9 }]);
    expect(r.status).toBe("no_cuadra");
  });

  it("sin líneas reconocibles", () => {
    expect(readAlbaran([box("Los pedidos antes de las 15:00", 40, 100, 400)]).status).toBe("sin_lineas");
  });

  it("una fecha futura o muy antigua no se toma como la del albarán", () => {
    expect(readAlbaran([box("Fecha 31/10/2099", 40, 20, 200)]).date).toBeNull();
    expect(readAlbaran([box("Fecha 31/10/2001", 40, 20, 200)]).date).toBeNull();
  });
});

describe("casos de albaranes reales (maquetación; datos inventados)", () => {
  it("un número partido por el OCR («0, 600», «14, 60») se une", () => {
    const r = readAlbaran([box("QUESO FRESCO 0, 600 kg 12,950 7, 77", 40, 160, 700)]);
    expect(r.lines).toMatchObject([{ description: "QUESO FRESCO", qty: 0.6, unit: "kg", price: 12.95, amount: 7.77 }]);
  });

  it("si el OCR no lee la columna Dto, el descuento sale de las cuentas; código corto y cifras en la descripción", () => {
    const r = readAlbaran([
      box("77 Junta de goma 5 vias DN50", 40, 160, 300), box("12.00", 400, 160, 60), box("25,00", 500, 160, 60), box("285,00", 680, 160, 70),
      box("285,00", 300, 400, 70), box("59,85", 450, 400, 70), box("344,85", 680, 400, 70),
    ]);
    expect(r.lines).toMatchObject([{ ref: "77", description: "Junta de goma 5 vias DN50", qty: 12, price: 25, discountPct: 5, amount: 285 }]);
    expect([r.status, r.vatRate, r.total]).toEqual(["cuadra", 21, 344.85]);
  });

  it("descuento de cabecera y varios tipos de IVA: base = subtotal − descuento y base + cuota = total", () => {
    const r = readAlbaran([
      box("C09456", 40, 160, 80), box("100", 330, 160, 40), box("6,00 €", 420, 160, 60), box("600,00 €", 500, 160, 80), box("10,00%", 600, 160, 60), box("660,00 €", 680, 160, 80),
      box("D12456", 40, 200, 80), box("120", 330, 200, 40), box("10,00 €", 420, 200, 60), box("1.200,00 €", 500, 200, 80), box("10,00%", 600, 200, 60), box("1.320,00 €", 680, 200, 80),
      box("Subtotal 1.800,00 €", 300, 400, 300),
      box("Descuento 15,0% -270,00 €", 300, 440, 400),
      box("Base Imponible 1.530,00 €", 300, 480, 400),
      box("0,00 € 153,00 € 0,00 € 153,00 €", 300, 520, 400),
      box("TOTAL ALBARÁN 1.683,00 €", 300, 580, 400),
    ]);
    expect(r.lines.map((l) => [l.ref, l.qty, l.price, l.amount])).toEqual([["C09456", 100, 6, 600], ["D12456", 120, 10, 1200]]);
    expect([r.status, r.linesTotal, r.headerDiscountPct, r.base, r.vat, r.total]).toEqual(["cuadra", 1800, 15, 1530, 153, 1683]);
  });
});
