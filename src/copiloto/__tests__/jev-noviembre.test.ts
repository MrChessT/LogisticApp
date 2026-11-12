// Mejoras de noviembre de 2026, a partir de las conversaciones reales de producción: el asistente no
// navega solo, contesta a lo que se le pregunta sin repetir preguntas y consulta facturas, equipo,
// escandallos, zonas, inventarios y proveedores.
import { describe, expect, it } from "vitest";
import { infoTopicOf } from "../tools/info";
import { screenHelp } from "../agent/topics";
import { chat, FakeJev, find, makeAgent, run, type Script } from "./helpers";

const route = (tipo: string, extra: Script = {}): Script => ({ intent: "proponer_accion", intent_alt: "cambiar", tipo_accion: tipo, ...extra });

describe("consultas de gestión (sin Jev si el tema está claro)", () => {
  it("reconoce el tema y deja fuera las operaciones", () => {
    expect(infoTopicOf("que facturas hay pendientes de pagar")).toBe("query_invoices");
    expect(infoTopicOf("como van las factuas")).toBe("query_invoices");
    expect(infoTopicOf("cuanto personal hay?")).toBe("query_team");
    expect(infoTopicOf("¿qué platos llevan gluten?")).toBe("query_recipes");
    expect(infoTopicOf("cual es el food cost de los platos")).toBe("query_recipes");
    expect(infoTopicOf("que zonas tiene el vivero")).toBe("query_areas");
    expect(infoTopicOf("¿hay algún inventario abierto?")).toBe("query_counts");
    expect(infoTopicOf("qué proveedores tenemos")).toBe("query_suppliers");
    // Operaciones o consultas de stock: no son estas consultas.
    expect(infoTopicOf("crear factura")).toBeNull();
    expect(infoTopicOf("¿qué hay en cada zona del Vivero?")).toBeNull();
    expect(infoTopicOf("cuánta coca queda en el vivero")).toBeNull();
    expect(infoTopicOf("pon el mínimo de agua a 25 cajas")).toBeNull();
  });

  it("facturas pendientes: total, vencidas, las que no cuadran y tabla ordenada por vencimiento", async () => {
    const jev = new FakeJev();
    const events = await run(makeAgent(jev).agent, chat("que facturas hay pendientes de pagar"));
    expect(jev.calls).toHaveLength(0);
    const text = find(events, "done")!.text;
    expect(text).toContain("Pendiente de pago: 1.694,00 € en 2 facturas");
    expect(text).toContain("1 está vencida (1.210,00 €)");
    expect(text).toContain("no cuadra");
    const table = find(events, "table")!;
    expect(table.rows[0]).toMatchObject({ proveedor: "Makro", numero: "MK-1001" });
    expect(table.flagged).toEqual([0]);
    expect(find(events, "navigate")).toEqual({ route: "/facturas", filters: {}, auto: false });
  });

  it("facturas: el personal sin permiso no las ve", async () => {
    const events = await run(makeAgent(new FakeJev()).agent, chat("que facturas hay"), "staff");
    expect(find(events, "done")!.text).toMatch(/dirección/);
    expect(find(events, "table")).toBeUndefined();
  });

  it("albaranes sin factura y las que no cuadran", async () => {
    const { agent } = makeAgent(new FakeJev());
    expect(find(await run(agent, chat("qué albaranes están sin factura")), "done")!.text).toContain("2 albaranes sin factura por 240,50 €");
    expect(find(await run(agent, chat("qué facturas no cuadran")), "done")!.text).toMatch(/1 factura no cuadra.*18,00 € más/);
  });

  it("escandallos: resumen con food cost, un plato concreto y alérgenos", async () => {
    const { agent } = makeAgent(new FakeJev());
    const summary = find(await run(agent, chat("cual es el food cost de los platos")), "done")!.text;
    expect(summary).toContain("2 platos y 1 elaboración");
    expect(summary).toContain("Food cost medio 31,8 %");
    expect(find(await run(agent, chat("¿qué platos llevan gluten?")), "done")!.text).toBe("1 plato con gluten: Croquetas de jamón.");
    expect(find(await run(agent, chat("qué platos hay sin gluten")), "done")!.text).toContain("Ensalada de la huerta");
    expect(find(await run(agent, chat("escandallo de las croquetas de jamón")), "done")!.text).toMatch(/Croquetas de jamón.*coste 3,40 € por ración.*PVP 9,00 €.*alérgenos: Gluten, Lácteos, Huevo/);
  });

  it("zonas, inventarios y proveedores", async () => {
    const { agent } = makeAgent(new FakeJev());
    expect(find(await run(agent, chat("que zonas tiene el parador")), "done")!.text).toMatch(/^Parador tiene 3 zonas: Barra 1, Barra 2, Almacén\./);
    const counts = find(await run(agent, chat("¿hay algún inventario abierto?")), "done")!.text;
    expect(counts).toContain("1 inventario abierto: Vivero");
    expect(counts).toContain("Llevan más de un mes sin contar: Parador");
    const supplier = find(await run(agent, chat("qué condiciones de pago tiene Makro")), "done")!.text;
    expect(supplier).toMatch(/^Makro: pedidos lun, jue antes de las 12:00 · entrega en 24 h · mínimo 150,00 € · pago: Transferencia a 30 días\. Contacto: Pedro/);
  });

  it("equipo: quiénes son, puesto y locales; el personal no lo ve", async () => {
    const { agent } = makeAgent(new FakeJev());
    const events = await run(agent, chat("cuanto personal hay?"));
    expect(find(events, "done")!.text).toBe("3 personas en tus locales: 1 en propiedad, 1 encargado, 1 de personal. 1 invitación está sin aceptar.");
    expect(find(events, "table")!.rows).toEqual(expect.arrayContaining([expect.objectContaining({ nombre: "Luis Encargado", locales: "Parador, Pickels" })]));
    expect(find(await run(agent, chat("cuanto personal hay?"), "staff"), "done")!.text).toMatch(/encargados y la administración/);
  });
});

