import { describe, expect, it } from "vitest";
import { lineAmount, lineOvercharge, receiptSummary } from "./receipt-detail";

describe("ficha de albarán", () => {
  const lines = [
    { qty: "2", price: "52.40", expected: "50.00", incident: null },
    { qty: "1", price: "80.00", expected: "80.00", incident: "faltante" },
    { qty: "6", price: "11.00", expected: null, incident: null },
  ];

  it("importe por línea con decimales exactos", () => {
    expect(lineAmount(lines[0]!).toString()).toBe("104.8");
  });

  it("sobrecoste solo cuando el precio supera al pactado", () => {
    expect(lineOvercharge(lines[0]!).toString()).toBe("4.8");
    expect(lineOvercharge(lines[1]!).toString()).toBe("0");
    expect(lineOvercharge(lines[2]!).toString()).toBe("0");
  });

  it("resumen: importe total, sobrecoste e incidencias", () => {
    const summary = receiptSummary(lines);
    expect(summary.amount.toString()).toBe("250.8");
    expect(summary.overcharge.toString()).toBe("4.8");
    expect(summary.incidents).toBe(1);
  });

  it("un albarán sin líneas suma cero", () => {
    expect(receiptSummary([]).amount.toString()).toBe("0");
  });
});
