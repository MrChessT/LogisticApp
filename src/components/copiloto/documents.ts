// Archivos que llegan al asistente (arrastrados, pegados o elegidos): se leen en el navegador, sin subirlos, y se
// resumen en una frase. Guardar se hace después en la pantalla de cada cosa, con sus comprobaciones de siempre:
//   · foto o PDF de un albarán → Nueva recepción (proveedor, fecha, número y líneas ya puestos)
//   · PDF de una factura       → Nueva factura (número, fecha, base, IVA, total y líneas)
//   · Excel o CSV              → Importar (catálogo o escandallos) o Ventas (exportación del TPV)
import { createClient } from "@/lib/supabase/client";
import type { FileTarget } from "@/lib/pending-file";
import type { AlbaranPhotoRead } from "@/lib/albaran-ocr";
import type { DocumentoLeido } from "@/lib/documento-foto";
import type { ImportKind } from "@/lib/import-classify";
import type { ChatDocument } from "@/copiloto/contract";
import { fileKind } from "./use-file-drop";

export interface FileSummary {
  /** Lo que dice el asistente. */
  text: string;
  /** Pantalla donde se revisa y guarda, con lo ya leído (así no se vuelve a leer) y el texto del botón. */
  open?: { target: FileTarget; label: string; read?: unknown };
  /** Lo leído, para preguntar por ello en el chat («¿a cuánto cobra los limones esta factura?»). */
  doc?: ChatDocument;
  /** Lo que se adjunta en la pantalla, si no es el archivo tal cual (varias fotos unidas en una imagen). */
  attach?: File;
  /** Botones que mandan una frase al chat («Cargar aquí las ventas», «¿Ha subido algo de precio?»). */
  say?: Array<{ label: string; message: string }>;
}

/** Número a cadena decimal con punto (el formato del contrato), o null. */
const dec = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : String(Math.round(Number(v) * 1e4) / 1e4));

