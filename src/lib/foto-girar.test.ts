import { describe, expect, it } from "vitest";
import { tamanoGirado } from "./foto-girar";

describe("tamanoGirado", () => {
  it("sin giro, el mismo tamaño", () => {
    expect(tamanoGirado(1000, 600, 0)).toEqual({ ancho: 1000, alto: 600, escala: 1 });
  });

  it("un giro de 90° intercambia ancho y alto", () => {
    expect(tamanoGirado(1000, 600, 90)).toMatchObject({ ancho: 600, alto: 1000 });
  });

  it("un giro pequeño ensancha el rectángulo que envuelve la foto", () => {
    const g = tamanoGirado(1000, 600, 5);
    expect(g.ancho).toBeGreaterThan(1000);
    expect(g.alto).toBeGreaterThan(600);
  });

  it("no pasa de MAX_LADO y mantiene la proporción", () => {
    const g = tamanoGirado(4000, 3000, 0);
    expect(Math.max(g.ancho, g.alto)).toBeLessThanOrEqual(2400);
    expect(g.ancho / g.alto).toBeCloseTo(4000 / 3000, 2);
  });
});
