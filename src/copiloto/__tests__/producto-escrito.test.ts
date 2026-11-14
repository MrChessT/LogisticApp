// Reporte de /productos (13/11/2026): «quiero archivar un producto» → «¿Qué producto quieres archivar?» y la
// respuesta escrita no llegaba a ninguna acción (la conversación se quedaba dando vueltas). Ahora el nombre
// escrito se busca en el catálogo y se prepara el borrador.
import { describe, expect, it } from "vitest";
import { chat, FakeJev, find, makeAgent, run, type Script } from "./helpers";

const archive: Script = { intent: "proponer_accion", intent_alt: "cambiar", tipo_accion: "archivar_producto" };

describe("respuesta escrita a «¿qué producto?»", () => {
  it("el nombre escrito se convierte en el producto del borrador", async () => {
    const setup = makeAgent(new FakeJev([archive, { coherencia: 0.95 }]));
    const ask = find(await run(setup.agent, chat("quiero archivar un producto")), "clarify")!;
    expect(ask.field).toBe("producto");
    const events = await run(setup.agent, chat("Coca-Cola 20 cl", { clarification: { clarifyId: ask.clarifyId, optionId: "otra", freeText: "Coca-Cola 20 cl", field: ask.field } }));
    expect(find(events, "clarify")).toBeUndefined();
    expect((find(events, "draft") as { title: string } | undefined)?.title).toBe("Archivar Coca-Cola 20 cl");
  });
});

describe("varios productos encajan con lo escrito", () => {
  const archive2: Script = { intent: "proponer_accion", intent_alt: "cambiar", tipo_accion: "archivar_producto" };

  it("se pregunta cuál, y la elección lleva al borrador de ese producto", async () => {
    const setup = makeAgent(new FakeJev([archive2, archive2, archive2]));
    const ask = find(await run(setup.agent, chat("quiero archivar un producto")), "clarify")!;
    const choose = await run(setup.agent, chat("Ron Añejo 70 cl", { clarification: { clarifyId: ask.clarifyId, optionId: "otra", freeText: "Ron Añejo 70 cl", field: ask.field } }));
    const again = find(choose, "clarify");
    expect(again?.field).toBe("producto");
    expect(again?.options.map((o) => o.label)).toEqual(expect.arrayContaining(["Ron Barceló Añejo 70 cl", "Ron Brugal Añejo 70 cl"]));
    const brugal = again!.options.find((o) => o.label === "Ron Brugal Añejo 70 cl")!;
    const done = await run(setup.agent, chat("Ron Brugal Añejo 70 cl", { clarification: { clarifyId: again!.clarifyId, optionId: brugal.id, freeText: undefined, field: "producto" } }));
    expect(find(done, "clarify")).toBeUndefined();
    expect((find(done, "draft") as { title: string } | undefined)?.title).toBe("Archivar Ron Brugal Añejo 70 cl");
  });
});
