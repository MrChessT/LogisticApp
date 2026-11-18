// Enlazar artículos del TPV desde el chat, como en Ventas: a un plato, a un producto o ignorarlo en el food cost.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DocumentDraft } from "../contract/index";
import { ORG_ID, PRODUCTS, fixtureContext } from "../dev/fixture";
import { officeAction } from "../agent/office-actions";
import { chat, FakeJev, find, makeAgent, run } from "./helpers";

const confirm = (setup: ReturnType<typeof makeAgent>, draftId: string) =>
  setup.confirmService.confirm({ orgId: ORG_ID, draftId, idempotencyKey: randomUUID() }, fixtureContext(), setup.writer);

async function draftFor(message: string, role: "manager" | "staff" = "manager") {
  const setup = makeAgent(new FakeJev([{ coherencia: 0.95 }]));
  const events = await run(setup.agent, chat(message), role);
  return { setup, draft: find(events, "draft") as DocumentDraft | undefined, text: find(events, "done")?.text ?? "" };
}

describe("enlazar artículos del TPV desde el chat", () => {
  it("se reconoce la orden, y la pregunta no", () => {
    const ctx = fixtureContext();
    expect(officeAction("enlaza el artículo CROQ CASERA del TPV con las croquetas de jamón", ctx)?.accion).toBe("enlazar_venta");
    expect(officeAction("¿qué artículos del TPV están sin enlazar?", ctx)).toBeNull();
  });

  it("a un plato: una ración por venta, y al confirmar se guarda como en Ventas", async () => {
    const { setup, draft } = await draftFor("enlaza el artículo CROQ CASERA del TPV con las croquetas de jamón");
    expect(draft).toMatchObject({ operation: "enlazar_venta", title: "Ventas: CROQ CASERA", lines: [{ label: "CROQ CASERA", qty: "→ Croquetas de jamón · 1 ración por venta" }] });
    expect(draft!.salesLink).toEqual({ itemId: "e2000000-0000-4000-8000-000000000001", itemName: "CROQ CASERA", recipeId: "e0000000-0000-4000-8000-000000000001", qty: "1" });
    const result = await confirm(setup, draft!.draftId);
    expect(result).toMatchObject({ ok: true, message: "«CROQ CASERA» enlazado: sus ventas ya tienen coste en Ventas.", navigate: { route: "/ventas" } });
    expect(setup.writer.calls).toEqual([{ method: "linkSalesItem", args: draft!.salesLink }]);
  });

  it("a un producto, con la cantidad que gasta cada venta", async () => {
    const { draft } = await draftFor("la COPA DE LA CASA del TPV son 15 cl de ron barceló");
    expect(draft!.salesLink).toEqual({ itemId: "e2000000-0000-4000-8000-000000000003", itemName: "COPA DE LA CASA", productId: PRODUCTS[0]!.id, qty: "150" });
    expect(draft!.lines[0]!.qty).toBe("→ Ron Barceló Añejo 70 cl · 150 ml por venta");
  });

  it("un producto a granel sin cantidad: la pide, no la inventa", async () => {
    expect((await draftFor("enlaza el artículo COPA DE LA CASA del TPV con el ron barceló")).text).toMatch(/^¿Cuánto de «Ron Barceló Añejo 70 cl» gasta cada venta\?/);
  });

  it("ignorar un artículo", async () => {
    const { draft } = await draftFor("ignora el artículo Servicio de pan del TPV");
    expect(draft!.salesLink).toEqual({ itemId: "e2000000-0000-4000-8000-000000000002", itemName: "Servicio de pan", ignored: true });
  });

  it("sin permiso de ventas, el aviso de siempre", async () => {
    const { draft, text } = await draftFor("ignora el artículo Servicio de pan del TPV", "staff");
    expect(draft).toBeUndefined();
    expect(text).toMatch(/^Las ventas las ve la dirección/);
  });
});
