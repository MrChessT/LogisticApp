// Escandallos desde el chat: crear un plato o una elaboración con sus ingredientes. Se lee la frase, se busca
// cada ingrediente en el catálogo y nada se guarda hasta que el encargado lo confirma.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DocumentDraft } from "../contract/index";
import { ORG_ID, fixtureContext } from "../dev/fixture";
import { officeAction } from "../agent/office-actions";
import { recipeFromMessage } from "../agent/recipe-chat";
import { chat, FakeJev, find, makeAgent, run } from "./helpers";

const confirm = (setup: ReturnType<typeof makeAgent>, draftId: string) =>
  setup.confirmService.confirm({ orgId: ORG_ID, draftId, idempotencyKey: randomUUID() }, fixtureContext(), setup.writer);

describe("leer el escandallo de la frase", () => {
  it("nombre y PVP de un plato", () => {
    expect(recipeFromMessage("crea el escandallo de croquetas de jamón con PVP 9,50")).toEqual({ kind: "plato", name: "Croquetas de jamón", salePrice: "9.50", ingredients: [] });
  });

  it("los ingredientes tras dos puntos, con su cantidad y unidad", () => {
    expect(recipeFromMessage("nuevo plato Tortilla: 3 huevos, 200 g de patata y 50 ml de aceite")).toEqual({
      kind: "plato",
      name: "Tortilla",
      salePrice: null,
      ingredients: [
        { amount: "3", unit: null, phrase: "huevos" },
        { amount: "200", unit: "g", phrase: "patata" },
        { amount: "50", unit: "ml", phrase: "aceite" },
      ],
    });
  });

  it("el PVP delante de la lista no se come los ingredientes", () => {
    const r = recipeFromMessage("crea el plato Sangría con PVP 6,50: 1 l de Ron Barceló Añejo 70 cl, 2 Coca-Cola 20 cl");
    expect(r?.salePrice).toBe("6.50");
    expect(r?.ingredients).toEqual([
      { amount: "1", unit: "l", phrase: "Ron Barceló Añejo 70 cl" },
      { amount: "2", unit: null, phrase: "Coca-Cola 20 cl" },
    ]);
  });

  it("una elaboración con su nombre y sus ingredientes", () => {
    const r = recipeFromMessage("nueva elaboración salsa de tomate: 1 kg de tomate, 50 ml de aceite");
    expect(r).toMatchObject({ kind: "elaboracion", name: "Salsa de tomate", salePrice: null });
    expect(r?.ingredients.map((i) => i.phrase)).toEqual(["tomate", "aceite"]);
  });

  it("una cantidad sin unidad no se confunde con la unidad (2 limones no es 2 l)", () => {
    expect(recipeFromMessage("crea el plato Limonada: 2 limones")?.ingredients).toEqual([{ amount: "2", unit: null, phrase: "limones" }]);
  });

  it("un ingrediente sin cantidad se conserva para avisar, sin inventarla", () => {
    expect(recipeFromMessage("crea el plato Gazpacho: tomate, 1 kg de pepino")?.ingredients).toEqual([
      { amount: null, unit: null, phrase: "tomate" },
      { amount: "1", unit: "kg", phrase: "pepino" },
    ]);
  });

  it("sin nombre no hay escandallo", () => {
    expect(recipeFromMessage("crea un escandallo")).toBeNull();
  });
});

describe("reconocer la orden de escandallo (no la pregunta ni el PVP de uno existente)", () => {
  const ctx = fixtureContext();
  it.each(["crea el escandallo de croquetas de jamón con PVP 9,50", "nuevo plato Tortilla: 3 huevos", "da de alta la receta de gazpacho"])("«%s» → crear_escandallo", (message) => {
    expect(officeAction(message, ctx)?.accion).toBe("crear_escandallo");
  });

  it("cambiar el PVP de un plato existente sigue siendo precio_venta", () => {
    expect(officeAction("pon el PVP de las croquetas a 10 €", ctx)?.accion).toBe("precio_venta");
  });

  it.each(["¿qué lleva el escandallo de las croquetas?", "¿cuánto cuesta la receta de la tortilla?"])("«%s» es una pregunta", (message) => {
    expect(officeAction(message, ctx)).toBeNull();
  });
});

describe("escandallo nuevo con borrador y confirmación", () => {
  it("un plato con PVP y dos ingredientes del catálogo; al confirmar se crea con sus líneas", async () => {
    const setup = makeAgent(new FakeJev([{ coherencia: 0.95 }]));
    const events = await run(setup.agent, chat("crea el plato Sangría con PVP 6,50: 1 l de Ron Barceló Añejo 70 cl, 2 Coca-Cola 20 cl"));
    const draft = find(events, "draft") as DocumentDraft;
    expect(draft).toMatchObject({ kind: "documento", operation: "crear_escandallo", title: "Escandallo nuevo: Sangría" });
    expect(draft.recipe).toEqual({
      name: "Sangría",
      kind: "plato",
      salePrice: "6.50",
      yieldQty: "1",
      yieldUnit: "racion",
      lines: [
        { productId: draft.recipe!.lines[0]!.productId, qtyBase: "1000" },
        { productId: draft.recipe!.lines[1]!.productId, qtyBase: "2" },
      ],
    });
    expect(draft.lines.map((l) => l.qty)).toEqual(["1 l", "2 ud"]);
    const result = await confirm(setup, draft.draftId);
    expect(result).toMatchObject({ ok: true, message: "Escandallo «Sangría» creado con 2 ingredientes. El coste se calcula en Escandallos.", navigate: { route: "/escandallos" } });
    expect(setup.writer.calls).toEqual([{ method: "createRecipe", args: { orgId: ORG_ID, ...draft.recipe } }]);
  });

  it("una elaboración suma sus ingredientes como rendimiento", async () => {
    const setup = makeAgent(new FakeJev([{ coherencia: 0.95 }]));
    const draft = find(await run(setup.agent, chat("nueva elaboración Limonada base: 1 kg de Limones, 500 g de Hielo en cubitos")), "draft") as DocumentDraft;
    expect(draft.recipe).toMatchObject({ kind: "elaboracion", salePrice: null, yieldQty: "1500", yieldUnit: "g" });
  });

  it("una elaboración con pesos y volúmenes mezclados se rechaza", async () => {
    const { agent } = makeAgent(new FakeJev());
    const events = await run(agent, chat("nueva elaboración Mezcla: 1 kg de Limones, 50 ml de Ron Barceló Añejo 70 cl"));
    expect(find(events, "draft")).toBeUndefined();
    expect(find(events, "done")?.text).toContain("un solo rendimiento");
  });

  it("un ingrediente que no existe se avisa y no se inventa", async () => {
    const setup = makeAgent(new FakeJev([{ coherencia: 0.95 }]));
    const draft = find(await run(setup.agent, chat("crea el plato Gazpacho: 1 kg de pepino de Almería")), "draft") as DocumentDraft;
    expect(draft.warnings.join(" ")).toContain("No encuentro");
    expect(draft.recipe!.lines).toEqual([]);
    expect(draft.lines).toEqual([{ label: "Sin ingredientes", qty: "se añaden en Escandallos" }]);
  });

  it("un escandallo que ya existe no se duplica", async () => {
    const { agent } = makeAgent(new FakeJev());
    const events = await run(agent, chat("crea el escandallo de croquetas de jamón con PVP 9,50"));
    expect(find(events, "draft")).toBeUndefined();
    expect(find(events, "done")?.text).toBe("Ya hay un escandallo llamado «Croquetas de jamón».");
  });
});
