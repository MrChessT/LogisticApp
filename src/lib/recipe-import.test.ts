import { describe, expect, it } from "vitest";
import { harmonizeIngredients, orderByDependency, parseAllergens, parseEscandalloBook, parseUnitPrice, productNameOf, type ImportRecipe } from "./recipe-import";

// Libro con la forma de la exportación «Escandallo» (datos inventados).
const HEAD = ["", "Descripción", "Alérgenos/Comentario", "Código", "Familia", "Origen", "C. Unit.", "Cantidad", "Unidad", "Fecha", "Porcentaje", "Coste"];
const ING = ["", "", "Descripción", "Código", "Alérgenos/Comentario", "C. Unit.", "Bruto", "Neto", "Unidad", "Fecha", "Porcentaje", "Coste"];
const row = (name: string, allergens: string, price: string, gross: number, net: number, unit: string, cost: number | "") =>
  ["", "", name, "", allergens, price, String(gross), String(net), unit, "46300", "", String(cost)];
const book: string[][] = [
  ["", "", "", "", "", "", "", "", "", "", "", "Escandallo"],
  ["", "Restaurante", "Ejemplo SL"],
  HEAD,
  ["", "Salsa verde", "Sulfitos", "", "Salsas\nCarta", "", "8 €/Kg", "1.0", "Kg", "46300", "1.0", "8.0"],
  [],
  ING,
  row("Perejil (Picado)", "", "20 €/Kg", 250, 200, "g", 5),
  row("Aceite de Oliva", "", "6 €/L", 0.5, 0.5, "L", 3),
  row("Vinagre", "Sulfitos(Trazas)", "2 €/L", 10, 10, "ml", 0.02),
  row("Anchoa", "Pescado ", "1,2 €/Lata", 0.5, 0.5, "Lata", 0.6),
  [],
  HEAD,
  ["", "Tosta de salsa verde", "Gluten", "", "Entrantes", "", "1,5 €/Pax", "4.0", "Pax", "46300", "1.0", "6.0"],
  ING,
  row("Pan Rústico", "Cereales con gluten", "4 €/Paquete", 4, 4, "Uni", 2),
  row("Salsa verde", "", "8 €/Kg", 200, 200, "g", 1.6),
  row("Perejil", "", "20 €/Kg", 1, 1, "Manojo", 0.5),
  HEAD,
  ["", "Receta vacía", "", "", "Bases", "", "", "", "", "", "", ""],
  [],
  ING,
];

