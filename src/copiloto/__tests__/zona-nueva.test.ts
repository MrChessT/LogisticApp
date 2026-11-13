// Crear una zona desde el chat, como «Añadir zona» en Zonas.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DocumentDraft } from "../contract/index";
import { officeAction } from "../agent/office-actions";
import { zoneName } from "../drafts/zone-builder";
import { ORG_ID, fixtureContext } from "../dev/fixture";
import { chat, FakeJev, find, makeAgent, run } from "./helpers";

const ctx = fixtureContext();
const locs = ctx.locations.map((l) => l.name);

describe("nombre y orden", () => {
  it.each([
    ["crea la zona Terraza en el Vivero", "Terraza"],
    ["añade una sección llamada «Cámara 2» al Parador", "Cámara 2"],
    ["nueva zona cocina fría de servicio en Pickels", "Cocina fría"],
  ])("«%s» → «%s»", (m, name) => expect(zoneName(m, locs)).toBe(name));

  it("solo la orden: preguntar por las zonas es una consulta", () => {
    expect(officeAction("crea la zona Terraza en el Vivero", ctx)?.accion).toBe("crear_zona");
    expect(officeAction("¿qué zonas tiene el Parador?", ctx)).toBeNull();
  });
});

describe("borrador", () => {
  it("«crea la zona Terraza en el Vivero»: de servicio por el nombre; al confirmar, creada", async () => {
    const setup = makeAgent(new FakeJev());
    const draft = find(await run(setup.agent, chat("crea la zona Terraza en el Vivero")), "draft") as DocumentDraft;
    expect(draft).toMatchObject({ operation: "crear_zona", title: "Zona nueva en Vivero: Terraza", zone: { name: "Terraza", kind: "servicio" } });
    const result = await setup.confirmService.confirm({ orgId: ORG_ID, draftId: draft.draftId, idempotencyKey: randomUUID() }, fixtureContext(), setup.writer);
    expect(result).toMatchObject({ ok: true, message: "Zona «Terraza» creada.", navigate: { route: "/zonas" } });
    expect(setup.writer.calls).toEqual([{ method: "createArea", args: { locationId: draft.locationId, name: "Terraza", kind: "servicio" } }]);
  });

  it("tipo dudoso: pregunta si es para guardar o para servir, y sigue", async () => {
    const setup = makeAgent(new FakeJev());
    const ask = find(await run(setup.agent, chat("crea la zona Pasillo en el Parador")), "clarify")!;
    expect(ask.question).toBe("¿«Pasillo» es para guardar o para servir?");
    const draft = find(await run(setup.agent, chat("Para guardar", { clarification: { clarifyId: ask.clarifyId, optionId: "tipo:almacen" } })), "draft") as DocumentDraft;
    expect(draft.zone).toEqual({ name: "Pasillo", kind: "almacen" });
  });

  it("si ya existe lo dice; el personal no crea zonas", async () => {
    expect(JSON.stringify(await run(makeAgent(new FakeJev()).agent, chat("crea la zona Barra 1 en el Parador")))).toContain("Parador ya tiene una zona «Barra 1»");
    expect(find(await run(makeAgent(new FakeJev()).agent, chat("crea la zona Terraza en el Vivero"), "staff"), "draft")).toBeUndefined();
  });
});
