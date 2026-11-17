import { describe, expect, it } from "vitest";
import { corregirJerga } from "./jerga";

describe("corregirJerga", () => {
  it.each([
    ["kuanto ron ai en la oliva", "cuanto ron hay en la oliva"],
    ["lo + caro q tenemos", "lo + caro que tenemos"],
    ["xq no ai cocas?", "porque no hay cocas?"],
    ["kiero ver el stock tb", "quiero ver el stock tambien"],
  ])("%s → %s", (input, output) => expect(corregirJerga(input)).toBe(output));

  it("no toca trozos de palabra ni nombres de producto", () => {
    expect(corregirJerga("Aquarius Kiwi y Kas Limón")).toBe("Aquarius Kiwi y Kas Limón");
    expect(corregirJerga("¿Cuántas cajas de Mahou quedan?")).toBe("¿Cuántas cajas de Mahou quedan?");
  });
});