describe("importar escandallos", () => {
  it("valores sueltos", () => {
    expect(productNameOf("Cebolla Morada (Juliana)")).toBe("Cebolla Morada");
    expect(productNameOf("Pimiento Rojo (Limpio (sin pepitas ni rabo))")).toBe("Pimiento Rojo");
    expect(productNameOf("Chuletero de Ternera (Limpio (sin hueso)) extra")).toBe("Chuletero de Ternera extra");
    expect(parseUnitPrice("6 €/Kg")).toEqual({ price: 0.006, dimension: "mass", unitLabel: "Kg" });
    expect(parseUnitPrice("0,079 €/ml")).toEqual({ price: 0.079, dimension: "volume", unitLabel: "ml" });
    expect(parseUnitPrice("11 €/Paquete")).toEqual({ price: 11, dimension: "count", unitLabel: "Paquete" });
    expect(parseAllergens("Pescado \nFrutos con cáscara\nSulfitos(Trazas)\nCereales con gluten\nLeche")).toEqual(["gluten", "pescado", "lacteos", "frutos_cascara", "sulfitos"]);
  });

  it("lee recetas, rendimientos, cantidades, mermas y precios", () => {
    const p = parseEscandalloBook(book);
    expect(p.format).toBe("escandallo");
    expect(p.recipes.map((r) => [r.name, r.kind, r.yieldQty, r.yieldUnit, r.category])).toEqual([
      ["Salsa verde", "elaboracion", 1000, "g", "Salsas"],
      ["Tosta de salsa verde", "plato", 4, "racion", "Entrantes"],
      ["Receta vacía", "plato", 1, "racion", "Bases"],
    ]);
    const [perejil, aceite, vinagre, anchoa] = p.recipes[0]!.lines;
    // 200 g netos que en el escandallo cuestan 5 € a 20 €/kg → 20 % de merma (como 250 g brutos).
    expect(perejil).toMatchObject({ product: "Perejil", dimension: "mass", qty: 200, waste: 20, unitPrice: 0.02 });
    expect(aceite).toMatchObject({ dimension: "volume", qty: 500, waste: 0, unitPrice: 0.006 });
    expect(vinagre).toMatchObject({ qty: 10, allergens: ["sulfitos"] });
    // Unidad casera («Lata»): cantidad desde el coste y el precio.
    expect(anchoa).toMatchObject({ dimension: "count", qty: 0.5, unitPrice: 1.2 });
    // Pan por unidades con precio por paquete: el precio por unidad sale del coste (2 € / 4 uds).
    expect(p.recipes[1]!.lines[0]).toMatchObject({ product: "Pan Rústico", dimension: "count", qty: 4, unitPrice: 0.5, allergens: ["gluten"] });
    expect(p.recipes[1]!.declaredAllergens).toEqual(["gluten"]);
    expect(p.issues.map((i) => i.message)).toEqual(["No tiene ingredientes legibles."]);
  });

  it("medidas caseras con precio por kilo se pasan a gramos al leer", () => {
    const p = parseEscandalloBook(book);
    // 1 manojo que cuesta 0,50 € a 20 €/kg → 25 g.
    expect(p.recipes[1]!.lines.find((l) => l.ingredient === "Perejil")).toMatchObject({ dimension: "mass", qty: 25, unitPrice: 0.02 });
  });

  it("un ingrediente por unidades en una receta y por peso en otra se pasa a la medida mayoritaria", () => {
    const extra: string[][] = [
      HEAD, ["", "Pan con aceite", "", "", "Desayunos", "", "", "1.0", "Pax", "", "", "1.0"], ING,
      row("Pan Rústico", "", "4 €/Paquete", 2, 2, "Uni", 1),
      HEAD, ["", "Migas", "", "", "Desayunos", "", "", "1.0", "Pax", "", "", "1.0"], ING,
      row("Pan Rústico", "", "5 €/Kg", 100, 100, "g", 0.5),
    ];
    const p = parseEscandalloBook([...book, ...extra]);
    const h = harmonizeIngredients(p.recipes);
    // Pan: 2 recetas por unidades (0,50 €/ud) y 1 por peso → por unidades; 100 g a 0,005 €/g = 0,50 € = 1 ud.
    expect(p.recipes.find((r) => r.name === "Migas")!.lines[0]).toMatchObject({ dimension: "count", qty: 1, unitPrice: 0.5 });
    expect(h.converted).toBe(1);
    expect(h.dropped).toEqual([]);
  });

  it("si el catálogo ya tiene el producto, manda su medida aunque las recetas usen más la otra", () => {
    const extra: string[][] = [
      HEAD, ["", "Pan con aceite", "", "", "Desayunos", "", "", "1.0", "Pax", "", "", "1.0"], ING,
      row("Pan Rústico", "", "4 €/Paquete", 2, 2, "Uni", 1),
      HEAD, ["", "Migas", "", "", "Desayunos", "", "", "1.0", "Pax", "", "", "1.0"], ING,
      row("Pan Rústico", "", "5 €/Kg", 100, 100, "g", 0.5),
    ];
    const p = parseEscandalloBook([...book, ...extra]);
    harmonizeIngredients(p.recipes, new Map([["pan rustico", "mass"]]));
    // En el catálogo va por peso: 2 uds que cuestan 1 € → 200 g a 0,005 €/g.
    expect(p.recipes.find((r) => r.name === "Pan con aceite")!.lines[0]).toMatchObject({ dimension: "mass", qty: 200, unitPrice: 0.005 });
  });

  it("una botella del bar usada en cocina por volumen, sin precio para convertir, va aparte «(cocina)»", () => {
    const extra: string[][] = [
      HEAD, ["", "Salsa de brandy", "", "", "Salsas", "", "", "1.0", "Kg", "", "", ""], ING,
      row("Brandy Terry", "", "", 50, 50, "ml", ""),
    ];
    const p = parseEscandalloBook([...book, ...extra]);
    const h = harmonizeIngredients(p.recipes, new Map([["brandy terry", "count"]]));
    expect(p.recipes.find((r) => r.name === "Salsa de brandy")!.lines[0]).toMatchObject({ product: "Brandy Terry (cocina)", ingredient: "Brandy Terry (cocina)", dimension: "volume", qty: 50 });
    expect(h.kitchen).toEqual(["Brandy Terry (cocina)"]);
    expect(h.dropped).toEqual([]);
  });

  it("ordena para que cada receta vaya después de las que usa", () => {
    const r = (name: string, kind: ImportRecipe["kind"], uses: string[]): ImportRecipe => ({
      name, kind, category: null, yieldQty: 1, yieldUnit: "racion", declaredAllergens: [],
      lines: uses.map((u) => ({ ingredient: u, product: u, dimension: "mass", qty: 1, waste: 0, unitPrice: null, allergens: [] })),
    });
    const list = [r("Plato", "plato", ["Salsa"]), r("Salsa", "elaboracion", ["Fondo"]), r("Fondo", "elaboracion", ["Agua"]), r("Ensalada", "plato", ["Lechuga"])];
    expect(orderByDependency(list).map((x) => x.name)).toEqual(["Fondo", "Ensalada", "Salsa", "Plato"]);
  });

  it("unidad casera sin precio («1 Filete») se cuenta en esas unidades, sin coste", () => {
    const extra: string[][] = [
      HEAD, ["", "Gilda", "Pescado", "", "Tapas", "", "", "1.0", "Pax", "", "", ""], ING,
      row("Anchoas Cantábrico 00", "Pescado", "", 1, 1, "Filete", ""),
      row("Laurel", "", "", 0, 0, "g", ""),
    ];
    const p = parseEscandalloBook([...book, ...extra]);
    expect(p.recipes.find((r) => r.name === "Gilda")!.lines).toEqual([
      expect.objectContaining({ product: "Anchoas Cantábrico 00", dimension: "count", qty: 1, unitPrice: null, waste: 0 }),
    ]);
    // Una cantidad 0 sigue sin poder leerse.
    expect(p.issues.some((i) => i.message.startsWith("«Laurel»"))).toBe(true);
  });

  it("un fichero que no es un escandallo no se lee", () => {
    expect(parseEscandalloBook([["Producto", "Precio"], ["Agua", "1"]]).format).toBeNull();
  });
});
