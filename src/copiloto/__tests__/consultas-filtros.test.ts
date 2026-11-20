// Fase 2 del plan de mejora: las consultas de inventario respetan el periodo natural y la familia que se dicen.
import { describe, expect, it } from "vitest";
import { chat, FakeJev, find, makeAgent, run } from "./helpers";

const SPEND = { intent: "consultar", intent_alt: "leer", herramienta: "query_spend", periodo: "mes" };

describe("gasto con filtros", () => {
  it("«este mes en refrescos»: desde el día 1 y solo las líneas de esa familia", async () => {
    const { agent } = makeAgent(new FakeJev([SPEND]));
    const done = find(await run(agent, chat("cuanto he gastado este mes en refrescos")), "done")!;
    expect(done.text).toMatch(/^Compras de refrescos del 01\/09\/2026 al 23\/09\/2026: 80,00 € en 1 albarán\./);
  });

  it("«en Bebidas del Sur»: solo lo de ese proveedor; uno que no existe se dice", async () => {
    const { agent } = makeAgent(new FakeJev([SPEND, SPEND]));
    expect(find(await run(agent, chat("cuanto he gastado este mes en bebidas del sur")), "done")!.text).toMatch(/^Compras de Bebidas del Sur del 01\/09\/2026 al 23\/09\/2026: 198,00 € en 2 albaranes\./);
    expect(find(await run(agent, chat("cuanto llevamos gastado con frutas paco")), "done")!.text).toBe("No tengo ningún proveedor llamado «frutas paco». Pregúntame el gasto de uno de los tuyos o el total («¿cuánto he gastado este mes?»).");
  });

  it("sin familia ni «este mes»: todo lo comprado en los últimos 30 días, como siempre", async () => {
    const { agent } = makeAgent(new FakeJev([SPEND]));
    const done = find(await run(agent, chat("cuanto he gastado")), "done")!;
    expect(done.text).toMatch(/^Compras del 25\/08\/2026 al 23\/09\/2026: 382,80 € en 3 albaranes\./);
  });
});

describe("comparar proveedores por precio", () => {
  it("«¿qué proveedor me vende más barata la coca cola?»: el último precio por unidad de cada uno", async () => {
    const jev = new FakeJev([{}]);
    const { agent } = makeAgent(jev);
    const done = find(await run(agent, chat("que proveedor me vende mas barata la coca cola")), "done")!;
    expect(done.text).toBe("Coca-Cola 20 cl: solo la trae Bebidas del Sur, a 0,55 €/ud (Caja 24 ud a 13,20 €, 20/9/2026). No hay otro proveedor con que comparar.");
    expect(jev.calls).toHaveLength(0);
  });
});

describe("mermas por local", () => {
  it("«¿en qué local se pierde más dinero en mermas?»: el importe de cada local, del mayor al menor, en el último mes", async () => {
    const { agent } = makeAgent(new FakeJev([{ intent: "consultar", intent_alt: "leer", herramienta: "query_movements", local: "todos" }]));
    const events = await run(agent, chat("en que local se pierde mas dinero en mermas"));
    const done = find(events, "done")!;
    expect(done.text).toMatch(/^Mermas en tus 4 locales \(los últimos 30 días\): 30,80 €\.\nDonde más: Parador \(30,00 €\)\.$/);
    expect(find(events, "table")?.columns.map((c) => c.label)).toEqual(["Local", "Tipo", "Valor", "Registros"]);
  });
});

describe("catálogo: un problema concreto y el stock parado", () => {
  it("«¿qué productos no tienen precio?»: solo los que no tienen precio, sin Jev", async () => {
    const jev = new FakeJev([{}]);
    const { agent } = makeAgent(jev);
    const done = find(await run(agent, chat("que productos no tienen precio")), "done")!;
    expect(done.text).toBe("1 producto sin precio: Ron Brugal Añejo 70 cl. Se arregla en la ficha de cada producto.");
    expect(jev.calls).toHaveLength(0);
  });

  it("«¿cuánto stock tengo parado?»: lo que no ha tenido salidas en 30 días, valorado", async () => {
    const { agent } = makeAgent(new FakeJev([{}]));
    const events = await run(agent, chat("cuanto stock tengo parado"));
    expect(find(events, "done")!.text).toBe(
      "Stock parado (sin ninguna salida en 30 días): 339,25 € en 7 productos (cada local aparte). Lo que más pesa: Cerveza Mahou barril 30 l en Parador (148,50 €), Ron Brugal Añejo 70 cl en Parador (98,00 €), Ginebra Tanqueray 70 cl en Parador (34,00 €). Se puede traspasar a donde se gaste o dejar de pedirlo.",
    );
    expect(find(events, "table")!.rows).toHaveLength(7);
  });
});

describe("preguntas dobles", () => {
  it("«dime el stock del ron barceló y a cuánto lo compramos»: la ficha, con stock y precio", async () => {
    const { agent } = makeAgent(new FakeJev([{ intent: "consultar", intent_alt: "leer", herramienta: "query_stock", producto_0: "Ron Barceló Añejo 70 cl", local: "todos", dato: "cantidad" }]));
    const done = find(await run(agent, chat("dime el stock del ron barcelo añejo y a cuanto lo compramos")), "done")!;
    expect(done.text).toMatch(/^Ron Barceló Añejo 70 cl · Destilados\nPrecio: .*92,40 €.*\nStock: /);
  });

  it("una sola pregunta sigue siendo una sola respuesta", async () => {
    const { asksSeveralData } = await import("../entities/signals");
    expect(asksSeveralData("cuanto queda de larios y de beefeater")).toBe(false);
    expect(asksSeveralData("precio y proveedor de la coca cola")).toBe(true);
    expect(asksSeveralData("cuanto queda de larios y cuanto se gasta al dia")).toBe(true);
  });
});
