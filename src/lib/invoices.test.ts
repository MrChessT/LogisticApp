import { describe, expect, it } from "vitest";
import { addDays, daysUntil, invoiceMatch, paymentDays } from "./invoices";

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
