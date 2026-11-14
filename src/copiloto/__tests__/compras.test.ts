// Compras por departamento, familia, día y proveedor: cada gráfica reparte exactamente el total del periodo.
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { comprasView } from "../analytics/compras";
import { departmentOf, leafOf } from "../analytics/categories";
import { Analytics } from "../analytics/analytics";
import { FixtureDataSource, fixtureContext, LOCATIONS } from "../dev/fixture";
import type { PurchaseLineRaw } from "../tools/types";
import { NOW } from "./helpers";

const ctx = fixtureContext();
const all = LOCATIONS.map((l) => l.id);
const window = { from: "2026-08-25", to: "2026-09-23", label: "últimos 30 días" };
const product = (name: string) => ctx.products.find((p) => p.name === name)!.id;
const line = (over: Partial<PurchaseLineRaw>): PurchaseLineRaw => ({
  receiptId: "x", locationId: all[0]!, supplierName: "Makro", docDate: "2026-09-20", productId: product("Limones"), amount: "10", ...over,
});

describe("clasificación del catálogo", () => {
  it("el departamento es el primer nivel y la familia la categoría completa", () => {
    expect(departmentOf("Bebidas › Destilados")).toBe("Bebidas");
    expect(leafOf("Bebidas › Destilados")).toBe("Destilados");
  });

  it("un producto sin padre cuenta con su categoría como departamento y familia", () => {
    expect(departmentOf("Destilados")).toBe("Destilados");
    expect(leafOf("Destilados")).toBe("Destilados");
    expect(departmentOf(null)).toBe("Sin categoría");
  });
});

describe("vista Compras", () => {
  const analytics = new Analytics(new FixtureDataSource(NOW));
  const q = { ctx, locationIds: all, productIds: [], days: 30, now: NOW };

  it("KPIs: total exacto, albaranes, proveedores y departamento principal", async () => {
    const view = await analytics.view("compras", q);
    expect(view.kpis.map((k) => [k.id, k.value])).toEqual([
      ["compras", "382,80 €"],
      ["albaranes", "3"],
      ["proveedores", "2"],
      ["departamento_principal", "Cervezas"],
    ]);
    expect(view.kpis.find((k) => k.id === "departamento_principal")!.hint).toBe("34 % de lo comprado");
  });

  it("compras por departamento y por familia: mismo reparto, cada punto con su porcentaje", async () => {
    const view = await analytics.view("compras", q);
    const dep = view.charts.find((c) => c.id === "compras-departamento")!.series[0]!.points;
    expect(dep.map((p) => [p.label, p.display])).toEqual([
      ["Cervezas", "132,00 € · 34 %"],
      ["Destilados", "104,80 € · 27 %"],
      ["Refrescos", "80,00 € · 21 %"],
      ["Aguas", "66,00 € · 17 %"],
    ]);
    const sum = dep.reduce((acc, p) => acc.plus(p.value), new Decimal(0));
    expect(sum.toString()).toBe("382.8");
  });

  it("la evolución diaria tiene un punto por día del periodo y una serie por departamento", async () => {
    const view = await analytics.view("compras", q);
    const daily = view.charts.find((c) => c.id === "compras-diarias")!;
    expect(daily.kind).toBe("line");
    expect(daily.series.map((s) => s.name)).toEqual(["Cervezas", "Destilados", "Refrescos", "Aguas"]);
    expect(daily.series[0]!.points).toHaveLength(30);
    expect(daily.series[0]!.points.find((p) => p.value !== "0")).toMatchObject({ x: "2026-09-20", value: "132" });
  });

  it("con más de cuatro departamentos, las tres primeras líneas y el resto en «Otros»", () => {
    const products = ["Ron Barceló Añejo 70 cl", "Coca-Cola 20 cl", "Cerveza Mahou barril 30 l", "Agua Solán de Cabras 50 cl", "Limones", "Hielo en cubitos"];
    const lines = products.map((name, i) => line({ productId: product(name), amount: String((i + 1) * 10), docDate: "2026-09-20" }));
    const view = comprasView(lines, ctx, window, []);
    const names = view.charts.find((c) => c.id === "compras-diarias")!.series.map((s) => s.name);
    // Seis departamentos con importes 10…60 €: los tres mayores (Hielo 60, Fruta 50, Aguas 40) y «Otros» (30 + 20 + 10).
    expect(names).toEqual(["Hielo", "Fruta", "Aguas", "Otros"]);
    const other = view.charts.find((c) => c.id === "compras-diarias")!.series.at(-1)!.points.find((p) => p.value !== "0");
    expect(other).toMatchObject({ x: "2026-09-20", value: "60" });
  });

  it("por día de la semana: lunes primero, y solo el día del albarán suma", () => {
    // 2026-09-21 es lunes.
    const view = comprasView([line({ docDate: "2026-09-21", amount: "25" })], ctx, window, []);
    const week = view.charts.find((c) => c.id === "compras-dia-semana")!.series[0]!.points;
    expect(week.map((p) => p.label)).toEqual(["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]);
    expect(week.map((p) => p.value)).toEqual(["25", "0", "0", "0", "0", "0", "0"]);
  });

  it("una categoría con padre se reparte por su departamento y su familia", () => {
    const tree = { ...ctx, products: ctx.products.map((p) => (p.name === "Limones" ? { ...p, category: "Cocina › Frutas" } : p)) };
    const view = comprasView([line({ amount: "40" })], tree, window, []);
    const dep = view.charts.find((c) => c.id === "compras-departamento")!.series[0]!.points;
    const fam = view.charts.find((c) => c.id === "compras-familia")!.series[0]!.points;
    expect(dep[0]).toMatchObject({ label: "Cocina", value: "40" });
    expect(fam[0]).toMatchObject({ label: "Frutas", value: "40" });
  });

  it("sin compras, cada gráfica dice que no hay datos", () => {
    const view = comprasView([], ctx, window, []);
    expect(view.kpis[0]!.value).toBe("0,00 €");
    for (const chart of view.charts) expect(chart.empty).toBe("Sin compras en este periodo.");
  });

  it("filtrar por producto deja solo sus líneas", () => {
    const view = comprasView(
      [line({ productId: product("Limones"), amount: "30" }), line({ productId: product("Coca-Cola 20 cl"), amount: "80" })],
      ctx,
      window,
      [product("Limones")],
    );
    expect(view.kpis[0]!.value).toBe("30,00 €");
  });
});
