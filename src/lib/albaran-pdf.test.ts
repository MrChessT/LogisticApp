import { describe, expect, it } from "vitest";
import { readDocumentText } from "./documento-texto";
import { albaranDeDocumento } from "./albaran-pdf";

describe("albaranDeDocumento", () => {
  it("pasa la lectura de un PDF a la forma de la foto, con número y estado", () => {
    const texto = ["Distribuciones Ejemplo SL", "Albarán A-117", "Fecha 12/11/2026", "2 Tónica botella 10,00 20,00", "3 Limones 2,00 6,00", "Base imponible 26,00", "IVA 10% 2,60", "Total 28,60"].join("\n");
    const leido = readDocumentText(texto);
    const r = albaranDeDocumento({ ...leido, texts: texto.split("\n").map((text) => ({ text, box: [] })) });
    expect(r.lines.map((l) => [l.qty, l.description, l.price, l.amount])).toEqual([[2, "Tónica botella", 10, 20], [3, "Limones", 2, 6]]);
    expect([r.number, r.date, r.base, r.vatRate, r.vat, r.total, r.status]).toEqual([leido.number, "2026-11-12", 26, 10, 2.6, 28.6, leido.status === "cuadra" ? "cuadra" : "no_cuadra"]);
  });
});
