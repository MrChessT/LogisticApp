// «¿cuál es el producto más caro?» y «¿cómo voy este mes?»: antes Jev contestaba «¿Qué quieres
// consultar?» (medido con frases reales). Ahora responden sin preguntar, con su tabla.
import { describe, expect, it } from "vitest";
import { FixtureInfoSource } from "../dev/fixture-info";
import { fixtureContext, LOCATIONS } from "../dev/fixture";
import { infoTopicOf } from "../tools/info";
import { overview, overviewPeriods, priceRanking } from "../tools/info-figures";
import { chat, FakeJev, find, makeAgent, NOW, run } from "./helpers";
import type { TableEvent } from "../contract/index";

const VIVERO = LOCATIONS[2]!;
const all = LOCATIONS.map((l) => l.id);

describe("reconocer la pregunta sin Jev", () => {
  it.each([
    ["dime cual es el producto mas caro", "query_price_ranking"],
    ["¿Qué es lo más barato que compramos?", "query_price_ranking"],
    ["Quiero saber cuál es el producto más caro que tiene pickles", "query_price_ranking"],
    ["quieo que me digas como voy este mes", "query_overview"],
    ["¿cómo vamos esta semana?", "query_overview"],
    ["resumen del mes", "query_overview"],
  ])("«%s» → %s", (message, tool) => {
    expect(infoTopicOf(message)).toBe(tool);
  });

  it.each(["¿qué está más caro que el mes pasado?", "cambia el precio del ron, ahora es más caro", "¿cómo hago un traspaso?"])("«%s» no es ninguna de las dos", (message) => {
    expect(["query_price_ranking", "query_overview"]).not.toContain(infoTopicOf(message));
  });
});

describe("lo más caro", () => {
  it("ordena por precio en su unidad natural: la botella, la ud o el kg", async () => {
    const r = await priceRanking(new FixtureInfoSource(NOW), fixtureContext(), { message: "¿cuál es el producto más caro?", locationIds: all, locationsChosen: false });
    expect(r.table!.rows.map((x) => [x.producto, x.precio, x.por])).toEqual([
      ["Ginebra Tanqueray 70 cl", "18,00 €", "botella 70 cl"],
      ["Ron Barceló Añejo 70 cl", "15,40 €", "botella 70 cl"],
      ["Limones", "1,20 €", "kg"],
      ["Coca-Cola 20 cl", "0,55 €", "ud"],
    ]);
    expect(r.text).toMatch(/^Lo más caro es Ginebra Tanqueray 70 cl: 18,00 € por botella 70 cl \(Makro\)\./);
  });

  it("lo más barato, y solo lo que hay en el local que nombra", async () => {
    const r = await priceRanking(new FixtureInfoSource(NOW), fixtureContext(), { message: "lo más barato del Vivero", locationIds: [VIVERO.id], locationsChosen: true });
    expect(r.table!.rows.map((x) => x.producto)).toEqual(["Coca-Cola 20 cl", "Limones"]);
    expect(r.text).toContain("Lo más barato en Vivero es Coca-Cola 20 cl");
  });

  it("si nombra una categoría, solo esa (la categoría es una ruta: «Vinos › Tinto» vale para «vino» y para «tinto»)", async () => {
    const ctx = fixtureContext();
    const r = await priceRanking(new FixtureInfoSource(NOW), ctx, { message: "¿cuál es el destilado más caro?", locationIds: all, locationsChosen: false });
    expect(r.table!.rows.map((x) => x.producto)).toEqual(["Ginebra Tanqueray 70 cl", "Ron Barceló Añejo 70 cl"]);
    const wines = { ...ctx, categories: [...ctx.categories, { id: "v", name: "Vinos" }, { id: "t", name: "Tinto" }], products: ctx.products.map((p, i) => (i === 2 ? { ...p, category: "Vinos › Tinto" } : p)) };
    const tinto = await priceRanking(new FixtureInfoSource(NOW), wines, { message: "el vino tinto más caro", locationIds: all, locationsChosen: false });
    expect(tinto.text).toMatch(/^Lo más caro en vinos › tinto es Ginebra Tanqueray/);
  });

  it("sin «ve costes» no enseña precios", async () => {
    const r = await priceRanking(new FixtureInfoSource(NOW), fixtureContext("staff"), { message: "lo más caro", locationIds: all, locationsChosen: false });
    expect(r.table).toBeUndefined();
    expect(r.text).toContain("no se ven con tu puesto");
  });
});

