// Casos de las opiniones del asistente exportadas el 12/11/2026 (/opiniones): «hace preguntas de más» y
// «se queda colgado en vez de llevarte a la pantalla». Cada fallo queda aquí para que no vuelva.
import { describe, expect, it } from "vitest";
import { bareAnswer, consumptionByHand, screenHelp } from "../agent/topics";
import { chat, FakeJev, find, makeAgent, run } from "./helpers";

describe("ir a una pantalla", () => {
  it("«llévame a los informes de mermas de este mes» abre Informes en la vista Mermas, 30 días", () => {
    const reply = screenHelp("Llévame a los informes de mermas de este mes.")!;
    expect(reply).toMatchObject({ route: "/informes", go: true, filters: { view: "mermas", days: 30 } });
    expect(reply.text).toBe("Te llevo a Gestión › Informes, vista Mermas (últimos 30 días).");
  });

  it("«llévame a pedidos» abre la pantalla; «¿dónde están las facturas?» solo dice dónde", () => {
    expect(screenHelp("llévame a pedidos")).toMatchObject({ route: "/pedidos", go: true });
    const where = screenHelp("¿dónde están las facturas?")!;
    expect(where.go).toBeUndefined();
    expect(where.text).toContain("Lo tienes en el menú: Gestión › Facturas");
  });

  it("el panel recibe la orden de abrirla (navigate con auto)", async () => {
    const { agent } = makeAgent(new FakeJev());
    const events = await run(agent, chat("Llévame a los informes de mermas de este mes."));
    expect(find(events, "navigate")).toEqual({ route: "/informes", filters: { view: "mermas", days: 30 }, auto: true });
    expect(find(events, "clarify")).toBeUndefined();
  });
});

describe("«sí» o «no» sueltos sin nada pendiente", () => {
  it("no pregunta «¿Qué quieres hacer?»", async () => {
    const { agent } = makeAgent(new FakeJev());
    const events = await run(agent, chat("si"));
    expect(find(events, "clarify")).toBeUndefined();
    expect(find(events, "done")!.text).toContain("No tengo nada pendiente de confirmar");
  });

  it("tras dejar un enlace, explica cómo abrirlo; «no» cierra sin más", () => {
    expect(bareAnswer("sí", "Lo tienes en el menú: Gestión › Facturas. Te dejo el enlace.")!.text).toContain("Pulsa el enlace");
    expect(bareAnswer("no", undefined)!.text).toBe("Vale. Aquí estoy si necesitas otra cosa.");
    expect(bareAnswer("sí, 3 botellas", undefined)).toBeNull();
  });
});

describe("consumo dicho a mano", () => {
  it("explica que sale de los recuentos y ofrece registrarlo como merma con lo dicho", () => {
    const reply = consumptionByHand("se ha consumido los siguientes productos: 10 cajas de cocacola y 3 fantas de naranja")!;
    expect(reply.text).toContain("sale de los recuentos");
    expect(reply.actions).toEqual([{ label: "Registrar como merma", say: "merma de 10 cajas de cocacola y 3 fantas de naranja" }]);
  });

  it("el botón envía la frase como si se hubiera escrito (pasa por Jev)", async () => {
    const jev = new FakeJev();
    const { agent } = makeAgent(jev);
    const events = await run(agent, chat("se han consumido 2 botellas de barceló en el Parador"));
    const button = find(events, "actions")!.actions[0]!;
    expect(button.label).toBe("Registrar como merma");
    await run(agent, chat("Registrar como merma", { followUpId: button.id }));
    expect((jev.calls[0]!.state as { message: string }).message).toBe("merma de 2 botellas de barceló en el Parador");
  });
});

describe("datos de la ficha sin elegir producto", () => {
  it("«¿qué categoría tiene el ron?» contesta de todos los que encajan", async () => {
    const { agent } = makeAgent(new FakeJev());
    const events = await run(agent, chat("que categoría tiene el ron"));
    expect(find(events, "clarify")).toBeUndefined();
    expect(find(events, "done")!.text).toBe("Los 2 (Ron Barceló Añejo 70 cl, Ron Brugal Añejo 70 cl) están en Destilados.");
  });

  it("un solo producto: su categoría", async () => {
    const { agent } = makeAgent(new FakeJev());
    expect(find(await run(agent, chat("¿de qué categoría es la coca cola?")), "done")!.text).toBe("Coca-Cola 20 cl está en Refrescos.");
  });
});

describe("equipo", () => {
  it("«dame los nombres del personal» los dice en el texto", async () => {
    const { agent } = makeAgent(new FakeJev());
    const text = find(await run(agent, chat("dame los nombres dle personal")), "done")!.text;
    expect(text).toContain("Ana Propietaria (propiedad), Luis Encargado (encargado/a), Marta Camarera (personal, invitado).");
  });
});
