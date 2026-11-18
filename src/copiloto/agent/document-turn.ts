// Preguntas sobre el último archivo que se dio al chat (factura, albarán o exportación del TPV), con lo que ya leyó el
// navegador y viaja en la petición (ChatRequest.document): «¿a cuánto cobra los limones esta factura?», «¿cuánto es el
// IVA de este albarán?», «¿qué trae esta factura?», «¿cuántas croquetas se vendieron en este excel?». Con la línea, se
// compara con nuestro último precio de compra. «Carga estas ventas» prepara el borrador (sales-import-builder.ts).
// Solo responde si la frase se refiere al archivo («esta factura», «el pdf», «ahí»): si no, sigue el camino de siempre.
import Decimal from "decimal.js";
import type { ChatDocument, ChatRequest, Emit, TableEvent } from "../contract/index";
import type { SessionContext } from "../domain";
import { normalize, STOPWORDS, tokenize } from "../entities/normalize";
import type { Retriever } from "../entities/retriever";
import { formatMoney } from "../entities/units";
import type { DraftStore } from "../drafts/store";
import { salesImport } from "../drafts/sales-import-builder";
import type { InfoSource } from "../tools/info";
import type { InventoryDataSource } from "../tools/types";
import { productsNamed } from "./product-facts";
import { compareDocuments } from "./document-compare";
import { priceChanges, priceChangesText } from "./document-prices";
import type { Session, SessionStore } from "./session";

export interface DocumentTurn {
  req: ChatRequest;
  ctx: SessionContext;
  session: Session;
  messageId: string;
  now: Date;
  elapsed: number;
  sessions: SessionStore;
  drafts: DraftStore;
  info?: InfoSource;
  retriever?: Retriever;
  source: InventoryDataSource;
  emit: Emit;
}

const NOUN = "archivo|documento|factura|albaran|pdf|excel|hoja|fichero|exportacion|ventas|foto";
/** «Esta factura», «el pdf», «en el archivo», «ahí»: la frase habla del archivo, no de lo guardado. */
export const REFERS = new RegExp(`\\b(este|esta|estos|estas|ese|esa|esos|esas)\\s+(${NOUN})\\b|\\b(el|del|en el)\\s+(archivo|documento|pdf|excel|fichero)\\b|\\bahi\\b|\\ben el\\b$`);
const LOAD = /\b(carga|cargar|cargalas|cargala|guarda|guardar|guardalas|importa|importar|importalas|sube|subir|registra|registrar|registralas|mete|meter)\b/;
const DOC_WORDS = new Set(["factura", "albaran", "archivo", "documento", "pdf", "excel", "hoja", "fichero", "exportacion", "foto", "este", "esta", "estos", "estas", "ese", "esa", "cobra", "cobran", "cobrado", "cuesta", "cuestan", "vale", "valen", "pone", "viene", "vienen", "trae", "lleva", "ventas", "vendio", "vendieron", "vendimos", "vendido", "unidades", "importe", "total", "iva", "base", "linea", "lineas", "ahi", "sale", "salen", "nos", "les", "cada", "unidad", "kilo", "proveedor", "precio", "precios"]);

/** «¿Ha subido algo?», «¿qué está más caro?», «compara los precios»: cada línea contra nuestro último precio. */
const PRICE_CHANGE = /\b(subid[oa]s?|sube|suben|subio|subieron|mas car[oa]s?|encarec\w*|bajad[oa]s?|bajo|bajaron|mas barat[oa]s?|ha cambiado|han cambiado|compara|comparar|comparalo|comparalos)\b/;
const PRICE_WORDS = new Set(["subido", "subida", "subidos", "subidas", "sube", "suben", "subio", "subieron", "caro", "cara", "caros", "caras", "encarecido", "bajado", "bajada", "bajo", "bajaron", "barato", "barata", "baratos", "baratas", "cambiado", "compara", "comparar", "comparalo", "comparalos", "algo", "nuestro", "nuestros", "ultimo"]);
/** «¿Cuadra la factura con el albarán?»: nombra los dos (o «cuadran» con los dos leídos). */
const BOTH = /\bfactura\b.*\balbaran\b|\balbaran\b.*\bfactura\b|\b(cuadran|coinciden|compara(?:los)?)\b/;

const clean = (s: string) => normalize(s).replace(/[¿?¡!.,;:«»"()]/g, " ").replace(/\s+/g, " ").trim();
const words = (s: string) => tokenize(s).filter((w) => w.length > 2 && !STOPWORDS.has(w) && !DOC_WORDS.has(w));
const near = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b.slice(0, 5)) || b.startsWith(a.slice(0, 5))));
const qtyText = (v: string) => new Decimal(v).toDecimalPlaces(3).toString().replace(".", ",");
const fecha = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "sin fecha");

