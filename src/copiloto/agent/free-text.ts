// Respuesta escrita a mano a una aclaración abierta. Se intenta entender como respuesta a ESA
// pregunta (una de sus opciones o una cantidad) para no tener que reinterpretar la orden entera.
import type { ClarifyField } from "../contract/index";
import type { SessionContext } from "../domain";
import { tokenize } from "../entities/normalize";
import { asChoice } from "../gates/gate";
import { canonicalUnit, parseNumber } from "../entities/quantity-parser";
import { tokenSimilarity } from "../entities/retriever";
import { packMatchesUnit } from "../entities/units";
import type { PendingClarify } from "./session";

export type FreeTextAnswer =
  /** Equivale a pulsar esa opción. */
  | { kind: "option"; optionId: string }
  /** Cantidad (y unidad, si la dice) para la pregunta «¿qué cantidad?». */
  | { kind: "quantity"; amount: string; unit: string | null }
  /** Precio para «¿cuál es el nuevo precio?» («a 1,50», «12,97 €»). */
  | { kind: "price"; amount: string }
  /** «déjalo», «cancela», «nada»: se abandona la pregunta. */
  | { kind: "cancel" }
  | { kind: "unknown" };

/**
 * Preguntas sobre un dato de la orden (qué producto, cuánto, qué local): si lo escrito no encaja con
 * ninguna opción, se añade a la orden original. En el resto (qué operación, qué pantalla, «¿lo
 * confirmo?») lo escrito se trata como un mensaje nuevo: así una orden distinta no arrastra la anterior.
 */
export const ENTITY_FIELDS: ReadonlySet<ClarifyField> = new Set(["producto", "cantidad", "precio", "local", "local_destino", "espacio", "formato"]);

/**
 * Preguntas cuya respuesta es un nombre libre («¿Cómo se llama el producto nuevo?», «si no, escríbeme el
 * nombre correcto»): lo escrito ES la respuesta. Tratarlo como mensaje nuevo dejaba al asistente sin
 * saber qué se pedía («Prueba Luis» → «¿Qué quieres hacer?») y en bucle.
 */
export const NAME_FIELDS: ReadonlySet<ClarifyField> = new Set(["nombre", "sentido"]);

/** Operaciones que se reconocen por sus palabras (ids de tipo_accion en el catálogo de Jev). */
export type Operation = "merma" | "traspaso" | "recepcion" | "preparar_pedido" | "abrir_inventario" | "nuevo_producto" | "cambiar_precio" | "archivar_producto";

const OPERATION_WORDS: Array<[Operation, RegExp]> = [
  ["merma", /\b(merma|mermas|rotura|roturas)\b/],
  ["traspaso", /\b(traspaso|traspasos|traspasar)\b/],
  ["recepcion", /\b(recepcion|recepciones|albaran|albaranes)\b/],
  ["preparar_pedido", /\b(pedido|pedidos)\b/],
  ["abrir_inventario", /\b(inventario|inventarios|recuento|conteo)\b/],
  ["nuevo_producto", /\b(nuevo producto|producto nuevo|nueva referencia|dar de alta|alta (de |del )?(un |una )?producto|(crea|crear|creame|anade|anadir|agrega|agregar|registra|registrar|mete|meter) (un |una |el |la )?(nuevo |nueva )?(producto|referencia|articulo))\b/],
  ["cambiar_precio", /\b(cambia|cambiar|pon|poner|actualiza|actualizar) (el |la )?precio\b/],
  ["archivar_producto", /\b(archiva|archivar|desactiva|desactivar)\b/],
];

/** La operación que nombra el texto («crear producto nuevo», «registrar merma»), si nombra una. */
export function operationOf(text: string): Operation | null {
  const norm = tokenize(text).join(" ");
  return OPERATION_WORDS.find(([, re]) => re.test(norm))?.[0] ?? null;
}

