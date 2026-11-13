// Formato nuevo de un producto desde el chat, como en su ficha.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DocumentDraft } from "../contract/index";
import { officeAction } from "../agent/office-actions";
import { packFrom } from "../drafts/pack-builder";
import { ORG_ID, PRODUCTS, fixtureContext } from "../dev/fixture";
import { chat, FakeJev, find, makeAgent, run } from "./helpers";

const byName = (n: string) => PRODUCTS.find((p) => p.name.startsWith(n))!;
const ctx = fixtureContext();

describe("cantidad del formato en unidad base", () => {
  it.each([
    ["la coca también viene en caja de 12", "Coca-Cola", "Caja 12 ud", "12"],
    ["el Barceló viene en caja de 6 botellas", "Ron Barceló", "Caja 6 botellas", "4200"],
    ["el hielo viene en saco de 5 kg", "Hielo", "Saco 5 kg", "5000"],
    ["la cerveza viene en barril de 50 litros", "Cerveza Mahou", "Barril 50 litros", "50000"],
  ])("«%s»", (message, product, name, qty) => {
    const pack = packFrom(message, byName(product));
    expect(pack && !("error" in pack) && { name: pack.name, qty: pack.qtyBase.toString() }).toEqual({ name, qty });
  });

  it("unidad que no encaja con el producto: lo dice", () => {
    expect(packFrom("la coca viene en caja de 5 kg", byName("Coca-Cola"))).toEqual({ error: "Coca-Cola 20 cl no se mide en kg: dime cuántas unidades lleva el formato." });
  });

  it("solo la orden", () => {
    expect(officeAction("la coca también viene en caja de 12", ctx)?.accion).toBe("formato_producto");
    expect(officeAction("¿en qué formatos viene la coca?", ctx)).toBeNull();
  });
});

describe("borrador", () => {
  it("«el Barceló viene en caja de 12 botellas»: borrador y, al confirmar, añadido; sin llamar a Jev", async () => {
    const jev = new FakeJev();
    const setup = makeAgent(jev);
    const draft = find(await run(setup.agent, chat("el Barceló viene en caja de 12 botellas")), "draft") as DocumentDraft;
    expect(draft).toMatchObject({ operation: "formato_producto", title: "Formato nuevo de Ron Barceló Añejo 70 cl: Caja 12 botellas", pack: { name: "Caja 12 botellas", qtyBase: "8400" } });
    expect(jev.calls).toHaveLength(0);
    const result = await setup.confirmService.confirm({ orgId: ORG_ID, draftId: draft.draftId, idempotencyKey: randomUUID() }, fixtureContext(), setup.writer);
    expect(result).toMatchObject({ ok: true, message: "Formato «Caja 12 botellas» añadido.", navigate: { route: "/productos" } });
    expect(setup.writer.calls).toEqual([{ method: "addPack", args: draft.pack }]);
  });

  it("un formato que ya tiene (misma cantidad): lo dice en vez de duplicarlo", async () => {
    const events = await run(makeAgent(new FakeJev()).agent, chat("el Barceló viene en caja de 6 botellas"));
    expect(find(events, "draft")).toBeUndefined();
    expect(JSON.stringify(events)).toContain("ya tiene el formato «Caja 6 botellas»");
  });
});
