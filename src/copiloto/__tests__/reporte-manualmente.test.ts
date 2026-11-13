// Reporte de opinión (13/11/2026, /ventas): «Preparar una operación» acabó preguntando si crear «Manualmente»
// como producto. Una frase genérica no es un nombre ni una orden de alta: se pregunta qué operación.
import { describe, expect, it } from "vitest";
import { chat, FakeJev, find, makeAgent, run, type Script } from "./helpers";
import { hasNewProductTrigger, isGenericName } from "../entities/catalog-parser";

/** Jev entiende una petición de operación y elige un tipo concreto (lo que hizo con la frase del reporte). */
const route = (tipo: string): Script => ({ intent: "proponer_accion", intent_alt: "cambiar", tipo_accion: tipo });

describe("«Preparar una operación» no es un producto nuevo", () => {
  it("si Jev propone alta de producto sin ninguna palabra de alta, se pregunta la operación", async () => {
    const { agent } = makeAgent(new FakeJev([route("nuevo_producto")]));
    const events = await run(agent, chat("Preparar una operación", { page: "/ventas" }));
    expect(find(events, "draft")).toBeUndefined();
    const ask = find(events, "clarify");
    expect(ask?.field).not.toBe("sentido");
    expect(ask?.field).not.toBe("nombre");
  });

  it("una respuesta escrita a «¿Cómo se llama el producto?» que es una frase genérica no se toma como nombre", async () => {
    const { agent } = makeAgent(new FakeJev([route("nuevo_producto")]));
    const ask = find(await run(agent, chat("crea un nuevo producto")), "clarify")!;
    expect(ask.field).toBe("nombre");
    const events = await run(agent, chat("Preparar una operación", { clarification: { clarifyId: ask.clarifyId, optionId: "otra", freeText: "Preparar una operación", field: "nombre" } }));
    expect(find(events, "draft")).toBeUndefined();
    expect((find(events, "draft") as { name?: string } | undefined)?.name).toBeUndefined();
  });

  it("un nombre genérico («manualmente») no se crea: se vuelve a pedir el nombre real", async () => {
    const { agent } = makeAgent(new FakeJev([route("nuevo_producto")]));
    const events = await run(agent, chat("da de alta manualmente"));
    expect(find(events, "draft")).toBeUndefined();
    expect(find(events, "clarify")?.field).toBe("nombre");
  });
});

describe("criterios de nombre y de alta", () => {
  it.each(["Manualmente", "manualmente", "Preparar una operación", "Operación", "algo"])("«%s» no es un nombre de producto", (name) => {
    expect(isGenericName(name)).toBe(true);
  });

  it.each(["Coca Cola Zero", "Vino de la casa", "Fanta Limón 33 cl"])("«%s» sí puede ser un nombre", (name) => {
    expect(isGenericName(name)).toBe(false);
  });

  it.each(["crea un producto", "da de alta la tónica", "anade una cerveza", "nuevo producto"])("«%s» dice un alta", (text) => {
    expect(hasNewProductTrigger(text)).toBe(true);
  });

  it.each(["Preparar una operación", "saca dos cajas de coca", "quiero hacer algo"])("«%s» no dice un alta", (text) => {
    expect(hasNewProductTrigger(text)).toBe(false);
  });
});
