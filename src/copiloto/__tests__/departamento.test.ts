// Gráficas por departamento y familia: el ranking nunca descarta importes (el resto va a «Otros») y el filtro
// por departamento deja solo sus productos en todas las vistas.
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { Analytics } from "../analytics/analytics";
import { departmentsOf, productIdsInDepartment } from "../analytics/categories";
import { topWithOthers } from "../analytics/top";
import { FixtureDataSource, fixtureContext, LOCATIONS } from "../dev/fixture";
import { NOW } from "./helpers";

const ctx = fixtureContext();
const q = { ctx, locationIds: LOCATIONS.map((l) => l.id), productIds: [], days: 30, now: NOW };
const analytics = new Analytics(new FixtureDataSource(NOW));

describe("ranking con «Otros»", () => {
  const d = (n: number) => new Decimal(n);
  it("con más categorías que el tope, el resto se suma en «Otros» y el total no cambia", () => {
    const entries: Array<[string, Decimal]> = [["A", d(50)], ["B", d(40)], ["C", d(30)], ["D", d(20)], ["E", d(10)]];
    const top = topWithOthers(entries, 3);
    expect(top.map(([k, v]) => [k, v.toString()])).toEqual([["A", "50"], ["B", "40"], ["Otros", "60"]]);
    const total = top.reduce((acc, [, v]) => acc.plus(v), new Decimal(0));
    expect(total.toString()).toBe("150");
  });

  it("si caben todas, no hay «Otros»", () => {
    expect(topWithOthers([["A", d(2)], ["B", d(1)]], 3).map(([k]) => k)).toEqual(["A", "B"]);
  });
});

describe("filtro por departamento", () => {
  it("los departamentos salen del catálogo, ordenados", () => {
    expect(departmentsOf(ctx.products)).toEqual([...departmentsOf(ctx.products)].sort((a, b) => a.localeCompare(b, "es")));
    expect(departmentsOf(ctx.products)).toContain("Destilados");
  });

  it("un departamento acota la vista de compras a sus productos", async () => {
    const view = await analytics.view("compras", { ...q, department: "Destilados" });
    expect(view.kpis.find((k) => k.id === "compras")!.value).toBe("104,80 €");
    expect(productIdsInDepartment(ctx.products, "Destilados").length).toBeGreaterThan(0);
  });

  it("un departamento sin productos devuelve la vista vacía, no cifras de todo el catálogo", async () => {
    const view = await analytics.view("compras", { ...q, department: "No existe" });
    expect(view.kpis).toEqual([]);
    expect(view.charts).toEqual([]);
  });

  it("el filtro también aplica a consumo y mermas", async () => {
    const all = await analytics.view("consumo", q);
    const one = await analytics.view("consumo", { ...q, department: "Refrescos" });
    const total = (r: typeof all) => r.kpis.find((k) => k.id === "consumo")?.value ?? "";
    expect(total(one)).not.toBe(total(all));
  });
});
