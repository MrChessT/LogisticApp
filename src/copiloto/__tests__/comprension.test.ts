import { describe, expect, it } from "vitest";
import type { SseEvent } from "../contract/index";
import { Metrics } from "../metrics/metrics";
import { Assistant, parseUnderstanding } from "../writer/assistant";
import { chat, FakeJev, FakeProvider, makeAgent, run } from "./helpers";

const DOUBT = { intent: { dist: { consultar: 0.5, proponer_accion: 0.4 } }, intent_alt: { dist: { ninguno: 0.6, leer: 0.4 } } };
const STOCK = { intent: "consultar", intent_alt: "leer", herramienta: "query_stock", local: "Vivero", producto_0: "Coca-Cola 20 cl" };

const text = (events: SseEvent[]) => events.filter((e) => e.event === "text").map((e) => (e.data as { delta: string }).delta).join("");
const clarify = (events: SseEvent[]) => events.find((e) => e.event === "clarify");
const assistant = (answer: string) => new Assistant(new FakeProvider([[answer]]), new Metrics("0"));

describe("comprensión con IA validada por Jev", () => {
  it("reescribe con el contexto, Jev lo entiende y se dice cómo se ha leído", async () => {
    const jev = new FakeJev([DOUBT, STOCK]);
    const { agent } = makeAgent(jev, null, { assistant: assistant('{"tipo":"datos","consulta":"¿cuánta coca-cola queda en el Vivero?"}') });
    const events = await run(agent, chat("¿y de la otra cuánta hay en el Vivero?"));
    expect(clarify(events)).toBeUndefined();
    expect(jev.calls).toHaveLength(2);
    expect(text(events)).toContain("Entiendo: «¿cuánta coca-cola queda en el Vivero?»");
    expect(text(events)).toMatch(/Coca-Cola/);
  });

  it("pronombre resuelto con la conversación: responde el precio y dice cómo lo ha entendido", async () => {
    const jev = new FakeJev([DOUBT, { intent: "consultar", intent_alt: "leer", herramienta: "query_prices", local: "Vivero", producto_0: "Coca-Cola 20 cl" }]);
    const { agent } = makeAgent(jev, null, { assistant: assistant('{"tipo":"datos","consulta":"¿a cuánto compramos la coca-cola en el Vivero?"}') });
    const events = await run(agent, chat("¿y a cuánto la compramos en el Vivero?"));
    expect(clarify(events)).toBeUndefined();
    expect(text(events)).toMatch(/^Entiendo: «¿a cuánto compramos la coca-cola en el Vivero\?»\.\nCoca-Cola 20 cl · Caja 24 ud: 13,20 €/);
  });

  it("si la reescritura tampoco se entiende, sigue la aclaración de siempre", async () => {
    const jev = new FakeJev([DOUBT, DOUBT]);
    const { agent } = makeAgent(jev, null, { assistant: assistant('{"tipo":"datos","consulta":"¿lo de antes?"}') });
    const events = await run(agent, chat("eso de antes"));
    expect(clarify(events)).toBeDefined();
    expect(text(events)).not.toContain("Entiendo");
  });

  it("no acepta una reescritura que se inventa un local", async () => {
    const jev = new FakeJev([DOUBT, STOCK]);
    const { agent } = makeAgent(jev, null, { assistant: assistant('{"tipo":"datos","consulta":"¿cuánta coca-cola queda en el Vivero?"}') });
    const events = await run(agent, chat("cuánta queda"));
    expect(jev.calls).toHaveLength(1);
    expect(clarify(events)).toBeDefined();
  });

  it("pregunta general: respuesta corta marcada, sin aclaración", async () => {
    const jev = new FakeJev([DOUBT]);
    const { agent } = makeAgent(jev, null, { assistant: assistant('{"tipo":"general","respuesta":"Es usar primero lo que entró antes, para que nada caduque."}') });
    const events = await run(agent, chat("qué significa trabajar con FIFO en cocina"));
    expect(clarify(events)).toBeUndefined();
    expect(text(events)).toContain("lo que entró antes");
    expect(text(events)).toContain("no he consultado los datos");
  });

  it("sin IA, o si la IA falla, todo sigue igual que antes", async () => {
    const plain = makeAgent(new FakeJev([DOUBT]));
    expect(clarify(await run(plain.agent, chat("eso de antes")))).toBeDefined();
    const broken = new FakeProvider([["x"]]);
    broken.fail = true;
    const failing = makeAgent(new FakeJev([DOUBT]), null, { assistant: new Assistant(broken, new Metrics("0")) });
    expect(clarify(await run(failing.agent, chat("eso de antes")))).toBeDefined();
  });

  it("los saludos y la ayuda no pasan por la IA", async () => {
    const provider = new FakeProvider([['{"tipo":"otro"}']]);
    const { agent } = makeAgent(new FakeJev([{ intent: "conversar", intent_alt: "ninguno" }]), null, { assistant: new Assistant(provider, new Metrics("0")) });
    await run(agent, chat("qué sabes hacer"));
    expect(provider.prompts).toHaveLength(0);
  });
});

describe("lectura de la salida de la IA", () => {
  it("acepta JSON con texto alrededor y rechaza lo que no encaja", () => {
    expect(parseUnderstanding('Claro: {"tipo":"datos","consulta":"¿qué proveedor trae la tónica?"}')).toEqual({ tipo: "datos", consulta: "¿qué proveedor trae la tónica?" });
    expect(parseUnderstanding('{"tipo":"otro"}')).toEqual({ tipo: "otro" });
    expect(parseUnderstanding('{"tipo":"datos","consulta":""}')).toBeNull();
    expect(parseUnderstanding('{"tipo":"borrar todo"}')).toBeNull();
    expect(parseUnderstanding("no es json")).toBeNull();
  });
});
