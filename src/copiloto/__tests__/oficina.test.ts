// Lo que se hace en Almacén y Facturas, también desde el chat: ver la cola de salidas sin validar,
// validarlas y marcar una factura como pagada. Siempre con borrador y confirmación.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DocumentDraft } from "../contract/index";
import { ORG_ID, fixtureContext } from "../dev/fixture";
import { officeAction } from "../agent/office-actions";
import { chat, FakeJev, find, makeAgent, NOW, run } from "./helpers";

const confirm = (setup: ReturnType<typeof makeAgent>, draftId: string) =>
  setup.confirmService.confirm({ orgId: ORG_ID, draftId, idempotencyKey: randomUUID() }, fixtureContext(), setup.writer);

describe("reconocer la orden (no la pregunta)", () => {
  const ctx = fixtureContext();
  it.each([
    ["marca como pagada la factura de Makro", "pagar_factura"],
    ["paga la factura MK-1001", "pagar_factura"],
    ["la factura de makro ya está pagada", "pagar_factura"],
    ["valida las salidas del almacén del Parador", "validar_salidas"],
    ["aprueba los movimientos pendientes", "validar_salidas"],
  ])("«%s» → %s", (message, accion) => {
    expect(officeAction(message, ctx)?.accion).toBe(accion);
  });

  it.each(["confirma los pedidos pendientes", "acepta el traspaso del Parador", "¿qué facturas hay por pagar?", "¿está pagada la factura de Makro?", "facturas pendientes de pagar", "¿hay salidas sin validar?", "cuántos movimientos pendientes hay en el almacén"])("«%s» es una pregunta", (message) => {
    expect(officeAction(message, ctx)).toBeNull();
  });

  it("el local nombrado acota", () => {
    expect(officeAction("valida las salidas del Vivero", ctx)?.locationIds).toEqual([ctx.locations.find((l) => l.name === "Vivero")!.id]);
  });
});

describe("salidas de almacén", () => {
  it("la cola: cuántas, la más antigua y un botón para validarlas", async () => {
    const { agent } = makeAgent(new FakeJev());
    const events = await run(agent, chat("¿hay salidas pendientes de validar en el almacén?"));
    expect(find(events, "done")!.text).toBe("2 movimientos de almacén pendientes de validar. El más antiguo, hace 3 h. Hasta validarlos el stock no se mueve.");
    expect(find(events, "table")!.rows[0]).toMatchObject({ producto: "Coca-Cola 20 cl", cantidad: "2 cajas", ruta: "Almacén → Barra 1", quien: "Luis Encargado" });
    expect(find(events, "actions")!.actions.map((a) => a.label)).toEqual(["Validarlas"]);
  });

  it("«Validarlas» prepara el borrador con esas salidas y al confirmar las valida", async () => {
    const setup = makeAgent(new FakeJev([{ coherencia: 0.95 }]));
    const button = find(await run(setup.agent, chat("salidas sin validar")), "actions")!.actions[0]!;
    const draft = find(await run(setup.agent, chat("Validarlas", { followUpId: button.id })), "draft") as DocumentDraft;
    expect(draft).toMatchObject({ kind: "documento", operation: "validar_salidas", title: "Validar 2 salidas de almacén en Parador", moveIds: ["a0000000-0000-4000-8000-000000000001", "a0000000-0000-4000-8000-000000000002"] });
    expect(draft.lines[0]).toEqual({ label: "Coca-Cola 20 cl · Almacén → Barra 1", qty: "2 cajas" });
    const result = await confirm(setup, draft.draftId);
    expect(result).toMatchObject({ ok: true, message: "Validadas 2 salidas: el stock ya está movido de zona.", navigate: { route: "/almacen" } });
    expect(setup.writer.calls).toEqual([{ method: "validateAreaMoves", args: { moveIds: draft.moveIds } }]);
  });

  it("en un local sin pendientes lo dice, sin borrador", async () => {
    const { agent } = makeAgent(new FakeJev());
    const events = await run(agent, chat("valida las salidas del Vivero"));
    expect(find(events, "draft")).toBeUndefined();
    expect(find(events, "error")?.message ?? find(events, "done")?.text).toContain("No hay salidas de almacén pendientes de validar en Vivero");
  });
});

