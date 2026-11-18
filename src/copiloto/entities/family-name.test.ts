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

  it("el título sale como está escrito en el catálogo, con tilde", () => {
    const tonicas = [product("t1", "Tónica Schweppes 20 cl", "Bebida › Aguas, Refrescos y Zumos"), product("t2", "Tónica Fever-Tree 20 cl", "Bebida › Aguas, Refrescos y Zumos"), ...catalog];
    expect(nameGroupOf("tonica", tonicas)?.label).toBe("tónica");
  });

  it("las palabras de la frase que no están en ningún producto no cuentan («ron pasada»)", () => {
    expect(nameGroupOf("ron gasto pasada", catalog)?.products.map((p) => p.id)).toEqual(["1", "2"]);
  });

  it("una palabra de la frase que está por casualidad en otro producto no rompe el grupo", () => {
    const conRuido = [...catalog, product("6", "Gasto de envío", "Oficina › Papelería e Imprenta")];
    expect(nameGroupOf("ron gasto", conRuido)?.products.map((p) => p.id)).toEqual(["1", "2"]);
    expect(nameGroupOf("ron gasto", conRuido, { exact: true })).toBeNull();
  });

  it("un solo producto no es un grupo: lo resuelve la búsqueda normal", () => {
    expect(nameGroupOf("ginebra", catalog)).toBeNull();
  });

  it("no parte palabras: «ron» no casa con «Bronce»", () => {
    expect(nameGroupOf("ron", [...catalog, product("5", "Cubitera Bronce", "Menaje › Menaje de Sala")])?.products.map((p) => p.id)).toEqual(["1", "2"]);
  });

  it("las palabras de la app no son productos: «¿qué albaranes hay?» no es albariño", () => {
    const vinos = [product("v1", "Vino Albariño Mar de Frades", "Bebida › Vinos"), product("v2", "Pazo de San Mauro Albariño", "Bebida › Vinos"), product("v3", "Tónica Schweppes", "Bebida › Refrescos")];
    expect(nameGroupOf("que albaranes hay", vinos)).toBeNull();
    // Con errata («alabran»): se parece más a «albarán» que a «albariño».
    expect(nameGroupOf("que alabranes hay", vinos)).toBeNull();
    expect(nameGroupOf("dime los alabran", vinos)).toBeNull();
    expect(nameGroupOf("cuanto albariño queda", vinos)?.label).toBe("albariño");
  });
});