describe("tablas limpias", () => {
  it("sin columnas vacías: proveedores sin condiciones apuntadas no enseñan columnas de «—»", async () => {
    const { runInfo } = await import("../tools/info");
    const { fixtureContext } = await import("../dev/fixture");
    const source = {
      suppliers: async () => [
        { name: "A", contact: null, phone: null, email: null, orderDays: [], cutoff: null, leadHours: null, minOrder: null, paymentTerms: null, locationIds: [] },
        { name: "B", contact: null, phone: null, email: null, orderDays: [], cutoff: null, leadHours: null, minOrder: null, paymentTerms: "Contado", locationIds: [] },
      ],
    } as unknown as Parameters<typeof runInfo>[0];
    const result = await runInfo(source, fixtureContext(), { tool: "query_suppliers", message: "qué proveedores tenemos", locationIds: [], locationsChosen: false, productNames: [], now: new Date() });
    expect(result.table!.columns.map((c) => c.label)).toEqual(["Proveedor", "Pago"]);
  });
});

describe("pantallas", () => {
  it("abre la que se pide; de las que se pregunta, dice dónde está y deja el enlace", () => {
    expect(screenHelp("llévame a mermas")).toMatchObject({ route: "/mermas", go: true });
    expect(screenHelp("¿dónde están las facturas?")).toMatchObject({ route: "/facturas", text: expect.stringContaining("Gestión › Facturas") });
    expect(screenHelp("abre pedidos")).toMatchObject({ route: "/pedidos" });
    // Operaciones, no pantallas.
    expect(screenHelp("abre inventario en el vivero", ["Vivero"])).toBeNull();
    expect(screenHelp("abre el inventario del Vivero", ["Vivero"])).toBeNull();
    expect(screenHelp("pasa 2 cajas de coca al vivero")).toBeNull();
  });

  it("crear o registrar una factura: explica dónde se hace (con el PDF y el cuadre)", async () => {
    const events = await run(makeAgent(new FakeJev()).agent, chat("crear factura"));
    expect(find(events, "done")!.text).toContain("Gestión › Facturas");
    expect(find(events, "navigate")?.auto).toBe(false);
  });
});

describe("preguntas: lo escrito contesta la pregunta, sin bucles", () => {
  it("«a 1,50» al preguntar el precio es el precio (antes se tomaba como cantidad y volvía a preguntar)", async () => {
    const jev = new FakeJev([route("cambiar_precio", { producto_0: "Coca-Cola 20 cl" }), { coherencia: 0.95, precio_plausible: 0.9 }]);
    const { agent } = makeAgent(jev);
    const ask = find(await run(agent, chat("sube el precio de la coca")), "clarify")!;
    expect(ask.field).toBe("precio");
    const events = await run(agent, chat("a 1,50", { clarification: { clarifyId: ask.clarifyId, optionId: "otra", freeText: "a 1,50" } }));
    expect(find(events, "clarify")).toBeUndefined();
    expect(find(events, "draft")).toMatchObject({ kind: "precio", newPrice: "1.5" });
  });

  it("«déjalo» a cualquier pregunta la cierra", async () => {
    const jev = new FakeJev([route("merma")]);
    const { agent } = makeAgent(jev);
    const ask = find(await run(agent, chat("registrar merma")), "clarify")!;
    const events = await run(agent, chat("déjalo", { clarification: { clarifyId: ask.clarifyId, optionId: "otra", freeText: "déjalo" } }));
    expect(find(events, "done")!.text).toBe("Vale, lo dejo. Dime si necesitas otra cosa.");
    expect(find(events, "clarify")).toBeUndefined();
  });

  it("la frase nombra la operación y Jev la pone primera: se prepara sin preguntar «¿Qué operación?»", async () => {
    const jev = new FakeJev([{ ...route("preparar_pedido"), tipo_accion: { dist: { preparar_pedido: 0.55, recepcion: 0.35 } }, local: "Parador" }, { coherencia: 0.9 }]);
    const events = await run(makeAgent(jev).agent, chat("prepárame el pedido para el parador"));
    expect(find(events, "clarify")?.question ?? "").not.toBe("¿Qué operación quieres registrar?");
  });

  it("una consulta que Jev ve probable (sin llegar a «actuar») se contesta en vez de preguntar «¿Qué quieres consultar?»", async () => {
    const jev = new FakeJev([{ intent: "consultar", intent_alt: "leer", herramienta: { dist: { query_prices: 0.55, query_product: 0.4 } }, producto_0: "Coca-Cola 20 cl" }]);
    const events = await run(makeAgent(jev).agent, chat("precio cocacola"));
    expect(find(events, "clarify")).toBeUndefined();
    expect(find(events, "done")!.text).toMatch(/Coca-Cola/);
  });
});
