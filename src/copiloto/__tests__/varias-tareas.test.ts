// Varias órdenes en un mensaje: un borrador por orden, cada uno confirmable por separado. Sin Jev.
import { describe, expect, it } from "vitest";
import type { DocumentDraft } from "../contract/index";
import { splitTasks } from "../agent/multi-task";
import { chat, FakeJev, find, makeAgent, run } from "./helpers";

describe("partir el mensaje en órdenes", () => {
  it("dos órdenes unidas con «y» o «;»", () => {
    expect(splitTasks("pon el PVP de las croquetas a 9,50 y asocia Makro a la coca cola 20 cl")).toEqual(["pon el PVP de las croquetas a 9,50", "asocia Makro a la coca cola 20 cl"]);
    expect(splitTasks("pon el PVP de las croquetas a 9,50; crea la zona Terraza en el Vivero")).toHaveLength(2);
  });

  it("«Pan y tomate» no se parte: no hay otra orden después de «y»", () => {
    expect(splitTasks("crea el plato Pan y tomate con PVP 5")).toBeNull();
  });

  it("una sola orden no es varias", () => {
    expect(splitTasks("pon el PVP de las croquetas a 9,50")).toBeNull();
  });
});

describe("varias órdenes de oficina dan varios borradores", () => {
  it("dos borradores, cada uno con su operación, y un texto final; Jev no se llama", async () => {
    const jev = new FakeJev();
    const setup = makeAgent(jev);
    const events = await run(setup.agent, chat("pon el PVP de las croquetas a 9,50 y asocia Makro a la coca cola 20 cl"));
    const drafts = events.filter((e) => e.event === "draft").map((e) => e.data as DocumentDraft);
    expect(drafts.map((d) => d.operation)).toEqual(["precio_venta", "asociar_proveedor"]);
    expect(find(events, "done")?.text).toBe("He preparado 2 borradores: confírmalos uno a uno.");
    expect(jev.calls).toHaveLength(0);
  });

  it("si una parte no es de oficina, el mensaje sigue el camino normal (no se parte)", async () => {
    const setup = makeAgent(new FakeJev());
    const events = await run(setup.agent, chat("pon el PVP de las croquetas a 9,50 y qué tiempo hace"));
    expect(events.filter((e) => e.event === "draft").length).toBeLessThanOrEqual(1);
    expect(find(events, "done")?.text).not.toContain("borradores");
  });
});