const money = (v: number) => `${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const fecha = (iso: string | null) => (iso ? ` del ${iso.split("-").reverse().join("/")}` : "");

async function activeSuppliers(): Promise<Array<{ id: string; name: string }>> {
  const supabase = createClient();
  const { data } = supabase ? await supabase.from("suppliers").select("id, name").eq("active", true) : { data: null };
  return (data ?? []) as Array<{ id: string; name: string }>;
}

/** Pedido enviado a ese proveedor y aún sin recibir: es lo que llega con el albarán. */
async function pendingOrderNote(supplier: { id: string; name: string }): Promise<string> {
  const supabase = createClient();
  if (!supabase) return "";
  const { data } = await supabase.from("purchase_orders").select("code, expected_date, locations(name)").eq("supplier_id", supplier.id).in("status", ["sent", "partial"]).order("expected_date", { ascending: true }).limit(3);
  const list = (data ?? []) as unknown as Array<{ code: string | null; locations: { name: string } | null }>;
  if (list.length === 1) {
    const o = list[0]!;
    return ` Tienes un pedido pendiente a ${supplier.name}${o.code ? ` (${o.code})` : ""}${o.locations?.name ? ` para ${o.locations.name}` : ""}: comprueba que lo recibido coincide.`;
  }
  return list.length > 1 ? ` Tienes ${list.length} pedidos pendientes a ${supplier.name}: comprueba a cuál corresponde.` : "";
}

async function albaranSummary(result: AlbaranPhotoRead, what: "la foto" | "el PDF"): Promise<FileSummary> {
  if (result.lines.length === 0) {
    return {
      text: what === "la foto"
        ? "No he encontrado líneas de albarán (cantidad, precio e importe) en la foto. Si es un albarán, prueba con la hoja entera, recta y con luz; o regístralo a mano en Recepciones."
        : "No he encontrado líneas de albarán (cantidad, precio e importe) en el PDF. Si es un albarán, regístralo a mano en Recepciones con el PDF adjunto.",
      open: { target: "recepcion", label: "Registrar en Recepciones" },
    };
  }
  const { guessSupplier } = await import("@/lib/albaran-ocr");
  const supplier = guessSupplier(result.texts, await activeSuppliers());
  const status = result.status === "cuadra" ? "las líneas cuadran con el total" : result.status === "parcial" ? "las líneas suman la base, pero no he visto el total" : "algo no cuadra: revisa las líneas antes de registrar";
  const lines = `${result.lines.length} ${result.lines.length === 1 ? "línea" : "líneas"} por ${money(result.linesTotal)}`;
  const total = result.total !== null ? `, total con IVA ${money(result.total)}` : "";
  const number = result.number ? ` nº ${result.number}` : "";
  const doc: ChatDocument = {
    kind: "albaran", file: "", number: result.number ?? null, date: result.date, party: supplier?.name ?? null,
    base: dec(result.base), vat: dec(result.vat), total: dec(result.total), status: result.status === "cuadra" || result.status === "parcial" ? "cuadra" : "revisar",
    lines: result.lines.map((l) => ({ code: l.ref, description: l.description, qty: dec(l.qty) ?? "0", unit: l.unit, price: dec(l.price), amount: dec(l.amount) ?? "0" })),
  };
  return {
    doc,
    say: [{ label: "¿Ha subido algo de precio?", message: "¿ha subido algo de precio en este albarán?" }],
    text: `Albarán${number}${supplier ? ` de ${supplier.name}` : " (proveedor sin identificar)"}${fecha(result.date)}: ${lines}${total}; ${status}.${supplier ? await pendingOrderNote(supplier) : ""} Ya está preparado en Recepciones, con ${what} ${what === "la foto" ? "adjunta" : "adjunto"}: revisa los productos y regístralo.`,
    open: { target: "recepcion", label: "Revisar y registrar la recepción", read: result },
  };
}

/** Albaranes sin facturar del proveedor que corresponden a la factura (por número o por suma), en una frase. */
async function receiptsFor(supplierId: string, subtotal: string | null, texts: string[]): Promise<string> {
  const supabase = createClient();
  if (!supabase) return "";
  const { data } = await supabase.from("v_unbilled_receipts").select("id, code, doc_number, doc_date, total, supplier_id").eq("supplier_id", supplierId).limit(200);
  const rows = ((data ?? []) as Array<{ id: string; code: string | null; doc_number: string | null; doc_date: string; total: number }>).map((r) => ({ id: r.id, code: r.code, docNumber: r.doc_number, date: r.doc_date, total: Number(r.total) }));
  const { proposeReceipts } = await import("@/lib/invoices");
  const base = subtotal ? Number(subtotal.replace(",", ".")) : null;
  const p = proposeReceipts(base, rows, texts);
  if (!p) return rows.length ? ` Tiene ${rows.length} ${rows.length === 1 ? "albarán" : "albaranes"} sin facturar; no he visto cuál${rows.length === 1 ? "" : "es"} corresponde${rows.length === 1 ? "" : "n"}.` : "";
  const names = rows.filter((r) => p.ids.includes(r.id)).map((r) => r.docNumber ?? r.code ?? "sin número");
  return ` Cuadra con ${p.ids.length === 1 ? "el albarán" : "los albaranes"} ${names.join(", ")} (${p.how === "numero" ? "los nombra la factura" : "suman su base"}).`;
}

async function invoiceSummary(read: DocumentoLeido): Promise<FileSummary> {
  const { camposDeFactura } = await import("@/lib/documento-foto");
  const { guessSupplier } = await import("@/lib/albaran-ocr");
  const c = camposDeFactura(read);
  const supplier = guessSupplier(read.texts, await activeSuppliers());
  const parts = [c.subtotal && `base ${c.subtotal} €`, c.vat && `IVA ${c.vat} €`, c.total && `total ${c.total} €`].filter(Boolean).join(", ");
  const lines = read.lines.length ? `${read.lines.length} ${read.lines.length === 1 ? "línea" : "líneas"}` : "sin líneas reconocidas";
  const receipts = supplier ? await receiptsFor(supplier.id, c.subtotal, read.texts.map((t) => t.text)) : "";
  const base = c.subtotal?.replace(/\./g, "").replace(",", ".") ?? null;
  const doc: ChatDocument = {
    kind: "factura", file: "", number: c.number, date: c.date, party: supplier?.name ?? null,
    base: dec(base), vat: dec(c.vat?.replace(/\./g, "").replace(",", ".")), total: dec(c.total?.replace(/\./g, "").replace(",", ".")), status: read.status,
    lines: read.lines.map((l) => ({ code: l.ref, description: l.description, qty: dec(l.qty) ?? "0", unit: l.unit, price: dec(l.price), amount: dec(l.amount) ?? "0" })),
  };
  return {
    doc,
    say: [{ label: "¿Ha subido algo de precio?", message: "¿ha subido algo de precio en esta factura?" }],
    text: `Factura${c.number ? ` ${c.number}` : ""}${supplier ? ` de ${supplier.name}` : " (proveedor sin identificar)"}${fecha(c.date)}: ${lines}${parts ? `; ${parts}` : ""}. ${c.aviso.text}${receipts} En Nueva factura queda rellena con el archivo adjunto${receipts ? " y esos albaranes marcados" : "; márcale sus albaranes para cuadrarla"}.`,
    open: { target: "factura", label: "Revisar y registrar la factura", read },
  };
}

async function pdfSummary(file: File): Promise<FileSummary> {
  const { readDocumentPdf } = await import("@/lib/documento-foto");
  const read = await readDocumentPdf(file);
  if (read.kind === "factura") return invoiceSummary(read);
  if (read.kind === "albaran" || read.lines.length > 0) {
    const { albaranDeDocumento } = await import("@/lib/albaran-pdf");
    return albaranSummary(albaranDeDocumento(read), "el PDF");
  }
  return {
    text: `No reconozco «${file.name}» como factura ni como albarán (no tiene líneas con cantidad, precio e importe${read.escaneado ? ", y es un escaneado" : ""}). Si es una factura, regístrala en Facturas con el PDF adjunto.`,
    open: { target: "factura", label: "Registrar la factura con este PDF" },
  };
}

const KIND_TEXT: Record<Exclude<ImportKind, "desconocido">, string> = { catalogo: "catálogo", escandallos: "escandallos", ventas: "ventas del TPV" };

async function sheetSummary(file: File): Promise<FileSummary> {
  const { classifyCsv, classifySheets } = await import("@/lib/import-classify");
  const csv = /\.(csv|tsv)$/i.test(file.name);
  if (!csv && !/\.xlsx$/i.test(file.name)) return { text: `«${file.name}» es una hoja en un formato que no leo: guárdala como .xlsx (Excel) o .csv y arrástrala otra vez.` };
  const { readXlsx } = await import("@/lib/xlsx");
  const book = csv ? null : await readXlsx(await file.arrayBuffer());
  const sheets = csv ? [classifyCsv(file.name, await file.text())] : classifySheets(book!);
  const known = sheets.filter((s) => s.kind !== "desconocido");
  if (known.length === 0) return { text: `No reconozco qué hay en «${file.name}»: no tiene las hojas ni las columnas del catálogo, de los escandallos ni de la exportación de ventas. En Gestión › Importar están las plantillas.` };
  const list = known.map((s) => `«${s.sheet}» (${KIND_TEXT[s.kind as keyof typeof KIND_TEXT]}${s.rows ? `, ${s.rows} filas` : ""})`).join(", ");
  const kinds = new Set(known.map((s) => s.kind));
  if (kinds.has("ventas") && book && kinds.size === 1) {
    const { parseSalesBook } = await import("@/lib/sales-import");
    const parsed = Object.values(book).map(parseSalesBook).find((p) => p && p.lines.length > 0) ?? null;
    const detail = parsed ? ` Ventas${fecha(parsed.date)}${parsed.costCentre ? ` (${parsed.costCentre})` : ""}: ${parsed.lines.length} artículos por ${money(parsed.total)}.` : "";
    const doc: ChatDocument | undefined = parsed
      ? { kind: "ventas", file: file.name.slice(0, 200), number: null, date: parsed.date, party: parsed.costCentre, base: null, vat: null, total: dec(parsed.total), status: null,
          lines: parsed.lines.slice(0, 1500).map((l) => ({ code: l.code || null, description: l.name.slice(0, 200), qty: dec(l.qty) ?? "0", unit: l.unit, price: null, amount: dec(l.amount) ?? "0" })) }
      : undefined;
    return {
      text: `«${file.name}» es una exportación de ventas del TPV.${detail} Puedo cargarlas desde aquí (te enseño antes lo que queda sin enlazar) o puedes revisarlas en Ventas. También puedes preguntarme por ellas: «¿cuántas croquetas se vendieron en este excel?».`,
      open: { target: "ventas", label: "Revisar en Ventas" },
      ...(doc ? { doc, say: [{ label: "Cargar aquí las ventas", message: "carga estas ventas" }] } : {}),
    };
  }
  if (kinds.has("ventas")) return { text: `En «${file.name}» hay ${list}. Las ventas se cargan desde Ventas y el resto desde Importar: sepáralas en archivos distintos.` };
  const what = kinds.has("catalogo") ? "catalogo" : "escandallos";
  return {
    text: `En «${file.name}» hay ${list}. En Importar ves exactamente qué cambia antes de guardar nada.`,
    open: { target: "importar", label: what === "catalogo" ? "Revisar la importación del catálogo" : "Revisar los escandallos", read: what },
  };
}

/** Varias fotos de un mismo documento: se leen como uno solo y se adjuntan unidas. */
async function pagesSummary(files: File[]): Promise<FileSummary> {
  const { readDocumentPages } = await import("@/lib/documento-foto");
  const { read, file } = await readDocumentPages(files);
  const { albaranDeDocumento } = await import("@/lib/albaran-pdf");
  const summary = read.kind === "factura" ? await invoiceSummary(read) : await albaranSummary(albaranDeDocumento(read), "la foto");
  return { ...summary, text: `${files.length} fotos leídas como un solo documento. ${summary.text}`, attach: file };
}

/**
 * Lee y resume lo que llega al chat. Varias fotos juntas son las páginas de un documento; con otros archivos mezclados
 * se lee el primero. Lanza si el navegador no puede abrirlo.
 */
export async function summarizeFiles(files: File[]): Promise<FileSummary> {
  const images = files.filter((f) => fileKind(f) === "imagen");
  if (files.length > 1 && images.length === files.length) return withName(await pagesSummary(images), files[0]!);
  const summary = await summarizeFile(files[0]!);
  return files.length > 1 ? { ...summary, text: `${summary.text} (He leído solo «${files[0]!.name}»: dame los demás archivos de uno en uno.)` } : summary;
}

function withName(summary: FileSummary, file: File): FileSummary {
  return summary.doc ? { ...summary, doc: { ...summary.doc, file: (file.name || "fotos").slice(0, 200) } } : summary;
}

async function summarizeFile(file: File): Promise<FileSummary> {
  const summary = await summarize(file);
  return summary.doc ? { ...summary, doc: { ...summary.doc, file: (file.name || summary.doc.file || "archivo").slice(0, 200) } } : summary;
}

async function summarize(file: File): Promise<FileSummary> {
  const kind = fileKind(file);
  if (kind === "imagen") {
    const { readAlbaranPhoto } = await import("@/lib/albaran-ocr");
    return albaranSummary(await readAlbaranPhoto(file), "la foto");
  }
  if (kind === "pdf") return pdfSummary(file);
  if (kind === "hoja") return sheetSummary(file);
  return { text: `No sé leer «${file.name || "el archivo"}». Puedo leer fotos y PDF de albaranes y facturas, y hojas de Excel o CSV del catálogo, los escandallos o las ventas del TPV.` };
}
