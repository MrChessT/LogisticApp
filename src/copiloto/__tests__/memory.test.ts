import { describe, expect, it } from "vitest";
import { LOCATIONS, PRODUCTS } from "../dev/fixture";
import { referencesPrevious } from "../entities/signals";
import { chat, FakeJev, find, makeAgent, run, type Script } from "./helpers";

const BARCELO = PRODUCTS[0]!;
const [PARADOR, , VIVERO] = LOCATIONS;
const stock = (extra: Script = {}): Script => ({ intent: "consultar", intent_alt: "leer", herramienta: "query_stock", ...extra });

describe("memoria de la conversación", () => {
  it("«¿y en el Vivero?» sigue con el mismo producto y lo dice", async () => {
    const jev = new FakeJev([stock({ local: "Parador", producto_0: BARCELO.name }), stock({ local: "Vivero", seguimiento: 0.82 })]);
    const { agent } = makeAgent(jev);
    await run(agent, chat("¿cuánto ron Barceló queda en Parador?"));
    const events = await run(agent, chat("¿y en el Vivero?"));

    expect(find(events, "decision")!.decisions).toEqual(expect.arrayContaining([expect.objectContaining({ id: "seguimiento", valueLabel: "Continúa lo anterior" })]));
    expect(find(events, "navigate")).toMatchObject({ route: "/stock", filters: { locationId: VIVERO!.id, productId: BARCELO.id } });
    // El titular ya nombra el producto heredado: sin «Sigo con…» delante.
    const text = find(events, "done")!.text;
    expect(text.startsWith(`No hay stock registrado de ${BARCELO.name} en Vivero.`)).toBe(true);
    // Y dónde sí hay, en vez de quedarse en «no hay».
    expect(text).toContain("Sí hay en Parador");
    // Jev recibe la conversación para resolver la referencia.
    expect((jev.calls[1]!.state as { recent_turns: unknown[] }).recent_turns).toHaveLength(2);
  });

  it("«¿y el Brugal?» cambia de producto pero se queda en el mismo local", async () => {
    const BRUGAL = PRODUCTS[1]!;
    const jev = new FakeJev([stock({ local: "Parador", producto_0: BARCELO.name }), stock({ producto_0: BRUGAL.name, seguimiento: 0.91 })]);
    const { agent } = makeAgent(jev);
    await run(agent, chat("¿cuánto ron Barceló queda en Parador?"));
    const events = await run(agent, chat("¿y el Brugal?"));
    expect(find(events, "navigate")).toMatchObject({ filters: { locationId: PARADOR!.id, productId: BRUGAL.id } });
    expect(find(events, "done")!.text).toBe("Stock de Ron Brugal Añejo 70 cl en Parador: 7 botellas.");
  });

  it("una pregunta nueva no hereda nada aunque venga justo después", async () => {
    const jev = new FakeJev([stock({ local: "Parador", producto_0: BARCELO.name }), stock({ seguimiento: 0.5 })]);
    const { agent } = makeAgent(jev);
    await run(agent, chat("¿cuánto ron Barceló queda en Parador?"));
    const events = await run(agent, chat("¿cuánto stock hay?"));
    expect(find(events, "decision")!.decisions.map((d) => d.id)).not.toContain("seguimiento");
    expect(find(events, "done")!.text).not.toContain("Sigo con");
    expect(find(events, "navigate")!.filters.productId).toBeUndefined();
  });

  it("«¿y en el Parador?» tras «¿qué tengo que pedir?» repite la misma consulta, aunque Jev lea «stock»", async () => {
    const reorder: Script = { intent: "pedir_sugerencias", intent_alt: "leer", herramienta: "query_reorder", periodo: "fin_de_semana" };
    const jev = new FakeJev([reorder, {}, stock({ local: "Parador", seguimiento: 0.86 }), {}]);
    const { agent } = makeAgent(jev);
    await run(agent, chat("¿qué tengo que pedir para el fin de semana?"));
    const events = await run(agent, chat("¿y en el Parador?"));
    const text = find(events, "done")!.text;
    expect(text).toMatch(/^(Para el fin de semana conviene reponer|No falta nada en Parador para el fin de semana)/);
    expect(text).not.toMatch(/\((Vivero|Pickels|La Oliva)\)/);
  });

  it("«¿y cuánto hay en el Parador?» sí es otra consulta", async () => {
    const reorder: Script = { intent: "pedir_sugerencias", intent_alt: "leer", herramienta: "query_reorder", periodo: "fin_de_semana" };
    const jev = new FakeJev([reorder, {}, stock({ local: "Parador", seguimiento: 0.86 }), {}]);
    const { agent } = makeAgent(jev);
    await run(agent, chat("¿qué tengo que pedir para el fin de semana?"));
    const events = await run(agent, chat("¿y cuánto hay en el Parador?"));
    expect(find(events, "done")!.text).toMatch(/^Stock/);
  });

  it("Jev a medias (0,70): una pregunta completa no hereda el producto; «¿y en el Vivero?» sí", async () => {
    const jev = new FakeJev([stock({ local: "Parador", producto_0: BARCELO.name }), stock({ seguimiento: 0.7 })]);
    const { agent } = makeAgent(jev);
    await run(agent, chat("¿cuánto ron Barceló queda en Parador?"));
    const fresh = await run(agent, chat("¿cuánto stock hay?"));
    expect(find(fresh, "navigate")!.filters.productId).toBeUndefined();

    const jev2 = new FakeJev([stock({ local: "Parador", producto_0: BARCELO.name }), stock({ local: "Vivero", seguimiento: 0.6 })]);
    const second = makeAgent(jev2).agent;
    await run(second, chat("¿cuánto ron Barceló queda en Parador?"));
    expect(find(await run(second, chat("¿y en el Vivero?")), "navigate")).toMatchObject({ filters: { locationId: VIVERO!.id, productId: BARCELO.id } });
  });

  it("marcas de continuación", () => {
    expect(["¿y en el Parador?", "¿cuánto queda de eso en Pickels?", "pon lo mismo en el Vivero", "¿ahí cuánto hay?"].every(referencesPrevious)).toBe(true);
    expect(["¿qué tengo que pedir para el fin de semana?", "¿cuánto stock hay en el Parador?", "¿qué es lo que más se consume?", "¿hay traspasos pendientes?"].some(referencesPrevious)).toBe(false);
  });
});
