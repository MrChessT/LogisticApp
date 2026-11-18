import { describe, expect, it } from "vitest";
import { lineasDePdf, type PdfItem } from "./pdf-texto";

const it_ = (str: string, x: number, y: number, width = str.length * 5, height = 10): PdfItem => ({ str, x, y, width, height });

describe("lineasDePdf", () => {
  it("ordena de arriba abajo y de izquierda a derecha, con espacios entre columnas", () => {
    const items = [it_("100,00", 300, 700), it_("Tónica 20 cl", 60, 701), it_("2", 20, 700), it_("Factura F-12", 20, 780), it_("50,00", 220, 699)];
    expect(lineasDePdf(items)).toEqual(["Factura F-12", "2 Tónica 20 cl 50,00 100,00"]);
  });

  it("une los trozos pegados de una misma palabra y descarta los vacíos", () => {
    const items = [it_("Tot", 20, 500, 15), it_("al", 35, 500, 10), it_(" ", 45, 500, 5), it_("1.234,56", 200, 500)];
    expect(lineasDePdf(items)).toEqual(["Total 1.234,56"]);
  });
});
