// Proveedor asociado a un producto desde el chat: un borrador (sin precio) que el encargado confirma.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DocumentDraft } from "../contract/index";
import { ORG_ID, fixtureContext, SUPPLIERS } from "../dev/fixture";
import { officeAction } from "../agent/office-actions";
import { chat, FakeJev, find, makeAgent, run } from "./helpers";

const confirm = (setup: ReturnType<typeof makeAgent>, draftId: string) =>
  setup.confirmService.confirm({ orgId: ORG_ID, draftId, idempotencyKey: randomUUID() }, fixtureContext(), setup.writer);

const MAKRO = SUPPLIERS.find((s) => s.name === "Makro")!;

describe("reconocer la asociación de proveedor", () => {
  const ctx = fixtureContext();
  it.each(["el proveedor de Coca-Cola 20 cl es Makro", "asocia Makro a Coca-Cola 20 cl", "nos la trae Makro: Coca-Cola 20 cl"])("«%s» → asociar_proveedor", (message) => {
    expect(officeAction(message, ctx)?.accion).toBe("asociar_proveedor");
  });

  it.each(["¿quién es el proveedor de Coca-Cola 20 cl?", "dime el proveedor de Coca-Cola 20 cl Makro", "cuánto nos cobra Makro por la coca"])("«%s» no es una asignación", (message) => {
    expect(officeAction(message, ctx)?.accion).not.toBe("asociar_proveedor");
  });
});

describe("proveedor asociado con borrador y confirmación", () => {
  it("el borrador lleva el proveedor y el formato de compra; al confirmar se escribe la asociación sin precio", async () => {
    const setup = makeAgent(new FakeJev([{ coherencia: 0.95 }]));
    const draft = find(await run(setup.agent, chat("el proveedor de Coca-Cola 20 cl es Makro")), "draft") as DocumentDraft;
    expect(draft).toMatchObject({ kind: "documento", operation: "asociar_proveedor", title: "Asociar Makro a Coca-Cola 20 cl" });
    expect(draft.supplier).toMatchObject({ supplierId: MAKRO.id, supplierName: "Makro", productName: "Coca-Cola 20 cl" });
    expect(draft.supplier!.packId).toBeTruthy();
    const result = await confirm(setup, draft.draftId);
    expect(result).toMatchObject({ ok: true, message: "Makro asociado a Coca-Cola 20 cl. El precio entra con su primera compra o factura.", navigate: { route: "/productos" } });
    expect(setup.writer.calls).toEqual([{ method: "linkSupplier", args: { supplierId: MAKRO.id, packId: draft.supplier!.packId } }]);
  });

  it("si ya estaba asociado, no cambia nada y lo dice", async () => {
    const setup = makeAgent(new FakeJev([{ coherencia: 0.95 }]));
    const draft = find(await run(setup.agent, chat("el proveedor de Coca-Cola 20 cl es Makro")), "draft") as DocumentDraft;
    setup.writer.failOn = { method: "linkSupplier", code: "duplicate" };
    const result = await confirm(setup, draft.draftId);
    expect(result).toMatchObject({ ok: true, message: "Makro ya es proveedor de Coca-Cola 20 cl en ese formato: no cambio nada." });
  });

  it("un producto que no existe se dice, sin borrador", async () => {
    const { agent } = makeAgent(new FakeJev());
    const events = await run(agent, chat("el proveedor de Pimienta de Cayena es Makro"));
    expect(find(events, "draft")).toBeUndefined();
    expect(find(events, "done")?.text).toContain("No encuentro");
  });
});

describe("el nombre exacto gana a los parecidos", () => {
  it("«Ron Barceló Añejo 70 cl» es ese producto, no el Brugal parecido", async () => {
    const setup = makeAgent(new FakeJev([{ coherencia: 0.95 }]));
    const draft = find(await run(setup.agent, chat("el proveedor de Ron Barceló Añejo 70 cl es Makro")), "draft") as DocumentDraft;
    expect(draft.supplier!.productName).toBe("Ron Barceló Añejo 70 cl");
  });
});
