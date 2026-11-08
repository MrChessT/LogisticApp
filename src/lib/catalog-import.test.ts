import { describe, expect, it } from "vitest";
import { parseContent, parseDays, parseNumber, parseTime, parseWorkbook, templateSheets } from "./catalog-import";
import { readXlsx, writeXlsx } from "./xlsx";

describe("importación de catálogo: valores", () => {
  it("números como los escribe la gente", () => {
    expect(parseNumber("72,60 €")).toBe(72.6);
    expect(parseNumber("1.234,5")).toBe(1234.5);
    expect(parseNumber("1,234.5")).toBe(1234.5);
    expect(parseNumber("1.500")).toBe(1500);
    expect(parseNumber("0.5")).toBe(0.5);
    expect(parseNumber("21%")).toBe(21);
    expect(parseNumber("doce")).toBeNull();
  });

  it("contenidos con su unidad y coherentes con la medida", () => {
    expect(parseContent("70 cl", "", "volume")).toEqual({ qty: 700 });
    expect(parseContent("4,2 l", "", "volume")).toEqual({ qty: 4200 });
    expect(parseContent("10", "kg", "mass")).toEqual({ qty: 10000 });
    expect(parseContent("24", "", "count")).toEqual({ qty: 24 });
    expect(parseContent("70 cl", "", "mass")).toHaveProperty("error");
    expect(parseContent("1,5", "", "count")).toHaveProperty("error");
    expect(parseContent("700", "", "volume")).toHaveProperty("error");
  });

  it("días y horas de pedido", () => {
    expect(parseDays("L, J")).toEqual([1, 4]);
    expect(parseDays("lunes y jueves")).toEqual([1, 4]);
    expect(parseDays("L-V")).toEqual([1, 2, 3, 4, 5]);
    expect(parseDays("Miércoles")).toEqual([3]);
    expect(parseDays("todos")).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(parseDays("cuando sea")).toBeNull();
    expect(parseTime("12:00")).toBe("12:00");
    expect(parseTime("9")).toBe("09:00");
    expect(parseTime("0.5")).toBe("12:00");
    expect(parseTime("25:00")).toBeNull();
  });
});

