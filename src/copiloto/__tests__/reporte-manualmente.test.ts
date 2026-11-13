// Reporte de opinión (13/11/2026, /ventas): «Preparar una operación» acabó preguntando si crear «Manualmente»
// como producto. Una frase genérica no es un nombre ni una orden de alta: se pregunta qué operación.
import { describe, expect, it } from "vitest";
import { chat, FakeJev, find, makeAgent, run, type Script } from "./helpers";
import { hasNewProductTrigger, isGenericName } from "../entities/catalog-parser";
import { CANCEL_OPTION } from "../agent/free-text";

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

describe("sin bucles", () => {
  it("la misma frase genérica otra vez no repite la pregunta igual: ofrece «Déjalo»", async () => {
    const { agent } = makeAgent(new FakeJev([route("nuevo_producto"), route("nuevo_producto")]));
    const first = find(await run(agent, chat("Preparar una operación")), "clarify")!;
    const second = find(await run(agent, chat("Preparar una operación")), "clarify")!;
    expect(second.question).not.toBe(first.question);
    expect(second.options.map((o) => o.id)).toContain(CANCEL_OPTION);
  });

  it("una alta real sigue creando su borrador (no cae en la pregunta de operación)", async () => {
    const { agent } = makeAgent(new FakeJev([route("nuevo_producto"), { coherencia: 0.95, tiene_sentido: 0.97, categoria: "Refrescos", medida: "count" }]));
    const events = await run(agent, chat("crea un producto Fanta Limón 33 cl"));
    expect(find(events, "clarify")?.field).not.toBe("tipo_accion");
  });
});

describe("transparencia", () => {
  it("la operación que Jev propuso y no se usó no aparece en «Entendido»", async () => {
    const { agent } = makeAgent(new FakeJev([route("nuevo_producto")]));
    const events = await run(agent, chat("Preparar una operación"));
    expect(find(events, "clarify")?.field).toBe("tipo_accion");
    expect(JSON.stringify(find(events, "decision") ?? {})).not.toContain("nuevo_producto");
  });
});

describe("petición genérica con cualquier operación de Jev", () => {
  it("«Preparar una operación» no se convierte en un pedido aunque Jev lo proponga", async () => {
    const { agent } = makeAgent(new FakeJev([{ intent: "proponer_accion", intent_alt: "cambiar", tipo_accion: "preparar_pedido" }]));
    const events = await run(agent, chat("Preparar una operación", { page: "/ventas" }));
    expect(find(events, "clarify")?.field).toBe("tipo_accion");
    expect(find(events, "clarify")?.question).toBe("¿Qué operación quieres registrar?");
  });
});
