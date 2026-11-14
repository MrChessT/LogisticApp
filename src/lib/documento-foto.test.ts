import { describe, expect, it } from "vitest";
import { camposDeFactura } from "./documento-foto";
import { readDocumentText } from "./documento-texto";

describe("campos de factura desde una lectura", () => {
  it("una factura que cuadra rellena número, fecha, base, IVA y total", () => {
    const r = readDocumentText(["Factura F-2024/3", "Fecha 02/03/2024", "2 Harina de trigo 3,00 6,00", "Subtotal 6,00", "IVA 21% 1,26", "Total 7,26"].join("\n"));
    expect(camposDeFactura(r)).toEqual({
      number: "F-2024/3", date: "2024-03-02", subtotal: "6,00", vat: "1,26", total: "7,26",
      aviso: { ok: true, text: "Lectura cuadrada. Revisa los datos antes de registrar." },
    });
  });

  it("varios tipos de IVA se suman en una sola cuota", () => {
    const r = readDocumentText(["Factura F-9", "Fecha 01/01/2024", "Base 100,00", "IVA 10% 10,00", "IVA 21% 21,00", "Total 131,00"].join("\n"));
    expect([camposDeFactura(r).vat, camposDeFactura(r).total]).toEqual(["31,00", "131,00"]);
  });

  it("sin líneas no inventa importes y avisa", () => {
    const c = camposDeFactura(readDocumentText(["Factura F-1", "Total 7,26"].join("\n")));
    expect(c.subtotal).toBeNull();
    expect(c.total).toBe("7,26");
    expect(c.aviso.ok).toBe(false);
  });

  it("si no cuadra, lo dice y repite el motivo", () => {
    const c = camposDeFactura(readDocumentText(["Factura F-2", "2 Harina 3,00 6,00", "Subtotal 6,00", "IVA 21% 1,26", "Total 9,00"].join("\n")));
    expect(c.aviso.ok).toBe(false);
    expect(c.aviso.text).toMatch(/^La lectura no cuadra/);
  });
});