describe("importación de catálogo: plantilla", () => {
  it("la plantilla de ejemplo se lee sin errores y con todo convertido", async () => {
    const file = writeXlsx(templateSheets());
    const sheets = await readXlsx(file.buffer as ArrayBuffer);
    expect(Object.keys(sheets)).toEqual(["Instrucciones", "Proveedores", "Productos", "Surtido"]);
    const parsed = parseWorkbook(sheets);
    expect(parsed.issues).toEqual([]);
    expect(parsed.payload.suppliers[0]).toMatchObject({ code: "BAH", order_days: [1, 4], order_cutoff: "12:00", min_order: 150, locations: [] });
    expect(parsed.payload.products[0]).toMatchObject({
      sku: "GIN-01", dimension: "volume", count_pack: { name: "Botella 70 cl", qty: 700 }, purchase_pack: { qty: 4200 }, price: 72.6, full_weight_g: 1185,
    });
    expect(parsed.payload.products[1]).not.toHaveProperty("count_pack");
    expect(parsed.payload.assortment[0]).toEqual({ location: "Nombre de tu local", product: "GIN-01", min: 2, max: 6, zone: "Almacén" });
  });

  it("columnas en otro orden, con otros títulos, y errores con su fila de Excel", () => {
    const parsed = parseWorkbook({
      Articulos: [
        ["Precio", "Producto", "Categoría", "Medida", "Formato compra", "Contenido compra", "Peso lleno", "Peso vacio"],
        ["10,5", "Vermut", "Bebidas", "volumen", "Caja 6", "4,5 l", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["abc", "Whisky", "Bebidas", "litros", "Caja", "", "500", "900"],
      ],
      Minimos: [["Local", "Código", "Mínimo", "Máximo"], ["Barra", "VER-1", "6", "2"]],
    });
    expect(parsed.payload.products).toEqual([{ name: "Vermut", family: "Bebidas", dimension: "volume", purchase_pack: { name: "Caja 6", qty: 4500 }, price: 10.5 }]);
    expect(parsed.rowNumbers.products).toEqual([2]);
    expect(parsed.issues.map((i) => `${i.sheet}:${i.row}`)).toEqual(["products:4", "products:4", "products:4", "assortment:2"]);
    expect(parsed.issues.find((i) => i.sheet === "assortment")?.message).toMatch(/mínimo es mayor/);
    expect(parsed.missingSheets).toEqual(["suppliers"]);
  });

  it("la exportación vuelve a leerse igual (ida y vuelta)", async () => {
    const data = {
      suppliers: [{ code: "NOR", name: "Norte", order_days: [2, 5], order_cutoff: "11:00", lead_time_hours: 24, min_order: "200.00", locations: ["Barra", "Terraza"] }],
      products: [{ sku: "C-1", name: "Cerveza barril 30 l", family: "Bebidas", subfamily: "Cervezas", dimension: "volume", vat_rate: "21.00", count_pack: { name: "Barril 30 l", qty: "30000.0000" }, purchase_pack: { name: "Barril 30 l", qty: "30000.0000" }, supplier: "NOR", price: "72.0000" }],
      assortment: [{ location: "Barra", product: "C-1", min: "1.00", max: "4.00", zone: "Bodega" }],
    };
    const parsed = parseWorkbook(await readXlsx(writeXlsx(templateSheets(data)).buffer as ArrayBuffer));
    expect(parsed.issues).toEqual([]);
    expect(parsed.payload.suppliers[0]).toMatchObject({ code: "NOR", order_days: [2, 5], min_order: 200, locations: ["Barra", "Terraza"] });
    expect(parsed.payload.products[0]).toMatchObject({ dimension: "volume", count_pack: { qty: 30000 }, purchase_pack: { qty: 30000 }, price: 72, vat_rate: 21 });
    expect(parsed.payload.assortment[0]).toEqual({ location: "Barra", product: "C-1", min: 1, max: 4, zone: "Bodega" });
  });

  it("lee ficheros de Excel reales (comprimidos y con textos compartidos)", async () => {
    // Un .xlsx mínimo hecho con compresión deflate y sharedStrings, como los que guarda Excel.
    const { deflateRawSync } = await import("node:zlib");
    const enc = new TextEncoder();
    const parts: Record<string, string> = {
      "xl/workbook.xml": `<workbook xmlns:r="r"><sheets><sheet name="Productos" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
      "xl/sharedStrings.xml": `<sst><si><t>Nombre</t></si><si><r><t>Agua </t></r><r><t>&amp; gas</t></r></si></sst>`,
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>Precio</t></is></c></row><row r="3"><c r="A3" t="s"><v>1</v></c><c r="C3"><v>0.35</v></c></row></sheetData></worksheet>`,
    };
    const files = Object.entries(parts).map(([name, xml]) => ({ name, data: new Uint8Array(deflateRawSync(enc.encode(xml))), size: enc.encode(xml).length }));
    const sheets = await readXlsx(buildDeflatedZip(files));
    expect(sheets.Productos).toEqual([["Nombre", "", "Precio"], [], ["Agua & gas", "", "0.35"]]);
  });
});

/** Zip con entradas deflate (método 8), para probar la lectura de ficheros comprimidos. */
function buildDeflatedZip(files: Array<{ name: string; data: Uint8Array; size: number }>): ArrayBuffer {
  const enc = new TextEncoder();
  const chunks: number[] = [];
  const central: number[] = [];
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  for (const f of files) {
    const name = [...enc.encode(f.name)];
    const offset = chunks.length;
    chunks.push(...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(8), ...u16(0), ...u16(0), ...u32(0), ...u32(f.data.length), ...u32(f.size), ...u16(name.length), ...u16(0), ...name, ...f.data);
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(8), ...u16(0), ...u16(0), ...u32(0), ...u32(f.data.length), ...u32(f.size), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name);
  }
  const end = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(central.length), ...u32(chunks.length), ...u16(0)];
  return new Uint8Array([...chunks, ...central, ...end]).buffer;
}