/** Líneas que nombran lo dicho: todas las palabras; si ninguna las tiene todas, las que tienen alguna. */
function linesFor(said: string[], doc: ChatDocument): ChatDocument["lines"] {
  if (said.length === 0) return [];
  const has = (l: ChatDocument["lines"][number], w: string) => words(`${l.description} ${l.code ?? ""}`).some((d) => near(w, d));
  const all = doc.lines.filter((l) => said.every((w) => has(l, w)));
  return all.length ? all : doc.lines.filter((l) => said.some((w) => has(l, w)));
}

function table(doc: ChatDocument, lines: ChatDocument["lines"]): TableEvent {
  const sales = doc.kind === "ventas";
  return {
    columns: [
      { key: "d", label: sales ? "Artículo" : "Descripción" },
      { key: "q", label: "Cantidad", align: "right" },
      ...(sales ? [] : [{ key: "p", label: "Precio", align: "right" as const }]),
      { key: "a", label: "Importe", align: "right" },
    ],
    rows: lines.slice(0, 40).map((l) => ({ d: l.description, q: `${qtyText(l.qty)}${l.unit ? ` ${l.unit}` : ""}`, ...(sales ? {} : { p: l.price ? formatMoney(l.price) : "—" }), a: formatMoney(l.amount) })),
    ...(lines.length > 40 ? { more: lines.length - 40 } : {}),
  };
}

/** Nuestro último precio de compra del producto que es esa línea (si se reconoce uno solo). */
async function ourPrice(description: string, input: DocumentTurn): Promise<string> {
  if (!input.ctx.seesCosts || !input.retriever) return "";
  const products = await productsNamed(description, input.ctx, input.retriever, 2).catch(() => []);
  if (products.length !== 1) return "";
  const product = products[0]!;
  const packs = product.packs.filter((p) => p.isPurchaseDefault).map((p) => p.id);
  const prices = packs.length ? await input.source.supplierPrices(packs).catch(() => []) : [];
  const last = prices.sort((a, b) => (b.lastPriceAt ?? "").localeCompare(a.lastPriceAt ?? ""))[0];
  if (!last) return ` En el catálogo, ${product.name} no tiene precio de compra todavía.`;
  const pack = product.packs.find((p) => p.id === last.packId);
  return ` Nuestro último precio de ${product.name}: ${formatMoney(last.lastPrice)} ${pack ? `por ${pack.name.toLowerCase()}` : ""} (${last.supplierName}${last.lastPriceAt ? `, ${fecha(last.lastPriceAt.slice(0, 10))}` : ""}).`;
}