/** Palabras que acompañan al nombre de una operación sin añadir datos («quiero registrar una merma»). */
const OPERATION_FILLERS = new Set([
  "quiero", "queria", "quisiera", "necesito", "vamos", "voy", "a", "hacer", "haz", "hazme", "registrar", "registra", "apuntar", "apunta",
  "anotar", "anota", "crear", "crea", "creame", "preparar", "prepara", "preparame", "abrir", "abre", "empezar", "empieza", "nuevo", "nueva",
  "un", "una", "el", "la", "de", "del", "otro", "otra", "me", "por", "favor", "porfa", "porfavor", "alta", "dar", "producto", "referencia",
  "articulo", "anadir", "anade", "agregar", "agrega", "meter", "mete", "una", "ahora",
]);

/**
 * El mensaje solo dice qué operación quiere («merma», «registrar merma», «nuevo producto»): se empieza esa
 * operación preguntando lo que falte. Antes Jev lo leía como charla y contestaba con la presentación.
 */
export function operationOnly(message: string): Operation | null {
  const words = tokenize(message);
  const op = operationOf(message);
  if (!op || words.length === 0 || words.length > 6) return null;
  // «pedidos» o «inventarios» sueltos suelen ser consultas («¿qué pedidos hay?»): solo con un verbo.
  if ((op === "preparar_pedido" || op === "abrir_inventario") && !words.some((w) => ["hacer", "haz", "hazme", "preparar", "prepara", "preparame", "abrir", "abre", "empezar", "empieza", "nuevo", "nueva"].includes(w))) return null;
  const opWords = new Set(["merma", "mermas", "rotura", "roturas", "traspaso", "traspasos", "traspasar", "recepcion", "recepciones", "albaran", "pedido", "inventario", "recuento", "conteo"]);
  return words.every((w) => opWords.has(w) || OPERATION_FILLERS.has(w)) ? op : null;
}

/** La operación de la orden que espera respuesta (la que se forzó al aclarar o la que eligió Jev). */
function pendingOperation(pending: PendingClarify): string | null {
  return pending.overrides.tipo_accion ?? asChoice(pending.routing?.jev.answers.tipo_accion)?.choice ?? null;
}

/**
 * Lo escrito pide OTRA operación («crear producto nuevo» mientras se preguntaba el producto de una merma):
 * es una orden nueva. Pegarlo a la anterior hacía que «registrar merma… crear producto» creara «Merma».
 */
export function changesOperation(text: string, pending: PendingClarify): boolean {
  const op = operationOf(text);
  return op !== null && op !== pendingOperation(pending);
}

const YES = new Set(["si", "vale", "ok", "okay", "venga", "adelante", "correcto", "exacto", "eso", "confirma", "confirmalo", "hazlo", "dale", "perfecto"]);

function isYes(text: string): boolean {
  const words = tokenize(text);
  return words.length > 0 && words.length <= 4 && YES.has(words[0]!);
}

/** Palabras que no ayudan a reconocer una opción («el Brugal», «es una merma», «al Vivero»). */
const FILLERS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas", "es", "de", "del", "al", "a", "en", "para", "desde", "eso", "esa", "ese", "pues",
  "mejor", "vale", "no", "perdona", "perdon", "espera", "digo", "osea", "o", "sea", "porfa",
]);

/**
 * ¿El texto nombra esta opción? Cada palabra con sentido del texto debe parecerse a alguna palabra
 * de la opción (admite erratas y tildes: «pickles» → Pickels, «bacardi» → Bacardí). Así «un
 * traspaso» elige Traspaso, pero «haz un traspaso de 3 larios» no: es una orden nueva.
 */
function mentions(text: string, label: string): boolean {
  const words = tokenize(text).filter((w) => !FILLERS.has(w));
  const labelWords = tokenize(label);
  if (words.length === 0 || labelWords.length === 0) return false;
  return words.every((w) => labelWords.some((l) => tokenSimilarity(w, l) >= 0.85));
}