describe("cómo voy", () => {
  it("el mes en curso frente al mismo tramo del anterior", () => {
    expect(overviewPeriods("como voy este mes", NOW)).toMatchObject({ label: "septiembre (del 1 al 23)", start: "2026-09-01", prevStart: "2026-08-01", prevEnd: "2026-08-24" });
    // Un 31 de marzo se compara con todo febrero, no con días que no existen.
    expect(overviewPeriods("como voy", new Date(2026, 2, 31, 12))).toMatchObject({ prevStart: "2026-02-01", prevEnd: "2026-03-01" });
    expect(overviewPeriods("como vamos esta semana", NOW)).toMatchObject({ label: "esta semana", start: "2026-09-21", prevStart: "2026-09-14", prevEnd: "2026-09-17", days: 3 });
  });

  it("compras, consumo y mermas con su cambio, y el stock de ahora", async () => {
    const r = await overview(new FixtureInfoSource(NOW), fixtureContext(), { message: "¿cómo voy este mes?", locationIds: all, locationsChosen: false, now: NOW });
    expect(r.text).toBe(
      "En septiembre (del 1 al 23) has comprado 300,00 € (+50 % frente al mismo tramo de agosto), el consumo registrado suma 120,00 €, las mermas 30,00 € (20 % de lo que ha salido). Has vendido 360,97 € sin IVA, con un food cost del 47 % en lo que tiene coste. Ahora tienes 4.520,50 € en stock y 3 productos bajo mínimo, 1 sin stock.",
    );
    expect(r.table!.rows).toEqual([
      { concepto: "Compras (1 entrada)", actual: "300,00 €", anterior: "200,00 €", cambio: "+50 %" },
      { concepto: "Consumo", actual: "120,00 €", anterior: "100,00 €", cambio: "+20 %" },
      { concepto: "Mermas", actual: "30,00 €", anterior: "10,00 €", cambio: "+200 %" },
    ]);
  });
});

it("«comparado con el mes pasado»: la comparación va delante", async () => {
  const r = await overview(new FixtureInfoSource(NOW), fixtureContext(), { message: "¿y comparado con el mes pasado?", locationIds: all, locationsChosen: false, now: NOW });
  expect(r.text).toMatch(/^Frente al mismo tramo de agosto: compras 300,00 € \(antes 200,00 €, \+50 %\), consumo 120,00 € \(antes 100,00 €, \+20 %\), mermas 30,00 € \(antes 10,00 €, \+200 %\)\. En septiembre/);
});

it("entradas de mercancía sin importe: lo dice, no «no hay compras»", async () => {
  class NoCost extends FixtureInfoSource {
    override async figureMovements() {
      return [{ type: "purchase" as const, qty: "10", unitCost: "0", occurredAt: NOW.toISOString() }];
    }
  }
  const r = await overview(new NoCost(NOW), fixtureContext(), { message: "como voy", locationIds: all, locationsChosen: false, now: NOW });
  expect(r.text).toContain("hay 1 entrada de mercancía sin importe");
});

describe("por el chat", () => {
  it("«dime cual es el producto mas caro» responde con la tabla, sin preguntar ni llamar a Jev", async () => {
    const jev = new FakeJev([]);
    const { agent } = makeAgent(jev);
    const events = await run(agent, chat("dime cual es el producto mas caro"));
    expect(find(events, "clarify")).toBeUndefined();
    expect((find(events, "table") as TableEvent).rows[0]!.producto).toBe("Ginebra Tanqueray 70 cl");
    expect(find(events, "done")!.text).toContain("Lo más caro es Ginebra Tanqueray 70 cl");
  });

  it("«como voy este mes» responde con el resumen", async () => {
    const { agent } = makeAgent(new FakeJev([]));
    const events = await run(agent, chat("como voy este mes"));
    expect(find(events, "clarify")).toBeUndefined();
    expect(find(events, "done")!.text).toContain("has comprado 300,00 €");
  });

  it("si lo decide Jev (frase sin las palabras de la vía rápida), también", async () => {
    const jev = new FakeJev([{ intent: "consultar", intent_alt: "leer", herramienta: "query_overview" }]);
    const { agent } = makeAgent(jev);
    const events = await run(agent, chat("qué tal llevamos las cuentas"));
    expect(find(events, "done")!.text).toContain("has comprado");
  });
});

describe("pedir sugerencias aunque la segunda lectura dude", () => {
  it("«Qué reponer» (sugerencias 0,98; la segunda formulación lo lee como «cambiar») contesta, no pregunta", async () => {
    const jev = new FakeJev([{ intent: "pedir_sugerencias", intent_alt: "cambiar" }]);
    const { agent } = makeAgent(jev);
    const events = await run(agent, chat("Qué reponer"));
    expect(find(events, "clarify")).toBeUndefined();
    expect(find(events, "table")).toBeDefined();
  });

  it("una consulta con la segunda lectura en contra sigue preguntando (podría ser un cambio)", async () => {
    const jev = new FakeJev([{ intent: "consultar", intent_alt: "cambiar" }]);
    const { agent } = makeAgent(jev);
    const events = await run(agent, chat("pon el mínimo de agua a 25"));
    expect(find(events, "clarify")).toBeDefined();
  });
});

describe("errores del catálogo", () => {
  it.each(["que errores hay", "Revisar catálogo", "¿qué no cuadra?"])("«%s» revisa el catálogo sin preguntar", async (message) => {
    const { agent } = makeAgent(new FakeJev([]));
    const events = await run(agent, chat(message));
    expect(find(events, "clarify")).toBeUndefined();
    expect(find(events, "done")!.text).toMatch(/^Hay 1 problema que da cifras falsas/);
  });
});
