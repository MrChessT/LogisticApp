import { describe, expect, it } from "vitest";
import { parseTermChanges } from "../agent/supplier-terms";

describe("condiciones de proveedor dichas en una frase", () => {
  it.each([
    ["el pedido mínimo de Makro ahora es 200 €", [{ field: "min_order", value: "200" }]],
    ["pon el mínimo de Makro en 150,50", [{ field: "min_order", value: "150.50" }]],
    ["a Makro se le pide lunes y jueves antes de las 12", [{ field: "order_days", value: "1,4" }, { field: "order_cutoff", value: "12:00" }]],
    ["los días de pedido de Bebidas del Sur son de lunes a viernes", [{ field: "order_days", value: "1,2,3,4,5" }]],
    ["Makro entrega en 48 h", [{ field: "lead_time_hours", value: "48" }]],
    ["Makro tarda 2 días", [{ field: "lead_time_hours", value: "48" }]],
    ["a Makro se le paga a 30 días por transferencia", [{ field: "payment_terms", value: "30 días por transferencia" }]],
    ["forma de pago de Makro: Domiciliación a 60 días", [{ field: "payment_terms", value: "Domiciliación a 60 días" }]],
  ])("«%s»", (message, expected) => {
    expect(parseTermChanges(message)).toEqual(expected);
  });

  it("sin condiciones, nada", () => {
    expect(parseTermChanges("¿qué nos trae Makro?")).toEqual([]);
    expect(parseTermChanges("paga la factura de Makro")).toEqual([]);
  });
});
