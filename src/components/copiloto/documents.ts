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
import { fileKind } from "./use-file-drop";

export interface FileSummary {
  /** Lo que dice el asistente. */
  text: string;
  /** Pantalla donde se revisa y guarda, con lo ya leído (así no se vuelve a leer) y el texto del botón. */
  open?: { target: FileTarget; label: string; read?: unknown };
}

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
  return {
    text: `Albarán${number}${supplier ? ` de ${supplier.name}` : " (proveedor sin identificar)"}${fecha(result.date)}: ${lines}${total}; ${status}.${supplier ? await pendingOrderNote(supplier) : ""} Ya está preparado en Recepciones, con ${what} adjunto: revisa los productos y regístralo.`,
    open: { target: "recepcion", label: "Revisar y registrar la recepción", read: result },
  };
}

async function invoiceSummary(read: DocumentoLeido): Promise<FileSummary> {
  const { camposDeFactura } = await import("@/lib/documento-foto");
  const { guessSupplier } = await import("@/lib/albaran-ocr");
  const c = camposDeFactura(read);
  const supplier = guessSupplier(read.texts, await activeSuppliers());
  const parts = [c.subtotal && `base ${c.subtotal} €`, c.vat && `IVA ${c.vat} €`, c.total && `total ${c.total} €`].filter(Boolean).join(", ");
  const lines = read.lines.length ? `${read.lines.length} ${read.lines.length === 1 ? "línea" : "líneas"}` : "sin líneas reconocidas";
  return {
    text: `Factura${c.number ? ` ${c.number}` : ""}${supplier ? ` de ${supplier.name}` : " (proveedor sin identificar)"}${fecha(c.date)}: ${lines}${parts ? `; ${parts}` : ""}. ${c.aviso.text} En Nueva factura queda rellena con el PDF adjunto; márcale sus albaranes para cuadrarla.`,
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
    return { text: `«${file.name}» es una exportación de ventas del TPV.${detail} En Ventas ves qué artículos están enlazados a sus platos antes de guardarla.`, open: { target: "ventas", label: "Revisar y cargar las ventas" } };
  }
  if (kinds.has("ventas")) return { text: `En «${file.name}» hay ${list}. Las ventas se cargan desde Ventas y el resto desde Importar: sepáralas en archivos distintos.` };
  const what = kinds.has("catalogo") ? "catalogo" : "escandallos";
  return {
    text: `En «${file.name}» hay ${list}. En Importar ves exactamente qué cambia antes de guardar nada.`,
    open: { target: "importar", label: what === "catalogo" ? "Revisar la importación del catálogo" : "Revisar los escandallos", read: what },
  };
}

/** Lee y resume un archivo. Lanza si el navegador no puede abrirlo. */
export async function summarizeFile(file: File): Promise<FileSummary> {
  const kind = fileKind(file);
  if (kind === "imagen") {
    const { readAlbaranPhoto } = await import("@/lib/albaran-ocr");
    return albaranSummary(await readAlbaranPhoto(file), "la foto");
  }
  if (kind === "pdf") return pdfSummary(file);
  if (kind === "hoja") return sheetSummary(file);
  return { text: `No sé leer «${file.name || "el archivo"}». Puedo leer fotos y PDF de albaranes y facturas, y hojas de Excel o CSV del catálogo, los escandallos o las ventas del TPV.` };
}
