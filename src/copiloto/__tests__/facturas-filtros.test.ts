// Fase 2 del plan de mejora: las consultas de facturas y albaranes respetan lo que dice el mensaje (número,
// proveedor, periodo, vencimiento) y dicen que un proveedor no existe en vez de contestar con todos.
import { describe, expect, it } from "vitest";
import { fixtureContext } from "../dev/fixture";
import { FixtureInfoSource } from "../dev/fixture-info";
import { runInfo } from "../tools/info";
import { NOW } from "./helpers";

const ctx = fixtureContext();
const ask = (message: string) => runInfo(new FixtureInfoSource(NOW), ctx, { tool: "query_invoices", message, locationIds: ctx.locations.map((l) => l.id), locationsChosen: false, productNames: [], now: NOW });

describe("facturas y albaranes con filtros", () => {
  it("por número: el albarán con su factura (o sin ella) y la factura con su estado", async () => {
    expect((await ask("busca el albaran A-4356")).text).toBe("Albarán A-4356 de Makro, del 21/9/2026 en Parador: 150,00 €, aún sin factura.");
    expect((await ask("el albarán DC-A-31")).text).toContain("facturado en la factura DC-77");
    expect((await ask("factura MK-1001")).text).toMatch(/^Factura MK-1001 de Makro, del 14\/8\/2026: 1\.210,00 €, pendiente \(vencida hace 10 días\)/);
    expect((await ask("busca el albaran Z-999")).text).toContain("No encuentro ninguna factura ni albarán con el número «Z-999»");
  });

  it("proveedor que no existe: se dice, con los que sí tienen documentos", async () => {
    const r = await ask("cuanto le debo a frutas paco");
    expect(r.text).toBe("No tengo ningún proveedor llamado «frutas». Los que tienen facturas o albaranes son: Bebidas del Sur, Distribuciones Canarias, Makro.");
    expect(r.table).toBeUndefined();
  });

  it("«cuánto le debo a Makro»: lo facturado pendiente y, aparte, los albaranes sin facturar", async () => {
    const r = await ask("cuanto le debo a makro");
    expect(r.text).toBe("Pendiente de pago de Makro: 1.210,00 € en 1 factura. 1 está vencida (1.210,00 €). Además hay 2 albaranes sin facturar por 240,50 €.");
  });

  it("vencen esta semana: solo las que vencen hasta el domingo; las vencidas se nombran aparte", async () => {
    const r = await ask("que facturas vencen esta semana");
    expect(r.text).toBe("1 factura vence esta semana (hasta el 27/09/2026): 484,00 €. Además, 1 está vencida sin pagar (1.210,00 €).");
  });

  it("albaranes de un proveedor en un periodo: todos, con su factura; sin filtros, los que faltan por facturar", async () => {
    const r = await ask("albaranes de distribuciones canarias de este mes");
    expect(r.text).toBe("1 albarán de Distribuciones Canarias de este mes (desde el 01/09/2026) por 466,00 €; todos facturados.");
    expect((await ask("que albaranes hay")).text).toMatch(/^Hay 2 albaranes sin factura por 240,50 €/);
  });

  it("facturas de un periodo, por su fecha", async () => {
    expect((await ask("facturas de este mes")).text).toBe("1 factura de este mes (desde el 01/09/2026) por 484,00 €; pendiente de pago: 484,00 €.");
    expect((await ask("facturas pagadas en agosto")).text).toBe("1 factura pagada en agosto por 300,00 €. La última, el 23/8/2026.");
  });
});

describe("equipo: preguntas por una persona", () => {
  const team = (message: string) => runInfo(new FixtureInfoSource(NOW), ctx, { tool: "query_team", message, locationIds: ctx.locations.map((l) => l.id), locationsChosen: false, productNames: [], now: NOW });

  it("«¿qué permisos tiene Marta?»: su puesto, locales y permisos sueltos", async () => {
    const r = await team("que permisos tiene marta");
    expect(r.text).toBe("Marta Camarera: personal en Vivero (aún no ha aceptado la invitación). Solo sus locales: recepciones, traspasos, mermas, inventarios y salidas. No ve costes ni importes. Valida salidas del almacén con su PIN.");
    expect(r.table).toBeUndefined();
  });

  it("alguien que no está se dice; «¿cuántos encargados hay?» sigue siendo la lista", async () => {
    expect((await team("que permisos tiene pepe")).text).toBe("No hay nadie llamado «pepe» en el equipo. Mira la lista en Equipo.");
    expect((await team("cuantos encargados hay")).text).toMatch(/^3 personas/);
  });
});

describe("proveedores: contacto de uno que no existe", () => {
  it("«teléfono de frutas paco»: se dice que no está; «teléfono de makro», su ficha", async () => {
    const { infoTopicOf } = await import("../tools/info");
    expect(infoTopicOf("telefono de makro")).toBe("query_suppliers");
    const supp = (message: string) => runInfo(new FixtureInfoSource(NOW), ctx, { tool: "query_suppliers", message, locationIds: ctx.locations.map((l) => l.id), locationsChosen: false, productNames: [], now: NOW });
    expect((await supp("telefono de frutaspaco")).text).toBe("No tengo ningún proveedor llamado «frutaspaco». Mira la lista en Proveedores o dalo de alta allí.");
    expect((await supp("telefono de makro")).text).toMatch(/^Makro: /);
  });
});
