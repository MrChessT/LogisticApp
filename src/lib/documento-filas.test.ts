import { describe, expect, it } from "vitest";
import type { OcrText } from "@/lib/albaran-reader";
import { filasDeOcr } from "./documento-filas";
import { readDocumentText } from "./documento-texto";

// Cajas inventadas, como las devuelve el OCR: 4 esquinas, con la altura de una línea de texto.
function caja(text: string, x: number, y: number, h = 20): OcrText {
  const w = text.length * 8;
  return { text, box: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] };
}

describe("filas del OCR", () => {
  it("une en una fila las cajas a la misma altura y las ordena de izquierda a derecha", () => {
    expect(filasDeOcr([caja("165.00", 520, 502), caja("Subtotal", 300, 500)])).toBe("Subtotal 165.00");
  });

  it("separa las filas por su posición vertical", () => {
    const texto = filasDeOcr([caja("Talla", 120, 141), caja("Cant.", 40, 100), caja("1", 40, 140), caja("Descripción", 120, 100)]);
    expect(texto).toBe("Cant. Descripción\n1 Talla");
  });

  it("sin cajas no hay texto", () => {
    expect(filasDeOcr([])).toBe("");
  });
});

describe("factura leída desde las cajas del OCR", () => {
  it("cabecera, línea, IVA y total salen del texto por filas, y cuadra", () => {
    const cajas = [
      caja("Factura F-2024/3", 40, 100),
      caja("Fecha 02/03/2024", 40, 130),
      caja("Vencimiento 01/04/2024", 40, 160),
      caja("Cant.", 40, 200), caja("Descripción", 120, 200), caja("Importe", 500, 200),
      caja("2", 40, 230), caja("Harina de trigo", 120, 230), caja("3,00", 380, 230), caja("6,00", 500, 230),
      caja("Subtotal", 300, 300), caja("6,00", 500, 300),
      caja("IVA 21%", 300, 330), caja("1,26", 500, 330),
      caja("Total", 300, 360), caja("7,26", 500, 360),
    ];
    const r = readDocumentText(filasDeOcr(cajas));
    expect([r.kind, r.number, r.date, r.status]).toEqual(["factura", "F-2024/3", "2024-03-02", "cuadra"]);
    expect(r.lines.map((l) => [l.description, l.qty, l.price, l.amount])).toEqual([["Harina de trigo", "2", "3.00", "6.00"]]);
    expect([r.subtotal, r.total]).toEqual(["6.00", "7.26"]);
  });
});
