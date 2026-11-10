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

describe("un escandallo pedido por su nombre que no existe", () => {
  const recipe = async (message: string) => {
    const { runInfo } = await import("../tools/info");
    return runInfo(new FixtureInfoSource(NOW), fixtureContext(), { tool: "query_recipes", message, locationIds: all, locationsChosen: false, productNames: [], now: NOW });
  };

  it("lo dice en vez de dar el resumen de todos", async () => {
    expect((await recipe("necesito saber la receta de los macarrones con queso")).text).toBe("No hay ningún escandallo de «macarrones con queso». Se crea en Escandallos o se importa desde Importar.");
  });

  it("si existe, o si se pregunta en general, como siempre", async () => {
    expect((await recipe("coste de las croquetas de jamón")).text).toMatch(/^Croquetas de jamón \(Entrantes\)/);
    expect((await recipe("food cost de los platos")).text).toMatch(/platos? y/);
    expect((await recipe("quiero hacer una receta")).text).toMatch(/platos? y/);
  });
});

describe("frases medidas con Jev real (10/11)", () => {
  it("un día con su mes no es el mes entero", () => {
    expect(salesPeriod("cuánto vendimos el 30 de octubre", NOW)).toMatchObject({ from: "2025-10-30", to: "2025-10-30", label: "el 30/10/2025" });
    expect(salesPeriod("qué tal fue la caja del 2 de septiembre", NOW)).toMatchObject({ from: "2026-09-02", to: "2026-09-02" });
    expect(salesPeriod("ventas del 1 al 15 de agosto", NOW)).toMatchObject({ from: "2026-08-01", to: "2026-08-15" });
    expect(salesPeriod("cuánta pasta hicimos el jueves 18", NOW)).toMatchObject({ from: "2026-09-18", to: "2026-09-18" });
    expect(salesPeriod("ventas del día 30", NOW)).toMatchObject({ from: "2026-08-30", to: "2026-08-30" });
  });

  it.each([
    "qué plato vende más",
    "qué plato tiene el food cost más alto en octubre",
    "cuánta pasta hicimos el jueves 30",
    "qué tal fue la caja de ayer",
  ])("«%s» → ventas", (m) => expect(infoTopicOf(m)).toBe("query_sales"));

  it.each(["food cost de las croquetas", "cuántas cajas de coca quedan"])("«%s» no es ventas", (m) => expect(infoTopicOf(m)).not.toBe("query_sales"));

  it("ticket medio: se dice que el TPV no trae tickets, y se da lo vendido", async () => {
    expect((await ask("ticket medio de ayer")).text).toMatch(/^El TPV exporta lo vendido por artículo, sin tickets ni comensales.*Ayer se vendieron 360,97 €/);
  });

  it("«el día 22 de septiembre» da ese día", async () => {
    expect((await ask("cuánto vendimos el 22 de septiembre")).text).toMatch(/^El 22\/9\/2026 se vendieron 360,97 €/);
  });
});

describe("locales nombrados en la vía rápida", () => {
  it("«la» de «La Oliva» no es nombrar La Oliva", async () => {
    const { namedLocations } = await import("../agent/loop");
    expect(namedLocations(LOCATIONS, "qué tal fue la caja de ayer")).toEqual([]);
    expect(namedLocations(LOCATIONS, "facturas de la oliva").map((l) => l.name)).toEqual(["La Oliva"]);
    expect(namedLocations(LOCATIONS, "ventas del parador").map((l) => l.name)).toEqual(["Parador"]);
  });
});

describe("escandallos por nombre con muchas coincidencias sueltas (medido en producción)", () => {
  const base = { kind: "plato", category: "Entrantes", active: true, salePrice: null, target: "30", portionCost: "2.00", foodCostPct: null, margin: null, missingPrices: 0, allergens: [] };
  const names = ["Tarta de queso", "Queso frito", "Tabla de quesos", "Croquetas de jamón", "Croquetas de boletus", "Croqueta de cecina de Wagyu", "Croquetas de queso azul"];
  class Many extends FixtureInfoSource {
    override async recipes() { return names.map((name) => ({ ...base, name })) as Awaited<ReturnType<FixtureInfoSource["recipes"]>>; }
  }
  const recipe = async (message: string) => {
    const { runInfo } = await import("../tools/info");
    return (await runInfo(new Many(NOW), fixtureContext(), { tool: "query_recipes", message, locationIds: all, locationsChosen: false, productNames: [], now: NOW })).text;
  };

  it("lo que no existe lo dice, aunque una palabra suelta encaje con varias", async () => {
    expect(await recipe("necesito saber la receta de los macarrones con queso")).toMatch(/^No hay ningún escandallo de «macarrones con queso»\. Parecidos: /);
  });

  it("si varias tienen todo lo pedido, se listan para elegir; si es una, su ficha", async () => {
    expect(await recipe("escandallo de las croquetas")).toMatch(/^Hay \d escandallos de «croquetas»: .*Dime cuál\.$/);
    expect(await recipe("coste de las croquetas de boletus")).toMatch(/^Croquetas de boletus \(Entrantes\)/);
    // Medido en producción: el nombre a medias («…de Wagyu» falta) y «margen» daban el resumen general.
    expect(await recipe("margen de la croqueta de cecina")).toMatch(/^Croqueta de cecina de Wagyu \(Entrantes\)/);
    expect(await recipe("food cost de los platos")).not.toMatch(/^No hay/);
  });
});
