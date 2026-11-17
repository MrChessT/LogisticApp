import { describe, expect, it } from "vitest";
import { chat, FakeJev, find, makeAgent, run } from "./helpers";

// La puerta por especialista dentro del agente: el mismo mensaje, según quién lo escribe.
describe("puerta por especialista en el agente", () => {
  const facturas = { intent: "consultar", intent_alt: "leer", herramienta: "query_invoices" };

  it("el personal sin «ve costes» recibe un aviso sin cifras en vez de las facturas", async () => {
    const { agent, metrics } = makeAgent(new FakeJev([facturas]));
    const text = find(await run(agent, chat("¿qué facturas tenemos pendientes?"), "staff"), "done")!.text;
    expect(text).toMatch(/^Las facturas las ve la dirección/);
    expect(text).not.toMatch(/\d/);
    expect(metrics.snapshot().especialistas.facturas).toBeUndefined();
  });

  it("un encargado sí las recibe, y el especialista queda contado", async () => {
    const { agent, metrics } = makeAgent(new FakeJev([facturas]));
    const text = find(await run(agent, chat("¿qué facturas tenemos pendientes?"), "manager"), "done")!.text;
    expect(text).not.toMatch(/las ve la dirección/);
    expect(metrics.snapshot().especialistas.facturas).toBe(1);
  });
});