describe("pagar una factura", () => {
  it("la de Makro: borrador con el importe y, al confirmar, pagada hoy", async () => {
    const setup = makeAgent(new FakeJev([{ coherencia: 0.95 }]));
    const draft = find(await run(setup.agent, chat("marca como pagada la factura de Makro")), "draft") as DocumentDraft;
    expect(draft).toMatchObject({ operation: "pagar_factura", documentId: "f0000000-0000-4000-8000-000000000001", requiredRole: "manager" });
    expect(draft.title).toBe("Marcar pagada: Makro MK-1001 (1.210,00 €)");
    expect(draft.summary).toContain("vencida el");
    const result = await confirm(setup, draft.draftId);
    expect(result).toMatchObject({ ok: true, message: "Factura marcada como pagada hoy.", navigate: { route: "/facturas" } });
    expect(setup.writer.calls).toEqual([{ method: "markInvoicePaid", args: { invoiceId: draft.documentId, day: NOW.toISOString().slice(0, 10) } }]);
  });

  it("sin decir cuál: pregunta (las vencidas primero) y sigue con la elegida", async () => {
    const setup = makeAgent(new FakeJev([{ coherencia: 0.95 }]));
    const ask = find(await run(setup.agent, chat("paga la factura")), "clarify")!;
    expect(ask.question).toBe("¿Qué factura marco como pagada?");
    expect(ask.options.map((o) => o.label)).toEqual([expect.stringMatching(/^Makro · MK-1001 · 1\.210,00 € · vencida el/), expect.stringMatching(/^Distribuciones Canarias · DC-77/)]);
    const events = await run(setup.agent, chat("Distribuciones Canarias", { clarification: { clarifyId: ask.clarifyId, optionId: ask.options[1]!.id } }));
    const draft = find(events, "draft") as DocumentDraft;
    expect(draft).toMatchObject({ operation: "pagar_factura", documentId: "f0000000-0000-4000-8000-000000000002" });
    // No cuadra con sus albaranes por 18 €: se avisa.
    expect(draft.warnings.join(" ")).toContain("No cuadra con sus albaranes (+18,00 €)");
  });

  it("el personal no lleva facturas", async () => {
    const { agent } = makeAgent(new FakeJev());
    const events = await run(agent, chat("marca como pagada la factura de Makro"), "staff");
    expect(find(events, "draft")).toBeUndefined();
    expect(JSON.stringify(events)).toContain("Las facturas las llevan los encargados que ven costes");
  });

  it("preguntar por las facturas sigue siendo una consulta", async () => {
    const { agent } = makeAgent(new FakeJev());
    const events = await run(agent, chat("¿qué facturas hay por pagar?"));
    expect(find(events, "draft")).toBeUndefined();
    expect(find(events, "done")!.text).toContain("Pendiente de pago");
  });
});

