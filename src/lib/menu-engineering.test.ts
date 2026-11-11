import { describe, expect, it } from "vitest";
import { menuEngineering } from "./menu-engineering";

// Carta inventada: 4 platos, 100 raciones.
const carta = [
  { id: "a", name: "Arroz", qty: 40, amount: 800, cost: 240 }, // 20 € − 6 € = 14 € · 40 %
  { id: "b", name: "Hamburguesa", qty: 35, amount: 420, cost: 210 }, // 12 € − 6 € = 6 € · 35 %
  { id: "c", name: "Lubina", qty: 15, amount: 375, cost: 105 }, // 25 € − 7 € = 18 € · 15 %
  { id: "d", name: "Ensalada", qty: 10, amount: 90, cost: 50 }, // 9 € − 5 € = 4 € · 10 %
  { id: "e", name: "Sin coste", qty: 5, amount: 50, cost: null },
];

describe("ingeniería de menú", () => {
  it("clasifica por popularidad (70 % de la media) y margen (media ponderada)", () => {
    const r = menuEngineering(carta);
    // Margen medio = (560 + 210 + 270 + 40) / 100 = 10,80 €; umbral de popularidad = 0,7 / 4 = 17,5 %.
    expect(r.avgMargin).toBeCloseTo(10.8);
    expect(r.popularityThreshold).toBeCloseTo(0.175);
    expect(Object.fromEntries(r.rows.map((x) => [x.name, x.cls]))).toEqual({ Arroz: "estrella", Hamburguesa: "caballo", Lubina: "puzle", Ensalada: "perro" });
    expect(r.skipped).toBe(1);
    // Ordenados por lo que aportan en total.
    expect(r.rows.map((x) => x.name)).toEqual(["Arroz", "Lubina", "Hamburguesa", "Ensalada"]);
  });

  it("con menos de dos platos con coste no hay comparación", () => {
    expect(menuEngineering([carta[0]!]).rows).toEqual([]);
    expect(menuEngineering([]).rows).toEqual([]);
  });
});
