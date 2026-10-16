// Casos reales de «Opiniones del asistente»: cada reporte aceptado se reproduce aquí y queda como prueba
// para que no vuelva a pasar. Las conversaciones son las del reporte, con Jev simulado.
import { describe, expect, it } from "vitest";
import type { NewProductDraft } from "../contract/index";
import { operationOf, operationOnly } from "../agent/free-text";
import { extractNewProductName } from "../entities/catalog-parser";
import { chat, FakeJev, find, makeAgent, run, type Script } from "./helpers";

const route = (tipo: string, extra: Script = {}): Script => ({ intent: "proponer_accion", intent_alt: "cambiar", tipo_accion: tipo, ...extra });
const NEW_OK: Script = { coherencia: 0.95, tiene_sentido: 0.97, categoria: "Destilados", medida: "count", precio_plausible: 0.9 };
// Lo que Jev contestó al «Prueba Luis» suelto: no sabe qué se pide.
const LOST: Script = { intent: "conversar", intent_alt: "leer" };

describe("opinión 2026-10-15 (Luis): alta de producto y cambio de operación", () => {
  it("el nombre escrito tras «¿Cómo se llama el producto nuevo?» es el nombre (no un mensaje nuevo)", async () => {
    const jev = new FakeJev([route("nuevo_producto"), NEW_OK]);
    const { agent } = makeAgent(jev);
    const ask = find(await run(agent, chat("crear producto")), "clarify")!;
    expect(ask.question).toContain("¿Cómo se llama el producto nuevo?");

    const events = await run(agent, chat("Prueba Luis", { clarification: { clarifyId: ask.clarifyId, optionId: "otra", freeText: "Prueba Luis" } }));
    const draft = find(events, "draft") as NewProductDraft | undefined;
    expect(find(events, "clarify")?.question).toBeUndefined();
    expect(draft).toMatchObject({ kind: "producto_nuevo", name: "Prueba Luis" });
    // Sin volver a preguntar a Jev qué se quiere hacer: solo la revisión del borrador.
    expect(jev.calls).toHaveLength(2);
  });

  it("«registrar merma» seguido de «crear producto nuevo»: no crea un producto llamado «Merma»", async () => {
    const jev = new FakeJev([route("merma"), route("nuevo_producto")]);
    const { agent } = makeAgent(jev);
    const local = find(await run(agent, chat("registrar merma")), "clarify")!;
    expect(local.field).toBe("local");
    const product = find(await run(agent, chat("Parador", { clarification: { clarifyId: local.clarifyId, optionId: "Parador" } })), "clarify")!;
    expect(product.question).toBe("¿Qué producto y qué cantidad?");

    // Cambia de operación a mitad: es una orden nueva, no un dato para la merma.
    const events = await run(agent, chat("crear producto nuevo", { clarification: { clarifyId: product.clarifyId, optionId: "otra", freeText: "crear producto nuevo" } }));
    const ask = find(events, "clarify")!;
    expect(ask.question).toContain("¿Cómo se llama el producto nuevo?");
    // Jev recibe solo la orden nueva (la merma queda como contexto de la conversación, no como parte de ella).
    expect((jev.calls[1]!.state as { message: string }).message).toBe("crear producto nuevo");
  });

  it("el nombre de un alta nunca es otra operación («registrar merma» no da «Merma»)", () => {
    expect(extractNewProductName("registrar merma")).toBeNull();
    expect(extractNewProductName("registrar merma. crear producto nuevo")).toBeNull();
    expect(extractNewProductName("registrar merma y crear Coca Zero")).toBe("Coca Zero");
    expect(extractNewProductName("registra Ginebra Nordés 70 cl")).toBe("Ginebra Nordés 70 cl");
  });

  it("reconoce qué operación se nombra y cuándo el mensaje es solo eso", () => {
    expect(operationOnly("merma")).toBe("merma");
    expect(operationOnly("registrar merma")).toBe("merma");
    expect(operationOnly("quiero hacer un traspaso")).toBe("traspaso");
    expect(operationOnly("crear producto nuevo")).toBe("nuevo_producto");
    expect(operationOnly("pedidos")).toBeNull();
    expect(operationOnly("haz el pedido")).toBe("preparar_pedido");
    expect(operationOnly("merma de 2 botellas de larios en el vivero")).toBeNull();
    expect(operationOf("registrar producto")).toBe("nuevo_producto");
    expect(operationOf("Prueba Luis")).toBeNull();
  });

  it("«merma» a secas empieza una merma (no la presentación del asistente)", async () => {
    const jev = new FakeJev([LOST]);
    const { agent } = makeAgent(jev);
    const events = await run(agent, chat("merma"));
    const ask = find(events, "clarify");
    expect(ask?.field).toBe("local");
    expect(find(events, "decision")!.intent.value).toBe("proponer_accion");
  });

  it("«Prueba Barceló, 2ud» en una merma: no da por bueno el Barceló (sobra «Prueba») y no pierde las 2 ud", async () => {
    const jev = new FakeJev([route("merma", { local: "Parador", producto_0: { winner: "Ron Barceló Añejo 70 cl", p: 0.97 }, cantidad_ok_0: 0.95 })]);
    const { agent } = makeAgent(jev);
    const events = await run(agent, chat("merma en Parador: Prueba Barceló, 2ud"));
    const ask = find(events, "clarify")!;
    expect(ask.field).toBe("producto");
    expect(ask.question).toContain("No encuentro «Prueba Barceló» tal cual");
    expect(find(events, "draft")).toBeUndefined();
    // El fragmento lleva su cantidad: lo que se pregunta es el producto, no «¿qué cantidad?».
    expect((jev.calls[0]!.state as { segments: Array<{ amount: string | null }> }).segments[0]!.amount).toBe("2");
  });

  it("si el nombre dicho encaja con el producto, sigue sin preguntar", async () => {
    const jev = new FakeJev([route("merma", { local: "Parador", producto_0: { winner: "Ron Barceló Añejo 70 cl", p: 0.97 }, cantidad_ok_0: 0.95 }), { coherencia: 0.95 }]);
    const { agent } = makeAgent(jev);
    const events = await run(agent, chat("merma en Parador: Barceló añejo, 2 botellas"));
    expect(find(events, "draft")?.kind).toBe("merma");
  });

  it("si vuelve a hacer la misma pregunta, ofrece la pantalla en vez de seguir en bucle", async () => {
    const jev = new FakeJev([route("nuevo_producto"), route("nuevo_producto")]);
    const { agent } = makeAgent(jev);
    await run(agent, chat("crear producto"));
    const again = await run(agent, chat("crear producto"));
    expect(find(again, "done")!.text + (find(again, "clarify")?.question ?? "")).toMatch(/Productos/);
    expect(find(again, "navigate")?.route).toBe("/productos");
  });
});
