// Ventas del TPV en el asistente: «¿cuánto vendimos ayer?», «¿qué plato vende más?», food cost de lo
// vendido. Antes contestaba siempre «no tengo las ventas».
import { describe, expect, it } from "vitest";
import { FixtureInfoSource } from "../dev/fixture-info";
import { fixtureContext, LOCATIONS } from "../dev/fixture";
import { infoTopicOf } from "../tools/info";
import { sales, salesPeriod } from "../tools/info-sales";
import { topicReply } from "../agent/topics";
import { chat, FakeJev, find, makeAgent, NOW, run } from "./helpers";
import type { TableEvent } from "../contract/index";

const all = LOCATIONS.map((l) => l.id);
const ask = (message: string, ctx = fixtureContext()) => sales(new FixtureInfoSource(NOW), ctx, { message, locationIds: all, locationsChosen: false, now: NOW });

describe("reconocer una pregunta de ventas sin Jev", () => {
  it.each([
    "¿cuánto vendimos ayer?",
    "ventas de octubre",
    "facturación del mes",
    "qué es lo que más se vende",
    "food cost de las ventas de esta semana",
    "cuánto hemos ganado este mes",
    "¿cómo van las ventas este mes?",
  ])("«%s» → ventas", (m) => expect(infoTopicOf(m)).toBe("query_sales"));

  it.each([
    ["¿qué facturas hay pendientes?", "query_invoices"],
    ["food cost del lenguado", "query_recipes"],
    ["¿cuál es el precio de venta del plato de croquetas?", "query_recipes"],
    ["cómo voy este mes", "query_overview"],
  ])("«%s» no es ventas → %s", (m, tool) => expect(infoTopicOf(m)).toBe(tool));
});

describe("periodos", () => {
  it("ayer, semana pasada, un mes por su nombre y el mes en curso", () => {
    expect(salesPeriod("cuánto vendimos ayer", NOW)).toMatchObject({ from: "2026-09-22", to: "2026-09-22", label: "ayer" });
    expect(salesPeriod("ventas de la semana pasada", NOW)).toMatchObject({ from: "2026-09-14", to: "2026-09-20" });
    expect(salesPeriod("ventas de agosto", NOW)).toMatchObject({ from: "2026-08-01", to: "2026-08-31", label: "agosto" });
    // Un mes que aún no ha llegado este año es el del año pasado.
    expect(salesPeriod("ventas de diciembre", NOW)).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
    expect(salesPeriod("cuánto vendemos", NOW)).toMatchObject({ from: "2026-09-01", to: "2026-09-23", explicit: false });
  });
});

describe("respuestas", () => {
  it("resumen: venta sin IVA, coste teórico, food cost, margen y lo que falta enlazar", async () => {
    const r = await ask("¿cuánto vendimos ayer?");
    expect(r.text).toBe(
      "Ayer se vendieron 360,97 € sin IVA. Coste teórico 118,31 €: food cost 47 % y margen bruto 133,54 €, sobre el 70 % de la venta que tiene coste. Faltan por enlazar 1 artículo (109,12 €).",
    );
    expect(r.table!.rows[0]).toMatchObject({ articulo: "Lenguado a la menier", importe: "120,00 €", foodcost: "68,3 %" });
  });

  it("un artículo concreto", async () => {
    expect((await ask("¿cuántos lenguados vendimos ayer?")).text).toBe("Ayer, Lenguado a la menier: 4 vendidos por 120,00 €, coste teórico 82,00 € (food cost 68,3 %).");
  });

  it("el food cost más alto", async () => {
    const r = await ask("qué plato tiene el food cost más alto en las ventas de ayer");
    expect(r.text).toMatch(/^Ayer, el food cost más alto es Lenguado a la menier: 68,3 %/);
  });

  it("lo más vendido, por importe o por unidades", async () => {
    expect((await ask("qué es lo que más se vende")).text).toMatch(/^Lo más vendido en septiembre: Lenguado a la menier \(120,00 €\)/);
    expect((await ask("qué se vende más por unidades")).text).toMatch(/^Lo más vendido en septiembre por unidades: Servicio de pan \(48 uds\)/);
  });

  it("lo que falta enlazar", async () => {
    expect((await ask("qué ventas están sin enlazar")).text).toMatch(/^1 artículo vendido no está enlazado en septiembre \(109,12 € sin coste\)/);
  });

  it("un periodo sin ventas dice cuál es el último día importado", async () => {
    expect((await ask("ventas de agosto")).text).toBe("No hay ventas importadas de agosto. El último día importado es el 22/9/2026.");
  });

  it("sin «ve costes», no", async () => {
    expect((await ask("cuánto vendimos ayer", fixtureContext("staff"))).text).toContain("las ve la dirección");
  });

  it("una previsión no se inventa", () => {
    expect(topicReply("cuánto vamos a vender el mes que viene")?.text).toContain("No hago previsiones");
  });
});

describe("por el chat", () => {
  it("«cuánto vendimos ayer» responde con la tabla, sin preguntar ni llamar a Jev", async () => {
    const jev = new FakeJev([]);
    const { agent } = makeAgent(jev);
    const events = await run(agent, chat("cuánto vendimos ayer"));
    expect(find(events, "clarify")).toBeUndefined();
    expect((find(events, "table") as TableEvent).rows.length).toBe(4);
    expect(find(events, "done")!.text).toContain("se vendieron 360,97 €");
    expect(jev.calls).toHaveLength(0);
  });

  it("si lo decide Jev (frase sin las palabras de la vía rápida), también", async () => {
    const { agent } = makeAgent(new FakeJev([{ intent: "consultar", intent_alt: "leer", herramienta: "query_sales" }]));
    const events = await run(agent, chat("qué tal fue la caja de anoche"));
    expect(find(events, "done")!.text).toContain("360,97 €");
  });
});
