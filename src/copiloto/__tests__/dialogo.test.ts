// Fase 1 del plan de mejora: un diálogo que avanza. Lo que se escribe después de un formulario completa la
// operación, el borrador se corrige hablando y no se pregunta lo que ya está claro.
import { describe, expect, it } from "vitest";
import type { TransferDraft, WasteDraft } from "../contract/index";
import { chat, FakeJev, find, makeAgent, run } from "./helpers";

const BARCELO = "Ron Barceló Añejo 70 cl";

describe("operación a medias: lo escrito rellena el formulario", () => {
  it("«registra una merma» → «barcelo» → «2 botellas» → «en el parador»: borrador, sin volver a empezar", async () => {
    const jev = new FakeJev([{}, { producto_0: BARCELO }, { producto_0: BARCELO, cantidad_ok_0: 0.95 }, { producto_0: BARCELO, cantidad_ok_0: 0.95, local: "Parador" }, { coherencia: 0.95 }]);
    const { agent } = makeAgent(jev);

    const first = await run(agent, chat("registra una merma"));
    expect(find(first, "form")).toBeDefined();

    const second = await run(agent, chat("barcelo"));
    expect(find(second, "done")!.text).toMatch(/^Llevo apuntado: merma de barcelo\. Me falta saber en qué local y cuánto/);

    // Ya solo falta un dato: una pregunta es más rápida que el formulario.
    const third = await run(agent, chat("2 botellas"));
    expect(find(third, "clarify")).toMatchObject({ field: "local" });

    const fourth = await run(agent, chat("en el parador"));
    const draft = find(fourth, "draft") as WasteDraft;
    expect(draft).toMatchObject({ kind: "merma", locationName: "Parador", productName: BARCELO, qtyBase: "1400" });
  });

  it("una pregunta en medio no se pega a la merma: se contesta y la merma se olvida", async () => {
    const jev = new FakeJev([{}, { intent: "consultar", intent_alt: "leer", herramienta: "query_stock", local: "Parador", producto_0: BARCELO }]);
    const { agent, sessions } = makeAgent(jev);
    await run(agent, chat("registra una merma"));
    const answer = await run(agent, chat("¿cuánto ron Barceló queda en Parador?"));
    expect(find(answer, "form")).toBeUndefined();
    expect(find(answer, "done")!.text).toContain("3 botellas");
    const session = await sessions.get("5b1a3f4e-9c2d-4e8f-a1b2-c3d4e5f6a7b8", "11111111-0000-4000-8000-000000000001");
    expect(session.task).toBeUndefined();
  });

  it("«olvídalo» con el formulario abierto lo deja", async () => {
    const { agent } = makeAgent(new FakeJev([{}]));
    await run(agent, chat("quiero hacer un traspaso"));
    expect(find(await run(agent, chat("olvídalo")), "done")!.text).toBe("Vale, lo dejo. Dime si necesitas otra cosa.");
  });
});

