import { describe, expect, it } from "vitest";
import { calendarPeriod } from "./periods";
import { documentNumber, dueWindow, sameDocument, unknownSupplier } from "./text-filters";

const TODAY = "2026-11-20"; // viernes

describe("periodo natural del mensaje", () => {
  it("este mes, mes pasado, esta semana, semana pasada, hoy, ayer, este año", () => {
    expect(calendarPeriod("cuanto he gastado este mes", TODAY)).toMatchObject({ from: "2026-11-01", to: TODAY });
    expect(calendarPeriod("albaranes del mes pasado", TODAY)).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(calendarPeriod("facturas de esta semana", TODAY)).toMatchObject({ from: "2026-11-16", to: TODAY });
    expect(calendarPeriod("la semana pasada", TODAY)).toMatchObject({ from: "2026-11-09", to: "2026-11-15" });
    expect(calendarPeriod("compras de hoy", TODAY)).toMatchObject({ from: TODAY, to: TODAY });
    expect(calendarPeriod("lo de ayer", TODAY)).toMatchObject({ from: "2026-11-19", to: "2026-11-19" });
    expect(calendarPeriod("gasto de este año", TODAY)).toMatchObject({ from: "2026-01-01", to: TODAY });
  });

  it("un mes por su nombre (el del año pasado si aún no ha llegado) y los últimos N días", () => {
    expect(calendarPeriod("facturas de octubre", TODAY)).toMatchObject({ from: "2026-10-01", to: "2026-10-31", label: "en octubre" });
    expect(calendarPeriod("compras en diciembre", "2026-03-10")).toMatchObject({ from: "2025-12-01", to: "2025-12-31", label: "en diciembre de 2025" });
    expect(calendarPeriod("en noviembre", TODAY)).toMatchObject({ from: "2026-11-01", to: TODAY });
    expect(calendarPeriod("los ultimos 15 dias", TODAY)).toMatchObject({ from: "2026-11-06", to: TODAY });
    expect(calendarPeriod("facturas de makro", TODAY)).toBeNull();
  });
});

describe("ventana de vencimiento", () => {
  it("esta semana hasta el domingo; este mes hasta fin de mes; mañana; próximos N días", () => {
    expect(dueWindow("que facturas vencen esta semana", TODAY)).toMatchObject({ from: TODAY, to: "2026-11-22" });
    expect(dueWindow("que vence este mes", TODAY)).toMatchObject({ from: TODAY, to: "2026-11-30" });
    expect(dueWindow("que tengo que pagar mañana", TODAY)).toMatchObject({ from: "2026-11-21", to: "2026-11-21" });
    expect(dueWindow("vencimientos de los proximos 10 dias", TODAY)).toMatchObject({ from: TODAY, to: "2026-11-30" });
    expect(dueWindow("facturas de esta semana", TODAY)).toBeNull();
  });
});

describe("número de documento", () => {
  it("lo encuentra tras albarán o factura y no confunde fechas ni años", () => {
    expect(documentNumber("busca el albaran A-4356")).toBe("a-4356");
    expect(documentNumber("factura nº 2024/118")).toBe("2024/118");
    expect(documentNumber("la factura F77 de makro")).toBe("f77");
    expect(documentNumber("albaranes de este mes")).toBeNull();
    expect(documentNumber("facturas 2026")).toBeNull();
    expect(documentNumber("albaran 12/10")).toBeNull();
    expect(sameDocument("a-4356", "A4356")).toBe(true);
    expect(sameDocument("4356", "ALB-4356")).toBe(true);
    expect(sameDocument("435", "4356")).toBe(false);
  });
});

describe("proveedor que no existe", () => {
  const known = ["Carnes El Carpio", "Bebidas Mar Menor S.L."];
  const locations = ["Parador", "Vivero", "La Oliva", "Pickles"];
  it("se detecta tras palabras de compras; uno conocido, un local o un periodo no", () => {
    expect(unknownSupplier("cuanto le debo a makro", known, locations)).toBe("makro");
    expect(unknownSupplier("que albaranes de makro no tienen factura", known, locations)).toBe("makro");
    expect(unknownSupplier("albaranes de carnes el carpio de este mes", known, locations)).toBeNull();
    expect(unknownSupplier("facturas de la oliva", known, locations)).toBeNull();
    expect(unknownSupplier("facturas de octubre", known, locations)).toBeNull();
    expect(unknownSupplier("cuanto stock hay de larios", known, locations)).toBeNull();
    expect(unknownSupplier("quiero pedir 3 cajas de cocacola y 2 de fanta a makro para el parador", [...known, "Coca-Cola", "Fanta Naranja"], locations)).toBe("makro");
  });
});
