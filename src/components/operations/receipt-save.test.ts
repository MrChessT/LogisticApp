import { describe, expect, it } from "vitest";
import type { LookupProduct } from "@/lib/product-lookup";
import type { ReceiptLine } from "./receipt-lines";
import { checkReceiptLines } from "./receipt-save";

const product = { id: "p1", name: "Harina", dimension: "mass", base_unit: "g", category: null, family: null, in_location: true, stock: null, packs: [] } as LookupProduct;
const line = (over: Partial<ReceiptLine>): ReceiptLine => ({ product, packId: "k1", qty: "2", price: "3,50", incident: "", ...over });
const blank: ReceiptLine = { product: null, packId: "", qty: "", price: "", incident: "" };

describe("líneas de una recepción antes de registrar", () => {
  it("una línea completa se envía (coma decimal incluida) y la fila vacía se ignora", () => {
    expect(checkReceiptLines([line({}), blank])).toEqual({ lines: [{ pack_id: "k1", packs_qty: "2", pack_price: "3.5", incident: null }] });
  });
  it.each([
    ["sin producto", line({ product: null, packId: "" }), /no tiene producto/],
    ["sin formato", line({ packId: "" }), /Elige el formato de Harina/],
    ["cantidad cero", line({ qty: "0" }), /cantidad de Harina/],
    ["cantidad no numérica", line({ qty: "dos" }), /cantidad de Harina/],
    ["sin precio", line({ price: "" }), /Falta el precio de Harina/],
    ["precio negativo", line({ price: "-1" }), /precio de Harina/],
  ])("una línea válida junto a otra %s no registra nada", (_caso, bad, message) => {
    const r = checkReceiptLines([line({}), bad]);
    expect("error" in r && r.error).toMatch(message);
  });
  it("sin ninguna línea con datos pide añadir una", () => {
    const r = checkReceiptLines([blank]);
    expect("error" in r && r.error).toMatch(/Añade al menos una línea/);
  });
});
