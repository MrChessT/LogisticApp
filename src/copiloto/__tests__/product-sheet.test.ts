import { describe, expect, it } from "vitest";
import { parseSheet } from "../agent/product-sheet";
import { CATEGORIES, fixtureContext } from "../dev/fixture";

const ctx = fixtureContext();
const cat = (name: string) => CATEGORIES.find((c) => c.name === name)!.id;

describe("ficha de un producto dicha en una frase", () => {
  it.each([
    ["pon el hielo en Fruta", { categoryId: cat("Fruta"), productPhrase: "hielo" }],
    ["cambia la categoría de la tónica a Aguas", { categoryId: cat("Aguas"), productPhrase: "tonica" }],
    ["los rones van en Destilados", { categoryId: cat("Destilados"), productPhrase: "rones" }],
  ])("«%s» → categoría", (message, expected) => {
    expect(parseSheet(message, ctx)).toMatchObject(expected);
  });

  it("alérgenos: añadir y quitar", () => {
    expect(parseSheet("la tónica lleva sulfitos", ctx)).toMatchObject({ addAllergens: ["sulfitos"], removeAllergens: [], productPhrase: "tonica" });
    expect(parseSheet("quita la lactosa de los limones", ctx)).toMatchObject({ addAllergens: [], removeAllergens: ["lacteos"], productPhrase: "limones" });
    expect(parseSheet("el hielo no lleva gluten", ctx)).toMatchObject({ removeAllergens: ["gluten"], productPhrase: "hielo" });
  });

  it.each(["¿lleva gluten la tónica?", "stock de refrescos", "¿qué categoría tiene el ron?", "merma de 2 cajas de coca"])("«%s» no es un cambio de ficha", (m) => {
    expect(parseSheet(m, ctx)).toBeNull();
  });
});

describe("borrador de ficha desde el chat", async () => {
  const { randomUUID } = await import("node:crypto");
  const { ORG_ID } = await import("../dev/fixture");
  const { officeAction } = await import("../agent/office-actions");
  const { chat, FakeJev, find, makeAgent, run } = await import("./helpers");
  type DocumentDraft = import("../contract/index").DocumentDraft;

  it("«pon el hielo en Fruta»: borrador con antes → después y, al confirmar, guardado; sin llamar a Jev", async () => {
    const jev = new FakeJev();
    const setup = makeAgent(jev);
    const draft = find(await run(setup.agent, chat("pon el hielo en Fruta")), "draft") as DocumentDraft;
    expect(draft).toMatchObject({ operation: "ficha_producto", title: "Ficha: Hielo en cubitos (categoría Fruta)", requiredRole: "manager" });
    expect(draft.lines).toEqual([{ label: "Hielo en cubitos", qty: "Hielo → Fruta" }]);
    expect(jev.calls).toHaveLength(0);
    const result = await setup.confirmService.confirm({ orgId: ORG_ID, draftId: draft.draftId, idempotencyKey: randomUUID() }, fixtureContext(), setup.writer);
    expect(result).toMatchObject({ ok: true, message: "Ficha del producto actualizada.", navigate: { route: "/productos" } });
    expect(setup.writer.calls).toEqual([{ method: "updateProductSheet", args: draft.sheet }]);
  });

  it("una familia entera: los dos rones llevan sulfitos", async () => {
    const draft = find(await run(makeAgent(new FakeJev()).agent, chat("los destilados llevan sulfitos")), "draft") as DocumentDraft;
    expect(draft.sheet!.addAllergens).toEqual(["sulfitos"]);
    expect(draft.lines.map((l) => l.label)).toEqual(["Ron Barceló Añejo 70 cl", "Ron Brugal Añejo 70 cl", "Ginebra Tanqueray 70 cl"]);
    expect(draft.warnings).toContain("Se cambian los 3 productos de la lista.");
  });

  it("varios productos que no son familia: pregunta a cuál, con «A todos»", async () => {
    const ask = find(await run(makeAgent(new FakeJev()).agent, chat("el ron lleva sulfitos")), "clarify")!;
    expect(ask.question).toBe("¿A cuál de estos productos?");
    expect(ask.options.at(-1)).toMatchObject({ id: "todos", label: "A todos" });
  });

  it("el personal no cambia fichas; las preguntas no son órdenes", async () => {
    const events = await run(makeAgent(new FakeJev()).agent, chat("pon el hielo en Fruta"), "staff");
    expect(find(events, "draft")).toBeUndefined();
    expect(officeAction("qué platos llevan gluten", ctx)).toBeNull();
    expect(officeAction("¿lleva gluten la tónica?", ctx)).toBeNull();
    expect(officeAction("merma de 2 cajas de coca en el parador", ctx)?.accion).not.toBe("ficha_producto");
  });
});
