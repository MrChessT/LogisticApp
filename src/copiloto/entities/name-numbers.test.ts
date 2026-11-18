import { describe, expect, it } from "vitest";
import { joinNamesWithNumbers } from "./name-numbers";
import { parseQuantities } from "./quantity-parser";

const names = ["Boj 570 Albariño", "Licor 43", "Coca-Cola 20 cl"];
const read = (m: string) => joinNamesWithNumbers(parseQuantities(m), names).map((s) => [s.amount, s.productText]);

describe("cifras dentro del nombre de un producto", () => {
  it("«1 de Boj 570 Albariño» es un solo producto, con cantidad 1", () => {
    expect(read("han llegado 1 de Boj 570 Albariño a La Oliva")).toEqual([["1", "Boj 570 Albariño"]]);
  });

  it("y sigue separando los productos de verdad", () => {
    expect(read("han llegado 3 de Boj 570 Albariño y 2 de coca")).toEqual([["3", "Boj 570 Albariño"], ["2", "coca"]]);
    expect(read("han llegado 3 de ron y 2 de coca")).toEqual([["3", "ron"], ["2", "coca"]]);
  });
});
