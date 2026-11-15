import Decimal from "decimal.js";
import { guessSupplier, type AlbaranPhotoRead } from "@/lib/albaran-ocr";
import type { OcrText } from "@/lib/albaran-reader";
import { descripcionDeRecorte, fechaDeRecorte, lineasDeRecorte, numeroDeRecorte, proveedorDeRecorte, textoDeRecorte } from "@/lib/albaran-recorte";
import { matchReadLines, type ReceiptLine } from "./receipt-lines";

// Qué se hace con lo leído en un recuadro de la foto, según lo que la persona buscaba. Devuelve el mensaje que se
// le enseña. Nada se guarda: solo se rellena la recepción, que se revisa y se registra como siempre.

export type PickTarget = "supplier" | "number" | "date" | "line" | "product";

export type PickContext = {
  suppliers: Array<{ id: string; name: string }>;
  rSupplier: string;
  rLocation: string;
  rLines: ReceiptLine[];
  setRLines: (lines: ReceiptLine[]) => void;
  setRSupplier: (id: string) => void;
  setRDocNumber: (value: string) => void;
  setRDocDate: (value: string) => void;
  /** Nombre leído de un proveedor que no está dado de alta: se ofrece crearlo. */
  setSupplierHint: (name: string) => void;
};

const isBlank = (l: ReceiptLine) => !l.product && !l.read && !l.qty && !l.price;

type Read = NonNullable<ReceiptLine["read"]>;

/** Lo mínimo de una lectura para emparejar sus líneas con el catálogo. */
function readOf(reads: Read[]): AlbaranPhotoRead {
  return {
    lines: reads.map((r) => ({ ref: r.code, description: r.description, qty: r.qty, unit: r.unit, price: r.price, discountPct: r.discountPct, amount: r.amount, lot: r.lot })),
    linesTotal: reads.reduce((s, r) => new Decimal(s).plus(r.amount).toNumber(), 0), base: null, vatRate: null, vat: null, total: null, headerDiscountPct: null, status: "no_cuadra", date: null, texts: [],
  };
}

export async function applyPick(target: PickTarget, texts: OcrText[], lineIndex: number, ctx: PickContext): Promise<string> {
  const text = textoDeRecorte(texts);
  if (target === "supplier") {
    const found = guessSupplier(texts, ctx.suppliers);
    if (found) {
      ctx.setRSupplier(found.id);
      return `Proveedor: ${found.name}.`;
    }
    const name = proveedorDeRecorte(text);
    if (!name) return `No he leído un nombre en el recuadro («${text}»). Ajústalo y prueba otra vez.`;
    ctx.setRSupplier("");
    ctx.setSupplierHint(name);
    return `«${name}» no está dado de alta. Puedes crearlo en la recepción, con el botón «Crear proveedor».`;
  }
  if (target === "number") {
    const number = numeroDeRecorte(text);
    if (!number) return `No he leído un número en el recuadro («${text}»). Señala solo el número del albarán.`;
    ctx.setRDocNumber(number);
    return `Nº de albarán: ${number}.`;
  }
  if (target === "date") {
    const iso = fechaDeRecorte(text);
    if (!iso) return `No he leído una fecha en el recuadro («${text}»).`;
    ctx.setRDocDate(iso);
    return `Fecha: ${iso.split("-").reverse().join("/")}.`;
  }
  if (target === "line") {
    const found = lineasDeRecorte(texts);
    if (found.length === 0) return "No he leído cantidad, precio e importe que cuadren en el recuadro. Señala la línea entera, de la descripción al importe.";
    const reads: Read[] = found.map((l) => ({ code: l.ref, description: l.description, qty: Number(l.qty), unit: l.unit, price: Number(l.price), discountPct: l.discountPct ? Number(l.discountPct) : null, amount: Number(l.amount), lot: null }));
    const added = await matchReadLines(readOf(reads), ctx.rSupplier, ctx.rLocation);
    ctx.setRLines([...ctx.rLines.filter((l) => !isBlank(l)), ...added]);
    const without = added.filter((l) => !l.product).length;
    return `${added.length === 1 ? "Línea añadida" : `${added.length} líneas añadidas`}: ${found.map((l) => l.description || "(sin descripción)").join(" · ")}.${without ? ` ${without === 1 ? "Falta" : "Faltan"} el producto: elígelo o créalo en ${without === 1 ? "la línea" : "las líneas"}.` : ""}`;
  }
  // product: la descripción de una línea que ya está en la recepción.
  const current = ctx.rLines[lineIndex];
  if (!current) return "Elige la línea de la recepción a la que corresponde.";
  const description = descripcionDeRecorte(text);
  if (!description) return `No he leído un nombre en el recuadro («${text}»).`;
  const qty = Number(current.qty) || 0;
  const price = Number(current.price) || 0;
  const read = { ...(current.read ?? { code: null, qty, unit: null, price, discountPct: null, amount: new Decimal(qty).mul(price).toNumber(), lot: null }), description };
  const [matched] = await matchReadLines(readOf([read]), ctx.rSupplier, ctx.rLocation);
  ctx.setRLines(ctx.rLines.map((l, i) => (i === lineIndex ? { ...l, read, product: matched?.product ?? l.product, packId: matched?.product ? matched.packId : l.packId } : l)));
  return matched?.product ? `Línea ${lineIndex + 1}: ${matched.product.name}.` : `Línea ${lineIndex + 1}: «${description}». No está en el catálogo: puedes crearlo en la línea.`;
}
