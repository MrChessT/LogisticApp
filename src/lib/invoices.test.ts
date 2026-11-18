import { describe, expect, it } from "vitest";
import { addDays, daysUntil, invoiceMatch, paymentDays, proposeReceipts } from "./invoices";

const money = (v: number) => `${v.toFixed(2).replace(".", ",")} €`;

describe("facturas", () => {
  it("días de pago a partir de las condiciones del proveedor", () => {
    expect(paymentDays("Transferencia a 30 días")).toBe(30);
    expect(paymentDays("Domiciliación a 15 dias")).toBe(15);
    expect(paymentDays("60 d")).toBe(60);
    expect(paymentDays("Contado")).toBe(0);
    expect(paymentDays("Transferencia semanal")).toBe(7);
    expect(paymentDays("Cuando se pueda")).toBeNull();
    expect(paymentDays(null)).toBeNull();
  });

  it("vencimiento y días que faltan", () => {
    expect(addDays("2026-01-31", 30)).toBe("2026-03-02");
    expect(daysUntil("2026-11-10", new Date(2026, 10, 8))).toBe(2);
    expect(daysUntil("2026-11-01", new Date(2026, 10, 8))).toBe(-7);
  });

  it("cuadre con los albaranes", () => {
    expect(invoiceMatch(150.3, 150, 2, money)).toEqual({ tone: "ok", label: "Cuadra" });
    expect(invoiceMatch(152, 150, 2, money)).toEqual({ tone: "over", label: "2,00 € de más" });
    expect(invoiceMatch(140, 150, 2, money)).toEqual({ tone: "under", label: "10,00 € de menos" });
    expect(invoiceMatch(100, 0, 0, money).tone).toBe("none");
  });
});

describe("albaranes que corresponden a una factura leída", () => {
  const r = (id: string, docNumber: string | null, date: string, total: number) => ({ id, docNumber, date, total });
  const receipts = [r("a", "AL-7781", "2026-11-03", 120), r("b", "AL-7790", "2026-11-10", 80.5), r("c", null, "2026-11-12", 40), r("d", "12", "2026-11-13", 200)];

  it("por el número de albarán que nombra la factura", () => {
    expect(proposeReceipts(999, receipts, ["Factura F-1", "Albaranes: AL-7781, AL 7790"])).toEqual({ ids: ["a", "b"], how: "numero" });
  });

  it("un número corto no se toma por un importe o una cantidad", () => {
    expect(proposeReceipts(null, receipts, ["12 Limones 1,25 15,00"])).toBeNull();
  });

  it("si no los nombra, la combinación que suma la base (la de menos albaranes)", () => {
    expect(proposeReceipts(120.5, receipts, [])).toEqual({ ids: ["b", "c"], how: "suma" });
    expect(proposeReceipts(200, receipts, [])).toEqual({ ids: ["d"], how: "suma" });
  });

  it("dos combinaciones igual de buenas: no elige", () => {
    expect(proposeReceipts(40, [...receipts, r("e", null, "2026-11-14", 40)], [])).toBeNull();
  });
});