describe("corregir el borrador pendiente hablando", () => {
  const MERMA = { intent: "proponer_accion", intent_alt: "cambiar", tipo_accion: "merma", local: "Parador", producto_0: BARCELO, cantidad_ok_0: 0.97 };
  const OK = { coherencia: 0.95 };

  it("«mejor que sean 4»: el mismo borrador con 4 botellas; el anterior queda descartado", async () => {
    const jev = new FakeJev([MERMA, OK, OK]);
    const { agent, drafts } = makeAgent(jev);
    const first = find(await run(agent, chat("merma de 2 botellas de ron barceló en el parador")), "draft") as WasteDraft;
    expect(first.qtyBase).toBe("1400");

    const events = await run(agent, chat("mejor que sean 4"));
    const second = find(events, "draft") as WasteDraft;
    expect(second).toMatchObject({ kind: "merma", productName: BARCELO, locationName: "Parador", qtyBase: "2800" });
    expect(find(events, "form")).toBeUndefined();
    expect(find(events, "done")!.text).toMatch(/^Corregido: Merma: 4 .* El anterior queda descartado\./);
    expect(find(events, "resolved")).toEqual({ draftId: first.draftId, status: "descartado", message: "Sustituido por el borrador corregido." });
    // La tarjeta antigua ya no se puede confirmar.
    expect(await drafts.claim(first.draftId)).toBe(false);
    // Jev comprueba el borrador nuevo contra la petición y la corrección.
    expect(JSON.stringify(jev.calls.at(-1)!.state)).toContain("y después lo corrigió: «mejor que sean 4»");
  });

  it("«cámbialo a Vivero» y «era por caducidad» cambian solo eso", async () => {
    const { agent } = makeAgent(new FakeJev([MERMA, OK, OK, OK, OK]));
    await run(agent, chat("merma de 2 botellas de ron barceló en el parador"));
    const moved = find(await run(agent, chat("cámbialo a Vivero")), "draft") as WasteDraft;
    expect(moved).toMatchObject({ locationName: "Vivero", qtyBase: "1400", productName: BARCELO });
    const why = find(await run(agent, chat("era por caducidad")), "draft") as WasteDraft;
    expect(why).toMatchObject({ locationName: "Vivero", qtyBase: "1400", reason: "caducidad" });
    const broken = find(await run(agent, chat("y apúntalo como rotura")), "draft") as WasteDraft;
    expect(broken).toMatchObject({ locationName: "Vivero", reason: "rotura" });
  });

  it("traspaso: «no, al Vivero» cambia el destino; «que sean 3 cajas» la cantidad en cajas", async () => {
    const TRASPASO = { intent: "proponer_accion", intent_alt: "cambiar", tipo_accion: "traspaso", local: "Parador", local_destino: "Pickels", producto_0: "Coca-Cola 20 cl", cantidad_ok_0: 0.97 };
    const { agent } = makeAgent(new FakeJev([TRASPASO, OK, OK, OK]));
    const first = find(await run(agent, chat("pasa 2 cajas de coca cola del parador al pickels")), "draft") as TransferDraft;
    expect(first.lines[0]!.qtyBase).toBe("48");
    const moved = find(await run(agent, chat("no, al Vivero")), "draft") as TransferDraft;
    expect(moved).toMatchObject({ fromLocationName: "Parador", toLocationName: "Vivero" });
    expect(moved.lines[0]!.qtyBase).toBe("48");
    const more = find(await run(agent, chat("que sean 3 cajas")), "draft") as TransferDraft;
    expect(more.lines[0]!.qtyBase).toBe("72");
    expect(more.toLocationName).toBe("Vivero");
  });

  it("«quita la de tónica» en un traspaso de dos líneas: queda solo la otra, igual que estaba", async () => {
    const TWO = { intent: "proponer_accion", intent_alt: "cambiar", tipo_accion: "traspaso", local: "Parador", local_destino: "Vivero", producto_0: "Coca-Cola 20 cl", cantidad_ok_0: 0.97, producto_1: "Tónica Schweppes 20 cl", cantidad_ok_1: 0.97 };
    const { agent } = makeAgent(new FakeJev([TWO, OK, OK]));
    const first = find(await run(agent, chat("pasa 2 cajas de coca cola y 1 caja de tonica del parador al vivero")), "draft") as TransferDraft;
    expect(first.lines.map((l) => l.productName)).toEqual(["Coca-Cola 20 cl", "Tónica Schweppes 20 cl"]);
    const events = await run(agent, chat("quita la de tonica"));
    const second = find(events, "draft") as TransferDraft;
    expect(second.lines.map((l) => [l.productName, l.qtyBase])).toEqual([["Coca-Cola 20 cl", "48"]]);
    expect(find(events, "resolved")).toMatchObject({ draftId: first.draftId, status: "descartado" });
  });

  it("«olvídalo» con un borrador esperando lo descarta, y lo siguiente ya no se lee como respuesta a él", async () => {
    const { agent } = makeAgent(new FakeJev([MERMA, OK]));
    const first = find(await run(agent, chat("merma de 2 botellas de ron barceló en el parador")), "draft") as WasteDraft;
    const events = await run(agent, chat("olvídalo"));
    expect(find(events, "resolved")).toMatchObject({ draftId: first.draftId, status: "descartado" });
    expect(find(await run(agent, chat("que productos no tienen precio")), "done")!.text).toMatch(/sin precio/);
  });

  it("no es corrección: una orden nueva, una pregunta o un «sí» siguen su camino", async () => {
    const { agent } = makeAgent(new FakeJev([MERMA, OK, { intent: "consultar", intent_alt: "leer", herramienta: "query_stock", local: "Parador", producto_0: BARCELO }]));
    await run(agent, chat("merma de 2 botellas de ron barceló en el parador"));
    const answer = await run(agent, chat("¿cuánto ron barceló queda en el parador?"));
    expect(find(answer, "draft")).toBeUndefined();
    expect(find(answer, "resolved")).toBeUndefined();
  });
});
