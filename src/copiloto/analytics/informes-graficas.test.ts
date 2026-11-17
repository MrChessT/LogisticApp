import { describe, expect, it } from "vitest";
import { sinGraficasFueraDeInformes } from "./informes-graficas";

describe("sinGraficasFueraDeInformes", () => {
  it("quita el consumo y la merma por día y la variación de precios, y deja el resto", () => {
    const view = {
      title: "Consumo",
      charts: [{ id: "consumo-diario" }, { id: "mermas-diarias" }, { id: "variacion-precios" }, { id: "consumo" }, { id: "historial-precios" }],
    };
    expect(sinGraficasFueraDeInformes(view).charts.map((c) => c.id)).toEqual(["consumo", "historial-precios"]);
  });

  it("no cambia el resto de la vista", () => {
    const view = { title: "Stock", kpis: [1], charts: [{ id: "valor_stock" }] };
    expect(sinGraficasFueraDeInformes(view)).toEqual(view);
  });
});