describe("PVP de un plato", () => {
  it("«pon el PVP de las croquetas a 10 €»: borrador con el food cost antes y después; al confirmar, guardado", async () => {
    const setup = makeAgent(new FakeJev([{ coherencia: 0.95 }]));
    const draft = find(await run(setup.agent, chat("pon el PVP de las croquetas a 10 €")), "draft") as DocumentDraft;
    expect(draft).toMatchObject({ operation: "precio_venta", documentId: "e0000000-0000-4000-8000-000000000001", price: "10", title: "Cambiar PVP: Croquetas de jamón a 10,00 €" });
    expect(draft.lines).toEqual([
      { label: "PVP con IVA", qty: "9,00 € → 10,00 €" },
      { label: "Food cost", qty: "41,6 % → 37,4 % (objetivo 30 %)" },
    ]);
    const result = await confirm(setup, draft.draftId);
    expect(result).toMatchObject({ ok: true, message: "PVP actualizado a 10,00 €.", navigate: { route: "/escandallos" } });
    expect(setup.writer.calls).toEqual([{ method: "setRecipePrice", args: { recipeId: draft.documentId, price: "10" } }]);
  });

  it("un salto grande se avisa", async () => {
    const draft = find(await run(makeAgent(new FakeJev([{ coherencia: 0.95 }])).agent, chat("el precio de venta de la ensalada de la huerta ahora es 18,50")), "draft") as DocumentDraft;
    expect(draft.price).toBe("18.5");
    expect(draft.warnings.join(" ")).toContain("Cambio grande (+131 %)");
  });

  it("el precio de compra no entra aquí, ni la pregunta por el PVP", () => {
    const ctx = fixtureContext();
    expect(officeAction("el ron ahora cuesta 15 €", ctx)).toBeNull();
    expect(officeAction("¿cuál es el PVP de las croquetas?", ctx)).toBeNull();
  });

  it("el personal no cambia precios", async () => {
    const events = await run(makeAgent(new FakeJev()).agent, chat("pon el PVP de las croquetas a 10 €"), "staff");
    expect(find(events, "draft")).toBeUndefined();
    expect(JSON.stringify(events)).toContain("lo cambian los encargados");
  });
});

describe("condiciones de un proveedor", () => {
  it("«el pedido mínimo de Makro ahora es 200 €»: antes → después y, al confirmar, guardado", async () => {
    const setup = makeAgent(new FakeJev([{ coherencia: 0.95 }]));
    const draft = find(await run(setup.agent, chat("el pedido mínimo de Makro ahora es 200 €")), "draft") as DocumentDraft;
    expect(draft).toMatchObject({ operation: "condiciones_proveedor", title: "Condiciones de Makro: pedido mínimo", terms: [{ field: "min_order", value: "200" }] });
    expect(draft.lines).toEqual([{ label: "Pedido mínimo", qty: "150,00 € → 200,00 €" }]);
    const result = await confirm(setup, draft.draftId);
    expect(result).toMatchObject({ ok: true, message: "Condiciones del proveedor actualizadas.", navigate: { route: "/proveedores" } });
    expect(setup.writer.calls).toEqual([{ method: "setSupplierTerms", args: { supplierId: draft.documentId, terms: draft.terms } }]);
  });

  it("varias cosas en una frase: días y hora límite", async () => {
    const draft = find(await run(makeAgent(new FakeJev([{ coherencia: 0.95 }])).agent, chat("a Makro se le pide martes y viernes antes de las 11")), "draft") as DocumentDraft;
    expect(draft.lines).toEqual([
      { label: "Días de pedido", qty: "lun, jue → mar, vie" },
      { label: "Hora límite", qty: "12:00 → 11:00" },
    ]);
  });

  it("preguntar por las condiciones sigue siendo una consulta", async () => {
    const events = await run(makeAgent(new FakeJev()).agent, chat("qué condiciones de pago tiene Makro"));
    expect(find(events, "draft")).toBeUndefined();
    expect(find(events, "done")!.text).toContain("pago: Transferencia a 30 días");
  });
});

describe("condiciones de un proveedor que no existe (batería en producción)", () => {
  it("dice que no lo encuentra en vez de listar los proveedores", async () => {
    const events = await run(makeAgent(new FakeJev()).agent, chat("el pedido mínimo de Proveedor Inventado ahora es 200 €"));
    expect(find(events, "draft")).toBeUndefined();
    expect(JSON.stringify(events)).toContain("No encuentro ese proveedor");
  });

  it("preguntar por el pedido mínimo sigue siendo una consulta", () => {
    expect(officeAction("pedido mínimo de Makro", fixtureContext())).toBeNull();
  });
});
