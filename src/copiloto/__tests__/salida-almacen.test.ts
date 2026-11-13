// Apuntar una salida de almacén desde el chat, como en la pantalla de Almacén: queda pendiente de validar.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DocumentDraft } from "../contract/index";
import { officeAction } from "../agent/office-actions";
import { AREAS, ORG_ID, fixtureContext } from "../dev/fixture";
import { chat, FakeJev, find, makeAgent, run } from "./helpers";

const ctx = fixtureContext();
const confirm = (setup: ReturnType<typeof makeAgent>, draftId: string) =>
  setup.confirmService.confirm({ orgId: ORG_ID, draftId, idempotencyKey: randomUUID() }, fixtureContext(), setup.writer);

describe("reconocer la orden", () => {
  it.each(["saca 2 cajas de coca a la barra 1", "sube 3 botellas de barceló del almacén a la barra 2", "devuelve 1 botella de brugal de la barra 1 al almacén", "apunta una salida de 2 cajas de coca a la barra 1"])("«%s» es una salida", (m) => {
    expect(officeAction(m, ctx)?.accion).toBe("salida_almacen");
  });

  it.each(["baja 2 botellas de ron rotas en barra 1", "pasa 2 cajas de coca del Parador al Vivero", "¿cuánta coca hay en la barra 1?", "se han roto 2 botellas en la barra"])("«%s» no lo es", (m) => {
    expect(officeAction(m, ctx)?.accion).not.toBe("salida_almacen");
  });
});

describe("borrador y confirmación", () => {
  it("«saca 2 cajas de coca a la barra 1»: del Almacén del Parador a Barra 1, pendiente de validar; sin llamar a Jev", async () => {
    const jev = new FakeJev();
    const setup = makeAgent(jev);
    const draft = find(await run(setup.agent, chat("saca 2 cajas de coca a la barra 1")), "draft") as DocumentDraft;
    expect(draft).toMatchObject({ operation: "salida_almacen", title: "Salida en Parador: 2 cajas de Coca-Cola 20 cl", summary: "Parador · Almacén → Barra 1 · queda pendiente de validar" });
    expect(draft.move).toMatchObject({ qtyBase: "48", kind: "salida", fromAreaId: AREAS[2]!.id, toAreaId: AREAS[0]!.id });
    expect(jev.calls).toHaveLength(0);
    const result = await confirm(setup, draft.draftId);
    expect(result).toMatchObject({ ok: true, message: "Salida apuntada: queda pendiente de validar (el stock se mueve al validarla).", navigate: { route: "/almacen" } });
    expect(setup.writer.calls[0]).toMatchObject({ method: "submitAreaMove", args: { productId: draft.move!.productId, qtyBase: "48", kind: "salida" } });
  });

  it("una devolución va de la barra al almacén", async () => {
    const draft = find(await run(makeAgent(new FakeJev()).agent, chat("devuelve 1 botella de brugal de la barra 1 al almacén")), "draft") as DocumentDraft;
    expect(draft.move).toMatchObject({ kind: "devolucion", fromAreaId: AREAS[0]!.id, toAreaId: AREAS[2]!.id, qtyBase: "700" });
  });

  it("producto con varios candidatos: pregunta cuál y sigue", async () => {
    const setup = makeAgent(new FakeJev());
    const ask = find(await run(setup.agent, chat("saca 2 botellas de ron a la barra 1")), "clarify")!;
    expect(ask.options.map((o) => o.label).sort()).toEqual(["Ron Barceló Añejo 70 cl", "Ron Brugal Añejo 70 cl"]);
    const brugal = ask.options.find((o) => o.label.includes("Brugal"))!;
    const draft = find(await run(setup.agent, chat(brugal.label, { clarification: { clarifyId: ask.clarifyId, optionId: brugal.id } })), "draft") as DocumentDraft;
    expect(draft.lines).toEqual([{ label: "Ron Brugal Añejo 70 cl", qty: "2 botellas" }]);
  });

  it("«a la barra» con Barra 1 y Barra 2: pregunta a cuál (no adivina) y sigue con la elegida", async () => {
    const setup = makeAgent(new FakeJev());
    const ask = find(await run(setup.agent, chat("saca 2 cajas de coca a la barra del Parador")), "clarify")!;
    expect(ask.question).toBe("¿A qué zona va?");
    expect(ask.options.map((o) => o.label)).toEqual(["Barra 1", "Barra 2"]);
    const draft = find(await run(setup.agent, chat("Barra 2", { clarification: { clarifyId: ask.clarifyId, optionId: ask.options[1]!.id } })), "draft") as DocumentDraft;
    expect(draft.move!.toAreaId).toBe(AREAS[1]!.id);
  });
});
