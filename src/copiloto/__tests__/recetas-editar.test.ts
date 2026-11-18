// Cambiar los ingredientes de un escandallo que ya existe desde el chat: añadir, sumar, quitar o cambiar la
// cantidad. El borrador enseña el cambio y al confirmar se aplica solo eso (edit_recipe_lines).
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DocumentDraft } from "../contract/index";
import { ORG_ID, PRODUCTS, fixtureContext } from "../dev/fixture";
import { officeAction } from "../agent/office-actions";
import { chat, FakeJev, find, makeAgent, run } from "./helpers";

const CROQUETAS = "e0000000-0000-4000-8000-000000000001";
const BECHAMEL_LINE = "e1000000-0000-4000-8000-000000000001";
const LIMONES_LINE = "e1000000-0000-4000-8000-000000000002";

const confirm = (setup: ReturnType<typeof makeAgent>, draftId: string) =>
  setup.confirmService.confirm({ orgId: ORG_ID, draftId, idempotencyKey: randomUUID() }, fixtureContext(), setup.writer);

async function draftFor(message: string, role: "manager" | "staff" = "manager") {
  const setup = makeAgent(new FakeJev([{ coherencia: 0.95 }]));
  const events = await run(setup.agent, chat(message), role);
  return { setup, draft: find(events, "draft") as DocumentDraft | undefined, text: find(events, "done")?.text ?? "" };
}

describe("editar un escandallo desde el chat", () => {
  it("se reconoce como cambio de escandallo, no como escandallo nuevo ni como PVP", () => {
    const ctx = fixtureContext();
    expect(officeAction("añade 20 g de hielo a las croquetas de jamón", ctx)?.accion).toBe("editar_escandallo");
    expect(officeAction("crea el plato croquetas de jamón con PVP 9", ctx)?.accion).toBe("crear_escandallo");
    expect(officeAction("pon el PVP de las croquetas de jamón a 10 €", ctx)?.accion).toBe("precio_venta");
  });

  it("añadir un producto: borrador con la cantidad y, al confirmar, solo ese cambio", async () => {
    const { setup, draft } = await draftFor("añade 20 g de hielo en cubitos a las croquetas de jamón");
    expect(draft).toMatchObject({ operation: "editar_escandallo", title: "Escandallo: Croquetas de jamón" });
    expect(draft!.lines).toEqual([{ label: "Añadir Hielo en cubitos", qty: "20 g" }]);
    expect(draft!.recipeEdit).toEqual({ recipeId: CROQUETAS, recipeName: "Croquetas de jamón", changes: [{ op: "add", productId: PRODUCTS[8]!.id, qty: "20" }] });
    const result = await confirm(setup, draft!.draftId);
    expect(result).toMatchObject({ ok: true, message: "Escandallo «Croquetas de jamón» actualizado. El coste nuevo ya está en Escandallos.", navigate: { route: "/escandallos" } });
    expect(setup.writer.calls).toEqual([{ method: "editRecipeLines", args: { recipeId: CROQUETAS, changes: draft!.recipeEdit!.changes } }]);
  });

  it("añadir lo que ya lleva suma a su línea", async () => {
    const { draft } = await draftFor("añade 10 g de limones a las croquetas de jamón");
    expect(draft!.lines).toEqual([{ label: "Limones (ya lo lleva: se suma)", qty: "5 g → 15 g" }]);
    expect(draft!.recipeEdit!.changes).toEqual([{ op: "set", lineId: LIMONES_LINE, qty: "15" }]);
  });

  it("cambiar la cantidad de una elaboración que lleva, en su unidad", async () => {
    const { draft } = await draftFor("pon 0,1 kg de bechamel en las croquetas de jamón");
    expect(draft!.lines).toEqual([{ label: "Bechamel", qty: "80 g → 100 g" }]);
    expect(draft!.recipeEdit!.changes).toEqual([{ op: "set", lineId: BECHAMEL_LINE, qty: "100" }]);
  });

  it("quitar un ingrediente", async () => {
    const { draft } = await draftFor("quita la bechamel de las croquetas de jamón");
    expect(draft!.lines).toEqual([{ label: "Quitar Bechamel", qty: "80 g" }]);
    expect(draft!.recipeEdit!.changes).toEqual([{ op: "remove", lineId: BECHAMEL_LINE }]);
  });

  it("lo que no lleva o no cuadra se dice, sin borrador", async () => {
    expect((await draftFor("quita el ajo de las croquetas de jamón")).text).toBe("«Croquetas de jamón» no lleva «ajo». Lleva: Bechamel, Limones.");
    expect((await draftFor("pon 2 l de bechamel en las croquetas de jamón")).text).toBe("«Bechamel» no se mide en l: pon la cantidad en g o kg.");
  });

  it("el personal no cambia escandallos", async () => {
    const { draft, text } = await draftFor("quita la bechamel de las croquetas de jamón", "staff");
    expect(draft).toBeUndefined();
    expect(text).toBe("Los escandallos los cambian los encargados y la administración.");
  });
});
