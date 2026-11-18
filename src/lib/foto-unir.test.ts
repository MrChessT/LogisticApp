import { describe, expect, it } from "vitest";
import { colocarPaginas } from "./foto-unir";

describe("colocar las páginas una debajo de otra", () => {
  it("al ancho de la más ancha (con tope), cada una a su proporción", () => {
    expect(colocarPaginas([{ ancho: 1000, alto: 1400 }, { ancho: 500, alto: 700 }])).toEqual({ ancho: 1000, altos: [1400, 1400] });
    expect(colocarPaginas([{ ancho: 3600, alto: 4800 }])).toEqual({ ancho: 1800, altos: [2400] });
  });

  it("si no caben en alto, se reducen todas por igual", () => {
    const r = colocarPaginas([{ ancho: 1000, alto: 9000 }, { ancho: 1000, alto: 9000 }], 1800, 15000);
    expect(r.altos.reduce((s, a) => s + a, 0)).toBeLessThanOrEqual(15000);
    expect(r.ancho).toBe(833);
  });
});
