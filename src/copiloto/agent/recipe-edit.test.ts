import { describe, expect, it } from "vitest";
import type { RecipeRef } from "../domain";
import { recipeEditFromMessage } from "./recipe-edit";

const recipes: RecipeRef[] = [
  { id: "r1", name: "Croquetas de jamón", kind: "plato", yieldUnit: "racion" },
  { id: "r2", name: "Croquetas", kind: "plato", yieldUnit: "racion" },
  { id: "r3", name: "Gazpacho", kind: "plato", yieldUnit: "racion" },
  { id: "r4", name: "Bechamel", kind: "elaboracion", yieldUnit: "g" },
  { id: "r5", name: "Coca", kind: "plato", yieldUnit: "racion" },
];
const read = (m: string) => {
  const r = recipeEditFromMessage(m, recipes);
  return r && [r.recipe.name, r.op, r.phrase, r.amount, r.unit];
};

describe("cambio de ingredientes de un escandallo", () => {
  it("añadir, quitar y cambiar la cantidad", () => {
    expect(read("añade 20 g de queso rallado a las croquetas de jamón")).toEqual(["Croquetas de jamón", "add", "queso rallado", "20", "g"]);
    expect(read("quita el ajo del gazpacho")).toEqual(["Gazpacho", "remove", "ajo", null, null]);
    expect(read("en las croquetas pon 150 g de jamón")).toEqual(["Croquetas", "set", "jamon", "150", "g"]);
    expect(read("cambia el jamón de las croquetas a 150 gramos")).toEqual(["Croquetas", "set", "jamon", "150", "g"]);
    expect(read("mete 80 g de bechamel en el escandallo de croquetas de jamón")).toEqual(["Croquetas de jamón", "add", "bechamel", "80", "g"]);
  });

  it("no confunde otras órdenes ni las preguntas sin cantidad", () => {
    expect(read("saca 2 cajas de coca a la barra 1")).toBeNull();
    expect(read("quita la tónica del pedido de Makro")).toBeNull();
    expect(read("añade 20 g de queso a la pizza")).toBeNull();
    expect(read("pon el jamón en las croquetas")).toBeNull();
    expect(read("¿cuánto cuesta el gazpacho?")).toBeNull();
  });
});
