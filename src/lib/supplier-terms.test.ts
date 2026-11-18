import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { describeDays, describeTerms, formatDayLong, minOrderShortfall, nextDelivery, orderCycle, shortDays } from "./supplier-terms";

// Octubre de 2026: el sábado 24 Madrid está en UTC+2; desde el domingo 25, en UTC+1.
const at = (iso: string) => new Date(iso);
const money = (v: Decimal) => `${v.toFixed(2).replace(".", ",")} €`;

describe("condiciones de proveedor", () => {
  it("sin condiciones: hoy mismo y sin fecha de entrega", () => {
    expect(nextDelivery({ orderDays: null, orderCutoff: null, leadTimeHours: null }, at("2026-10-25T09:00:00Z"))).toEqual({ orderDate: "2026-10-25", orderToday: true, deliveryDate: null });
  });

  it("lunes y jueves hasta las 14:00, 48 h: un sábado se pide el lunes y llega el miércoles", () => {
    const plan = nextDelivery({ orderDays: [1, 4], orderCutoff: "14:00", leadTimeHours: 48 }, at("2026-10-24T10:00:00Z"));
    expect(plan).toEqual({ orderDate: "2026-10-26", orderToday: false, deliveryDate: "2026-10-28" });
  });

  it("la hora límite es la del local: el lunes a las 13:30 en Madrid aún entra, a las 14:05 pasa al jueves", () => {
    const terms = { orderDays: [1, 4], orderCutoff: "14:00:00", leadTimeHours: 24 };
    expect(nextDelivery(terms, at("2026-10-26T12:30:00Z"))).toEqual({ orderDate: "2026-10-26", orderToday: true, deliveryDate: "2026-10-27" });
    expect(nextDelivery(terms, at("2026-10-26T13:05:00Z"))).toEqual({ orderDate: "2026-10-29", orderToday: false, deliveryDate: "2026-10-30" });
  });

  it("pasada la hora límite sin días fijos: mañana", () => {
    expect(nextDelivery({ orderDays: null, orderCutoff: "18:00", leadTimeHours: 0 }, at("2026-10-25T19:00:00Z")).orderDate).toBe("2026-10-26");
  });

  it("si solo admite hoy y ya pasó la hora, la semana que viene", () => {
    expect(nextDelivery({ orderDays: [1], orderCutoff: "10:00", leadTimeHours: 24 }, at("2026-10-26T12:00:00Z")).orderDate).toBe("2026-11-02");
  });

  it("ciclo: lunes y jueves a 24 h, el lunes por la mañana lo pedido llega el martes y debe durar hasta el viernes", () => {
    const cycle = orderCycle({ orderDays: [1, 4], orderCutoff: "12:00", leadTimeHours: 24 }, at("2026-10-26T08:00:00Z"));
    expect(cycle).toMatchObject({ followingOrderDate: "2026-10-29", coverDays: 4, daysToDelivery: 1 });
    expect(cycle.next.orderToday).toBe(true);
  });

  it("ciclo: pasado el corte del lunes, el próximo es el jueves y lo pedido debe durar hasta el martes siguiente", () => {
    const cycle = orderCycle({ orderDays: [1, 4], orderCutoff: "12:00", leadTimeHours: 24 }, at("2026-10-26T13:00:00Z"));
    expect(cycle).toMatchObject({ followingOrderDate: "2026-11-02", coverDays: 8, daysToDelivery: 4 });
    expect(cycle.next.orderToday).toBe(false);
  });

  it("ciclo: un proveedor diario cubre dos días; sin condiciones, se cuenta un día de plazo", () => {
    expect(orderCycle({ orderDays: null, orderCutoff: null, leadTimeHours: 24 }, at("2026-10-26T08:00:00Z")).coverDays).toBe(2);
    expect(orderCycle({ orderDays: null, orderCutoff: null, leadTimeHours: null }, at("2026-10-26T08:00:00Z"))).toMatchObject({ coverDays: 2, daysToDelivery: 1 });
  });

  it("pedido mínimo: lo que falta, o nada si se llega", () => {
    expect(minOrderShortfall("120.5", "150")?.toString()).toBe("29.5");
    expect(minOrderShortfall("150", "150")).toBeNull();
    expect(minOrderShortfall("10", null)).toBeNull();
  });

  it("textos", () => {
    expect(describeDays([4, 1])).toBe("lunes y jueves");
    expect(describeDays([1, 2, 3, 4, 5])).toBe("de lunes a viernes");
    expect(describeDays([1, 3, 5])).toBe("lunes, miércoles y viernes");
    expect(describeDays(null)).toBe("cualquier día");
    expect(shortDays([1, 4])).toBe("L·J");
    expect(shortDays([1, 2, 3, 4, 5, 6])).toBe("L–S");
    expect(formatDayLong("2026-10-28")).toBe("miércoles 28 oct");
    expect(describeTerms({ orderDays: [1, 4], orderCutoff: "14:00:00", leadTimeHours: 48, minOrder: "150.00" }, money)).toBe(
      "Pedidos lunes y jueves hasta las 14:00 · entrega en 48 h · mínimo 150,00 €",
    );
    expect(describeTerms({ orderDays: null, orderCutoff: null, leadTimeHours: null, minOrder: null }, money)).toBeNull();
  });
});
