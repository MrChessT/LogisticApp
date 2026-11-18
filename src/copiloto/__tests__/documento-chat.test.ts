// Preguntas sobre el archivo leído en el chat y carga de las ventas del TPV desde ahí (document-turn.ts).
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ChatDocument, DocumentDraft } from "../contract/index";
import { ORG_ID, fixtureContext } from "../dev/fixture";
import { REFERS } from "../agent/document-turn";
import { chat, FakeJev, find, makeAgent, run } from "./helpers";

const factura: ChatDocument = {
  kind: "factura", file: "factura.pdf", number: "FN-42", date: "2026-11-14", party: "Makro", base: "34.20", vat: "3.42", total: "37.62", status: "cuadra",
  lines: [
    { code: null, description: "LIMONES MALLA", qty: "12", unit: "kg", price: "1.25", amount: "15.00" },
    { code: null, description: "TONICA SCHWEPPES 20CL", qty: "24", unit: null, price: "0.80", amount: "19.20" },
  ],
};
const ventas: ChatDocument = {
  kind: "ventas", file: "ventas.xlsx", number: null, date: "2026-11-12", party: "Vivero", base: null, vat: null, total: null, status: null,
  lines: [
    { code: "41", description: "Croquetas caseras", qty: "2", unit: "Pax", price: null, amount: "20.00" },
    { code: "90", description: "Tónica", qty: "5", unit: "Ud", price: null, amount: "25.00" },
  ],
};

async function ask(message: string, document: ChatDocument, role: "manager" | "staff" = "manager") {
  const setup = makeAgent(new FakeJev([{ coherencia: 0.95 }]));
  const events = await run(setup.agent, chat(message, { document }), role);
  return { setup, text: find(events, "done")?.text ?? "", table: find(events, "table"), draft: find(events, "draft") as DocumentDraft | undefined };
}

describe("preguntas sobre el archivo leído", () => {
  it("solo cuando la frase habla del archivo", () => {
    expect(REFERS.test("a cuanto cobra los limones esta factura")).toBe(true);
    expect(REFERS.test("que trae el pdf")).toBe(true);
    expect(REFERS.test("que facturas tenemos pendientes")).toBe(false);
    expect(REFERS.test("cuanta tonica queda")).toBe(false);
  });

  it("el precio de una línea, comparado con nuestro último precio de compra", async () => {
    const { text } = await ask("¿a cuánto nos cobra los limones esta factura?", factura);
    expect(text).toMatch(/^En esta factura, LIMONES MALLA: 12 kg × 1,25 € = 15,00 €\./);
    expect(text).toMatch(/En el catálogo, Limones no tiene precio de compra todavía\.$/);
    const coca = { ...factura, lines: [{ code: null, description: "COCA COLA 20CL", qty: "1", unit: "caja", price: "13.90", amount: "13.90" }] };
    expect((await ask("¿a cuánto cobra la coca cola esta factura?", coca)).text).toMatch(
      /^En esta factura, COCA COLA 20CL: 1 caja × 13,90 € = 13,90 €\. Nuestro último precio de Coca-Cola 20 cl: 13,20 € por caja 24 ud \(Bebidas del Sur, \d\d\/\d\d\/\d{4}\)\.$/,
    );
  });

  it("IVA, total y si cuadra", async () => {
    expect((await ask("¿cuánto es el IVA de esta factura?", factura)).text).toBe("El IVA de esta factura es 3,42 € sobre una base de 34,20 €.");
    expect((await ask("¿cuánto es el total de esta factura?", factura)).text).toBe("El total de esta factura es 37,62 € (base 34,20 € + IVA 3,42 €).");
    expect((await ask("¿cuadra esta factura?", factura)).text).toBe("Sí: las líneas de esta factura cuadran con sus totales.");
  });

  it("qué trae: sus líneas en una tabla", async () => {
    const { text, table } = await ask("¿qué trae esta factura?", factura);
    expect(text).toBe("Esta factura FN-42 de Makro, del 14/11/2026: 2 líneas.");
    expect(table?.rows.map((r) => r.d)).toEqual(["LIMONES MALLA", "TONICA SCHWEPPES 20CL"]);
  });

  it("lo que no está en el archivo se dice", async () => {
    expect((await ask("¿cuánto cobra el hielo esta factura?", factura)).text).toBe("No veo «hielo» en esta factura. Pregúntame «¿qué trae esta factura?» para ver todas sus líneas.");
  });

  it("en unas ventas: cuánto se vendió de algo", async () => {
    expect((await ask("¿cuántas croquetas se vendieron en este excel?", ventas)).text).toBe("En estas ventas: Croquetas caseras: 2 por 20,00 €.");
  });
});

describe("cargar las ventas desde el chat", () => {
  it("borrador con el local del TPV, lo enlazado y lo que no; al confirmar se cargan", async () => {
    const { setup, draft, text } = await ask("carga estas ventas", ventas);
    expect(text).toBe("He preparado la carga de las ventas. Revísalo y confírmalo si está bien.");
    expect(draft).toMatchObject({ operation: "cargar_ventas", title: "Cargar ventas del 12/11/2026", summary: "Vivero · ventas.xlsx" });
    expect(draft!.lines.slice(0, 3)).toEqual([{ label: "Artículos", qty: "2" }, { label: "Venta sin IVA", qty: "45,00 €" }, { label: "Enlazados a platos o productos", qty: "1" }]);
    expect(draft!.warnings).toContain("1 artículo queda sin enlazar (25,00 €): no tendrá coste hasta enlazarlo.");
    const result = await setup.confirmService.confirm({ orgId: ORG_ID, draftId: draft!.draftId, idempotencyKey: randomUUID() }, fixtureContext(), setup.writer);
    expect(result).toMatchObject({ ok: true, message: "Ventas del 12/11/2026 cargadas: 2 artículos.", navigate: { route: "/ventas" } });
    expect(setup.writer.calls[0]).toMatchObject({ method: "importSales", args: { orgId: ORG_ID, date: "2026-11-12", file: "ventas.xlsx" } });
  });

  it("sin permiso de ventas, el aviso de siempre", async () => {
    const { draft, text } = await ask("carga estas ventas", ventas, "staff");
    expect(draft).toBeUndefined();
    expect(text).toMatch(/^Las ventas las ve la dirección/);
  });
});