async function answer(doc: ChatDocument, text: string, input: DocumentTurn): Promise<{ text: string; table?: TableEvent }> {
  const what = doc.kind === "factura" ? "esta factura" : doc.kind === "albaran" ? "este albarán" : "estas ventas";
  const priceAsk = doc.kind !== "ventas" && PRICE_CHANGE.test(text);
  const said = words(text).filter((w) => !priceAsk || !PRICE_WORDS.has(w));
  const found = linesFor(said, doc);
  if (priceAsk) {
    if (!input.ctx.seesCosts) return { text: "Los precios de compra los ve la dirección (propiedad, administración y encargados) con el permiso «ve costes»." };
    if (!input.retriever) return { text: "El catálogo no está disponible ahora mismo." };
    return { text: priceChangesText(what, await priceChanges(found.length ? found : doc.lines, input.ctx, input.retriever, input.source)) };
  }
  if (found.length > 0 && found.length <= 8) {
    if (doc.kind === "ventas") {
      const qty = found.reduce((s, l) => s.plus(l.qty), new Decimal(0));
      const amount = found.reduce((s, l) => s.plus(l.amount), new Decimal(0));
      const detail = found.map((l) => `${l.description}: ${qtyText(l.qty)} por ${formatMoney(l.amount)}`).join("; ");
      return { text: found.length === 1 ? `En ${what}: ${detail}.` : `En ${what}: ${detail}. En total, ${qtyText(qty.toString())} por ${formatMoney(amount)}.` };
    }
    const detail = found.map((l) => `${l.description}: ${qtyText(l.qty)}${l.unit ? ` ${l.unit}` : ""} × ${l.price ? formatMoney(l.price) : "—"} = ${formatMoney(l.amount)}`).join("; ");
    const compare = found.length === 1 ? await ourPrice(found[0]!.description, input) : "";
    return { text: `En ${what}, ${detail}.${compare}` };
  }
  if (found.length > 8) return { text: `En ${what} hay ${found.length} líneas con eso:`, table: table(doc, found) };
  if (said.length > 0 && !/\b(total|iva|base|cuadra|fecha|numero|proveedor|lineas|trae|lleva|pone)\b/.test(text)) {
    return { text: `No veo «${said.join(" ")}» en ${what}. Pregúntame «¿qué trae ${what}?» para ver todas sus líneas.` };
  }
  if (/\biva\b/.test(text)) return { text: doc.vat ? `El IVA de ${what} es ${formatMoney(doc.vat)}${doc.base ? ` sobre una base de ${formatMoney(doc.base)}` : ""}.` : `No he leído el IVA en ${what}.` };
  if (/\bbase\b/.test(text)) return { text: doc.base ? `La base de ${what} (sin IVA) es ${formatMoney(doc.base)}.` : `No he leído la base en ${what}.` };
  if (/\b(cuadra|bien|correct\w*|revis\w*)\b/.test(text)) {
    return { text: doc.status === "cuadra" ? `Sí: las líneas de ${what} cuadran con sus totales.` : doc.status === "revisar" ? `No del todo: algo no cuadra entre las líneas y los totales de ${what}. Revísalo antes de registrarlo.` : `No he reconocido sus líneas, así que no puedo comprobarlo.` };
  }
  if (/\b(fecha|cuando|dia)\b/.test(text)) return { text: `${what[0]!.toUpperCase()}${what.slice(1)} ${doc.kind === "ventas" ? "son" : "es"} del ${fecha(doc.date)}.` };
  if (/\b(numero|n[ºo])\b/.test(text)) return { text: doc.number ? `El número es ${doc.number}.` : `No he leído el número en ${what}.` };
  if (/\b(proveedor|quien|empresa|local)\b/.test(text)) return { text: doc.party ? `${doc.kind === "ventas" ? "Centro de coste" : "Proveedor"}: ${doc.party}.` : `No he reconocido ${doc.kind === "ventas" ? "el local" : "el proveedor"} en ${what}.` };
  if (/\b(total|cuanto)\b/.test(text) && !/\b(lineas|trae|lleva|pone)\b/.test(text)) {
    const sum = doc.lines.reduce((s, l) => s.plus(l.amount), new Decimal(0));
    return { text: doc.total ? `El total de ${what} es ${formatMoney(doc.total)}${doc.base ? ` (base ${formatMoney(doc.base)}${doc.vat ? ` + IVA ${formatMoney(doc.vat)}` : ""})` : ""}.` : `Las líneas de ${what} suman ${formatMoney(sum)}${doc.kind === "ventas" ? " sin IVA" : ""}.` };
  }
  return { text: `${doc.kind === "ventas" ? `Ventas del ${fecha(doc.date)}` : `${what[0]!.toUpperCase()}${what.slice(1)}${doc.number ? ` ${doc.number}` : ""}${doc.party ? ` de ${doc.party}` : ""}, del ${fecha(doc.date)}`}: ${doc.lines.length} líneas.`, table: table(doc, doc.lines) };
}

/** Responde sobre el archivo si la frase se refiere a él (o carga las ventas). false: sigue el camino de siempre. */
export async function documentTurn(input: DocumentTurn): Promise<boolean> {
  const { req, ctx, session, messageId, now, sessions, emit } = input;
  const doc = req.document;
  if (!doc) return false;
  const text = clean(req.message);
  const load = doc.kind === "ventas" && LOAD.test(text) && /\b(ventas|esto|estas|archivo|excel|exportacion|fichero)\b/.test(text);
  const other = req.otherDocument;
  const pair = !!other && doc.kind !== "ventas" && other.kind !== doc.kind && other.kind !== "ventas" && BOTH.test(text);
  if (!load && !pair && !REFERS.test(text)) return false;

  let reply: { text: string; table?: TableEvent };
  if (load) {
    const built = await salesImport({ doc, message: req.message, ctx, info: input.info, ...(req.pageContext?.locationId ? { pageLocationId: req.pageContext.locationId } : {}), now });
    if (built.kind === "draft") {
      await input.drafts.save({ draft: built.draft, orgId: ctx.orgId, userId: ctx.userId, messageId, request: req.message });
      await emit({ event: "draft", data: built.draft });
      reply = { text: "He preparado la carga de las ventas. Revísalo y confírmalo si está bien." };
    } else reply = { text: built.kind === "error" ? built.message : "No he podido preparar la carga de las ventas." };
  } else reply = pair ? compareDocuments(doc, other!) : await answer(doc, text, input);

  sessions.addTurn(session, { role: "user", text: req.message });
  sessions.addTurn(session, { role: "assistant", text: reply.text });
  await sessions.save(req.sessionId, ctx.orgId, session).catch(() => undefined);
  if (reply.table) await emit({ event: "table", data: reply.table });
  await emit({ event: "text", data: { delta: reply.text, reset: true } });
  await emit({ event: "done", data: { messageId, text: reply.text, textSource: "plantilla", latencyMs: input.elapsed, showText: true } });
  return true;
}
