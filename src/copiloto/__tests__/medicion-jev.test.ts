// Fallos encontrados midiendo con Jev REAL (npm run copiloto:eval y copiloto:conversaciones -- --real).
// Cada caso queda aquí con Jev simulado para que no vuelva a pasar.
import { describe, expect, it } from "vitest";
import { unexplainedWords } from "../entities/mentions";
import { isUnitWord } from "../entities/quantity-parser";
import { chat, FakeJev, find, makeAgent, run, type Script } from "./helpers";

const route = (tipo: string, extra: Script = {}): Script => ({ intent: "proponer_accion", intent_alt: "cambiar", tipo_accion: tipo, ...extra });

describe("medición con Jev real (2026-10-16)", () => {
  it("la comprobación del borrador incluye lo respondido a las preguntas (no avisa de «revisa los datos» por ello)", async () => {
    const jev = new FakeJev([route("merma", { producto_0: { winner: "Ron Barceló Añejo 70 cl", p: 0.97 }, cantidad_ok_0: 0.95 }), { coherencia: 0.95 }]);
    const { agent } = makeAgent(jev);
    const ask = find(await run(agent, chat("merma de 2 botellas de barceló")), "clarify")!;
    expect(ask.field).toBe("local");

    const events = await run(agent, chat("Parador", { clarification: { clarifyId: ask.clarifyId, optionId: "Parador" } }));
    expect(find(events, "draft")).toBeDefined();
    const request = (jev.calls[1]!.state as { request: string }).request;
    expect(request).toContain("merma de 2 botellas de barceló");
    expect(request).toContain("local: Parador");
  });

  it("palabras de estado y erratas de la unidad no hacen dudar del producto; un nombre distinto sí", () => {
    const ignore = (w: string) => isUnitWord(w);
    expect(unexplainedWords("limones pochos", { name: "Limón" }, ignore)).toEqual([]);
    expect(unexplainedWords("barceló contadas", { name: "Ron Barceló Añejo 70 cl" }, ignore)).toEqual([]);
    expect(unexplainedWords("votellas de tanqueray", { name: "Tanqueray" }, ignore)).toEqual([]);
    expect(unexplainedWords("prubea luis", { name: "Luis Latour" }, ignore)).toEqual(["prubea"]);
    expect(unexplainedWords("helado de vainilla", { name: "Sirope Vainilla" }, ignore)).toEqual(["helado"]);
  });

  it("reconoce unidades con una letra cambiada, pero no nombres", () => {
    expect(isUnitWord("botellas")).toBe(true);
    expect(isUnitWord("votellas")).toBe(true);
    expect(isUnitWord("kajas")).toBe(true);
    expect(isUnitWord("tanquerai")).toBe(false);
    expect(isUnitWord("larios")).toBe(false);
  });
});
