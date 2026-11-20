// Fase 1 del plan de mejora: aclaraciones justas. No se pregunta lo que el mensaje ya dice tal cual, una
// respuesta escrita que casa con una de las opciones la elige y no se repite la misma pregunta.
import { describe, expect, it } from "vitest";
import type { WasteDraft } from "../contract/index";
import { chat, FakeJev, find, makeAgent, run } from "./helpers";

const BARCELO = "Ron Barceló Añejo 70 cl";
const BRUGAL = "Ron Brugal Añejo 70 cl";
const OK = { coherencia: 0.95 };

describe("nombre exacto del catálogo", () => {
  it("«ron barceló añejo» es Ron Barceló Añejo 70 cl aunque Jev reparta entre los rones", async () => {
    const jev = new FakeJev([{ intent: "proponer_accion", intent_alt: "cambiar", tipo_accion: "merma", local: "Parador", producto_0: { dist: { [BARCELO]: 0.4, [BRUGAL]: 0.3, varios: 0.3 } }, cantidad_ok_0: 0.97 }, OK]);
    const { agent } = makeAgent(jev);
    const events = await run(agent, chat("merma de 2 botellas de ron barceló añejo en el parador"));
    expect(find(events, "clarify")).toBeUndefined();
    expect(find(events, "draft") as WasteDraft).toMatchObject({ productName: BARCELO, qtyBase: "1400" });
  });

  it("si Jev pone otro producto concreto por delante, o lo escrito no es un nombre entero, se pregunta", async () => {
    const ahead = new FakeJev([{ intent: "proponer_accion", intent_alt: "cambiar", tipo_accion: "merma", local: "Parador", producto_0: { dist: { [BRUGAL]: 0.45, [BARCELO]: 0.4, varios: 0.15 } }, cantidad_ok_0: 0.97 }]);
    expect(find(await run(makeAgent(ahead).agent, chat("merma de 2 botellas de ron barceló añejo en el parador")), "clarify")).toBeDefined();
    const partial = new FakeJev([{ intent: "proponer_accion", intent_alt: "cambiar", tipo_accion: "merma", local: "Parador", producto_0: { dist: { [BARCELO]: 0.4, [BRUGAL]: 0.35, varios: 0.25 } }, cantidad_ok_0: 0.97 }]);
    expect(find(await run(makeAgent(partial).agent, chat("merma de 2 botellas de ron añejo en el parador")), "clarify")).toBeDefined();
  });
});

describe("respuesta escrita a «¿cuál de estos productos?»", () => {
  it("«¿y el barceló?» elige la opción que nombra, sin repetir la pregunta", async () => {
    const jev = new FakeJev([{ intent: "proponer_accion", intent_alt: "cambiar", tipo_accion: "merma", local: "Parador", producto_0: { dist: { varios: 0.7, [BARCELO]: 0.15, [BRUGAL]: 0.15 } }, cantidad_ok_0: 0.97 }, OK]);
    const { agent } = makeAgent(jev);
    const first = await run(agent, chat("merma de 2 botellas de ron en el parador"));
    const clarify = find(first, "clarify")!;
    expect(clarify.options.map((o) => o.label)).toEqual(expect.arrayContaining([BARCELO, BRUGAL]));
    const events = await run(agent, chat("¿y el barceló?", { clarification: { clarifyId: clarify.clarifyId, optionId: "otra", freeText: "¿y el barceló?" } }));
    expect(find(events, "clarify")).toBeUndefined();
    expect(find(events, "draft") as WasteDraft).toMatchObject({ productName: BARCELO, qtyBase: "1400" });
  });
});
