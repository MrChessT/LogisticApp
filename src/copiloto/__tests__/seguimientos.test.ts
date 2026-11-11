import { describe, expect, it } from "vitest";
import type { SseEvent } from "../contract/index";
import { fixtureContext } from "../dev/fixture";
import { groundedProducts } from "../agent/loop";
import { contextReference } from "../agent/routing";
import { Metrics } from "../metrics/metrics";
import { Assistant } from "../writer/assistant";
import { chat, FakeJev, FakeProvider, makeAgent, run } from "./helpers";

const STOCK = { intent: "consultar", intent_alt: "leer", herramienta: "query_stock", local: "Vivero", producto_0: "Coca-Cola 20 cl" };
const MOVES = { intent: "consultar", intent_alt: "leer", herramienta: "query_movements", local: "Vivero", producto_0: "Coca-Cola 20 cl", periodo: "ayer" };
const text = (events: SseEvent[]) => events.filter((e) => e.event === "text").map((e) => (e.data as { delta: string }).delta).join("");

describe("¿depende de lo hablado?", () => {
  it.each([
    ["¿y sus proveedores?", "fuerte"],
    ["¿y cuánto se vendió de eso ayer?", "fuerte"],
    ["¿a cuánto la compramos?", "fuerte"],
    ["¿quién nos la trae?", "fuerte"],
    ["lo mismo pero en ventas", "fuerte"],
    ["¿y el food cost de ese plato?", "fuerte"],
    ["¿y en Pickles?", "debil"],
    ["también en el Vivero", "debil"],
    ["¿cómo voy esta semana?", null],
    ["este mes cuánto he gastado", null],
    ["stock de ron en La Oliva", null],
    ["¿cuánta tónica queda?", null],
  ])("«%s» → %s", (message, expected) => expect(contextReference(message)).toBe(expected));
});

describe("productos de la reescritura", () => {
  it("solo los que salen en la conversación o el foco", () => {
    const ctx = fixtureContext();
    expect(groundedProducts("¿cuánta coca-cola se vendió ayer?", "¿cuánta coca-cola queda en el Vivero?", ctx)).toBe(true);
    expect(groundedProducts("¿cuánta tónica se vendió ayer?", "¿cuánta coca-cola queda en el Vivero?", ctx)).toBe(false);
    expect(groundedProducts("¿qué proveedores tenemos?", "", ctx)).toBe(true);
  });
});

describe("reescritura de seguimientos antes de enrutar", () => {
  it("«¿y cuánto se vendió de eso ayer?» tras la coca: la IA lo completa y no va al total de ventas", async () => {
    const jev = new FakeJev([STOCK, MOVES]);
    const provider = new FakeProvider([['{"tipo":"datos","consulta":"¿cuánta coca-cola se gastó ayer en el Vivero?"}']]);
    const { agent } = makeAgent(jev, null, { assistant: new Assistant(provider, new Metrics("0")) });
    await run(agent, chat("¿cuánta coca-cola queda en el Vivero?"));
    expect(provider.prompts).toHaveLength(0);
    const events = await run(agent, chat("¿y cuánto se vendió de eso ayer?"));
    expect(provider.prompts).toHaveLength(1);
    expect(provider.prompts[0]!.system).toContain("continúa la conversación");
    expect(provider.prompts[0]!.user).toContain("Coca-Cola 20 cl");
    expect(jev.calls).toHaveLength(2);
    expect(text(events)).toMatch(/^Entiendo: «¿cuánta coca-cola se gastó ayer en el Vivero\?»/);
  });

  it("sin conversación previa no se llama a la IA", async () => {
    const provider = new FakeProvider([['{"tipo":"datos","consulta":"x"}']]);
    const { agent } = makeAgent(new FakeJev([]), null, { assistant: new Assistant(provider, new Metrics("0")) });
    await run(agent, chat("¿y sus proveedores?"));
    expect(provider.prompts).toHaveLength(0);
  });

  it("«¿y en el Parador?» lo resuelve Jev heredando el foco: sin IA", async () => {
    const provider = new FakeProvider([['{"tipo":"datos","consulta":"x"}']]);
    const { agent } = makeAgent(new FakeJev([STOCK, { ...STOCK, local: "Parador" }]), null, { assistant: new Assistant(provider, new Metrics("0")) });
    await run(agent, chat("¿cuánta coca-cola queda en el Vivero?"));
    await run(agent, chat("¿y en el Parador?"));
    expect(provider.prompts).toHaveLength(0);
  });

  it("si la reescritura se inventa un producto, se usa el mensaje tal cual", async () => {
    const provider = new FakeProvider([['{"tipo":"datos","consulta":"¿cuánta tónica se vendió ayer?"}']]);
    const { agent } = makeAgent(new FakeJev([STOCK]), null, { assistant: new Assistant(provider, new Metrics("0")) });
    await run(agent, chat("¿cuánta coca-cola queda en el Vivero?"));
    const events = await run(agent, chat("¿y cuánto se vendió de eso ayer?"));
    expect(provider.prompts).toHaveLength(1);
    expect(text(events)).not.toContain("Entiendo");
  });
});
