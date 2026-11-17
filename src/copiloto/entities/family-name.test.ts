import { describe, expect, it } from "vitest";
import type { Product } from "../domain";
import { familyOf, nameGroupOf } from "./family";

const product = (id: string, name: string, category: string, notes: string | null = null): Product =>
  ({ id, name, category, notes, dimension: "volume", baseUnit: "ml", packs: [] }) as Product;

const catalog = [
  product("1", "Ron Brugal Añejo 70 cl", "Bebida › Destilados y Licores"),
  product("2", "Bacardi Carta Blanca 70 cl", "Bebida › Destilados y Licores", "Tipo: ron"),
  product("3", "Ginebra Tanqueray 70 cl", "Bebida › Destilados y Licores"),
  product("4", "Coca-Cola 20 cl", "Bebida › Aguas, Refrescos y Zumos"),
];

describe("nameGroupOf", () => {
  it("«ron» sin familia propia: los productos con «ron» en el nombre o en las notas", () => {
    expect(familyOf("ron", catalog)).toBeNull();
    const group = nameGroupOf("ron", catalog);
    expect(group?.label).toBe("ron");
    expect(group?.products.map((p) => p.id)).toEqual(["1", "2"]);
  });

  it("un solo producto no es un grupo: lo resuelve la búsqueda normal", () => {
    expect(nameGroupOf("ginebra", catalog)).toBeNull();
  });

  it("no parte palabras: «ron» no casa con «Bronce»", () => {
    expect(nameGroupOf("ron", [...catalog, product("5", "Cubitera Bronce", "Menaje › Menaje de Sala")])?.products.map((p) => p.id)).toEqual(["1", "2"]);
  });
});