/** Opción especial de las preguntas repetidas: abandonar lo que se estaba preparando. */
export const CANCEL_OPTION = "__dejar";

/** «déjalo», «cancela», «olvídalo», «nada», «no»: no se quiere seguir con esa pregunta. */
function isCancel(text: string): boolean {
  return /^(no,? )?(dejalo|dejala|dejalo estar|cancela|cancelar|cancelalo|olvidalo|olvida|nada|da igual|salir|stop)$/.test(tokenize(text).join(" "));
}

export function readFreeText(pending: PendingClarify, text: string, ctx: SessionContext): FreeTextAnswer {
  const labels = pending.optionLabels ?? pending.optionIds;
  const words = text.normalize("NFC").match(/\d+(?:[.,/]\d+)?|[\p{L}\p{M}\p{N}]+/gu) ?? [];
  if (isCancel(text)) return { kind: "cancel" };

  // «a 1,50», «12,97 €», «1.5»: el precio que se pedía (no es una cantidad).
  if (pending.field === "precio") {
    const amount = words.map((w) => parseNumber(w)).find((n) => n !== null && n.gt(0)) ?? null;
    if (amount) return { kind: "price", amount: amount.toString() };
  }

  if (pending.field === "cantidad") {
    const amount = words.map((w) => parseNumber(w)).find((n) => n !== null && n.gt(0)) ?? null;
    const unit = words.map((w) => canonicalUnit(w)).find((u) => u !== null) ?? null;
    if (amount) return { kind: "quantity", amount: amount.toString(), unit };
    // «cajas» respondiendo a «¿en qué formato?».
    if (unit) {
      const packs = new Map(ctx.products.flatMap((p) => p.packs).map((k) => [`pack:${k.id}`, k]));
      const match = pending.optionIds.filter((id) => (id === "pack:base" ? unit === "ud" : packs.has(id) && packMatchesUnit(packs.get(id)!, unit)));
      if (match.length === 1) return { kind: "option", optionId: match[0]! };
    }
  }

  // «sí» a una pregunta de sí o no («¿son 2 botellas?», «¿lo confirmo?»).
  const yes = pending.optionIds.find((id) => id === "si" || (pending.field === "borrador" && id === "confirmar"));
  if (yes && isYes(text)) return { kind: "option", optionId: yes };

  const named = pending.optionIds.filter((_, i) => mentions(text, labels[i] ?? ""));
  if (named.length === 1) return { kind: "option", optionId: named[0]! };

  // Un producto de la frase original que no estaba entre las opciones mostradas («larios» cuando
  // se enseñaron las cuatro primeras ginebras).
  if (pending.field === "producto" && pending.routing) {
    const segment = pending.routing.meta.segments[pending.segmentIndex ?? 0];
    const keys = segment ? [...segment.candidates.keys()] : [];
    const found = keys.filter((k) => mentions(text, k));
    if (found.length === 1) return { kind: "option", optionId: found[0]! };
  }

  // Un local escrito a mano aunque no estuviera entre las opciones mostradas.
  if (pending.field === "local" || pending.field === "local_destino") {
    const locations = ctx.locations.filter((l) => mentions(text, l.name));
    if (locations.length === 1) return { kind: "option", optionId: locations[0]!.name };
  }
  return { kind: "unknown" };
}

/**
 * Una pregunta completa («¿cuánto ron queda en Parador?») no completa la orden abierta: es un mensaje
 * nuevo. Pegada a «quita unas cocas», Jev ya no sabía qué se pedía y preguntaba «¿Qué quieres hacer?».
 */
export function isNewQuestion(text: string): boolean {
  return /[¿?]/.test(text) && tokenize(text).length >= 3;
}

/** Respuestas de aclaraciones anteriores que no dependen de la posición de un producto en el mensaje. */
export function fieldOverrides(overrides: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(overrides).filter(([key]) => !/_\d+$/.test(key)));
}
