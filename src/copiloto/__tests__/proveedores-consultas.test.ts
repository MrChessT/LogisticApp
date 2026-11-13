// Reporte de /zonas (14/11/2026): «cuál es el que menos información tiene» y «cuál es el último en ser creado»
// devolvían la lista general de proveedores. Ahora responden con el dato pedido.
import { describe, expect, it } from "vitest";
import { infoFollowUp, runInfo } from "../tools/info";
import { fixtureContext } from "../dev/fixture";
import type { SupplierRaw } from "../tools/info";

const base = (over: Partial<SupplierRaw>): SupplierRaw => ({
  name: "X", contact: null, phone: null, email: null, orderDays: [], cutoff: null, leadHours: null, minOrder: null, paymentTerms: null, locationIds: [], createdAt: "2026-01-01T00:00:00Z", ...over,
});

const SUPPLIERS: SupplierRaw[] = [
  base({ name: "Bebidas Mar Menor", contact: "Ana", phone: "600", orderDays: [1, 3, 5], leadHours: 24, minOrder: "100", paymentTerms: "Domiciliación", createdAt: "2026-02-01T00:00:00Z" }),
  base({ name: "Frigoríficos Morales", contact: "Luis", phone: "968", orderDays: [1, 3, 5], leadHours: 24, minOrder: "100", paymentTerms: "Pagaré", createdAt: "2026-10-01T00:00:00Z" }),
  base({ name: "Makro", createdAt: "2026-03-01T00:00:00Z" }),
  base({ name: "Distribuciones Canarias", contact: "Marta", createdAt: "2026-11-05T00:00:00Z", orderDays: [2] }),
];

const source = { suppliers: async () => SUPPLIERS } as unknown as Parameters<typeof runInfo>[0];
const params = (message: string) => ({ tool: "query_suppliers" as const, message, locationIds: [], locationsChosen: false, productNames: [], now: new Date() });

describe("consultas de proveedores", () => {
  it("«cuál tiene menos información»: el que más datos le faltan, con cuáles", async () => {
    const result = await runInfo(source, fixtureContext(), params("cual es el que menos informacion tiene"));
    expect(result.text).toBe("Makro: le falta contacto, días de pedido, plazo de entrega, pedido mínimo, forma de pago.");
  });

  it("empate: se dicen todos los que empatan", async () => {
    const result = await runInfo(source, fixtureContext(), params("qué proveedor tiene información incompleta"));
    expect(result.text).toBe("Makro: le falta contacto, días de pedido, plazo de entrega, pedido mínimo, forma de pago.");
  });

  it("«el último en ser creado»: el de fecha de alta más reciente", async () => {
    const result = await runInfo(source, fixtureContext(), params("cual es el ultimo en ser creado"));
    expect(result.text).toBe("El último dado de alta es Distribuciones Canarias, el 05/11/2026.");
  });

  it("sin la pregunta, la lista general de siempre", async () => {
    const result = await runInfo(source, fixtureContext(), params("que proveedores hay"));
    expect(result.text).toContain("proveedores activos");
  });

  it("tras una lista de proveedores, «¿cuál es el que menos información tiene?» sigue hablando de ellos", () => {
    expect(infoFollowUp("cual es el que menos informacion tiene", "query_suppliers")).toBe("query_suppliers");
    expect(infoFollowUp("cual es el ultimo en ser creado", "query_suppliers")).toBe("query_suppliers");
  });

  it("sin esa lista antes, la misma pregunta no es de proveedores", () => {
    expect(infoFollowUp("cual es el que menos informacion tiene", "query_stock")).toBeNull();
    expect(infoFollowUp("cual es el que menos informacion tiene", undefined)).toBeNull();
  });
});
