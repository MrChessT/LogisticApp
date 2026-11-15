import { describe, expect, it } from "vitest";
import { lineProblem, linesTotal, type LineaFactura } from "./invoice-lines";

const line = (over: Partial<LineaFactura>): LineaFactura => ({ ref: null, description: "Harina", qty: "2", unit: null, price: "3.50", discountPct: null, vatPct: null, amount: "7.00", ...over });

describe("líneas de factura editables", () => {
  it("una línea que cuadra no tiene problema (con coma decimal y con descuento)", () => {
    expect(lineProblem(line({}))).toBeNull();
    expect(lineProblem(line({ price: "3,50", amount: "7,00" }))).toBeNull();
    expect(lineProblem(line({ qty: "3", price: "3", discountPct: "10", amount: "8.10" }))).toBeNull();
  });
  it.each([
    [line({ description: " " }), /descripción/],
    [line({ qty: "dos" }), /números/],
    [line({ amount: "9" }), /cantidad × precio/],
    [line({ discountPct: "120" }), /descuento/],
  ])("dice qué hay que corregir", (l, message) => expect(lineProblem(l)).toMatch(message));
  it("suma los importes", () => {
    expect(linesTotal([line({}), line({ amount: "1,10" }), line({ amount: "x" })]).toFixed(2)).toBe("8.10");
  });
});
