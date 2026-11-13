// Respuesta a una aclaración del asistente («¿En qué local?» → «Parador», «3 cajas», «déjalo»…): se
// retoma la orden original con lo contestado, sin volver a llamar a Jev cuando no hace falta.
import type { ChatRequest } from "../contract/index";
import type { SessionContext } from "../domain";
import { tokenize } from "../entities/normalize";
import { isGenericName } from "../entities/catalog-parser";
import type { Retriever } from "../entities/retriever";
import { CANCEL_OPTION, changesOperation, ENTITY_FIELDS, fieldOverrides, isNewQuestion, NAME_FIELDS, operationOf, readFreeText, type FreeTextAnswer } from "./free-text";
import type { ClarifyPlan, Plan } from "./plans";
import type { PendingClarify, Session } from "./session";
import { officeAction } from "./office-actions";
import { resolveShortcut } from "./shortcuts";

/** Estado del mensaje que se está procesando: lo que cambia al retomar una aclaración. */
export interface MessageState {
  message: string;
  page: ChatRequest["page"];
  pageContext: ChatRequest["pageContext"];
  /** Decisiones ya fijadas por el usuario (local elegido, cantidad escrita…). */
  overrides: Record<string, string>;
  /** Las mismas respuestas en texto, para comprobar el borrador con todo lo dicho. */
  answers: string[];
  /** Resultado de Jev del mensaje original, que se reutiliza. */
  reuse: PendingClarify["routing"];
  plan: Plan | null;
  shortcut: boolean;
}

function overrideKey(pending: PendingClarify, option: string): string {
  const i = pending.segmentIndex ?? 0;
  if (pending.field === "producto") return `producto_${i}`;
  if (pending.field === "cantidad") return option.startsWith("pack:") ? `unidad_${i}` : `cantidad_ok_${i}`;
  return pending.field;
}

function overrideValue(option: string): string {
  return option.startsWith("pack:") ? option.slice(5) : option;
}

/** Cantidad escrita a mano: sustituye a la del mensaje (y a la confirmación o el formato anteriores). */
function quantityOverrides(pending: PendingClarify, typed: { amount: string; unit: string | null }): Record<string, string> {
  const i = pending.segmentIndex ?? 0;
  const { [`cantidad_ok_${i}`]: _ok, [`unidad_${i}`]: _pack, [`unidad_texto_${i}`]: _unit, ...rest } = pending.overrides;
  void _ok;
  void _pack;
  void _unit;
  return { ...rest, [`cantidad_${i}`]: typed.amount, ...(typed.unit ? { [`unidad_texto_${i}`]: typed.unit } : {}) };
}

export async function resumeClarification(req: ChatRequest, session: Session, ctx: SessionContext, retriever: Retriever, state: MessageState): Promise<MessageState> {
  let { message, page, pageContext, overrides, answers, reuse, plan, shortcut } = state;
  // Respuesta a una aclaración: se reutiliza la llamada nº 1 con la decisión forzada.
  const pending = req.clarification ? session.clarifies.get(req.clarification.clarifyId) : undefined;
  if (pending && req.clarification) {
    session.clarifies.delete(pending.clarifyId);
    let option: string | null = req.clarification.optionId;
    let typed: Extract<FreeTextAnswer, { kind: "quantity" }> | null = null;
    let price: string | null = null;
    let cancelled = option === CANCEL_OPTION;
    const text = (req.clarification.freeText ?? req.message).trim();
    if (!cancelled && (option === "otra" || !pending.optionIds.includes(option))) {
      // Escrito a mano: primero como respuesta a esta pregunta (una opción, una cantidad o un precio).
      const read = readFreeText(pending, text, ctx);
      option = read.kind === "option" ? read.optionId : null;
      if (read.kind === "quantity" && pending.routing) typed = read;
      if (read.kind === "price") price = read.amount;
      if (read.kind === "cancel") cancelled = true;
      // «todos» a «¿qué traspaso ha llegado?»: se reciben de uno en uno, empezando por el primero.
      if (option === null && pending.field === "documento" && /^(tod[oa]s|todo|ambos|ambas|los dos|las dos)\b/.test(tokenize(text).join(" ")) && pending.optionIds[0]) {
        option = pending.optionIds[0];
        overrides = { uno_a_uno: "1" };
      }
    }
    const changes = changesOperation(text, pending);
    if (cancelled) {
      plan = { type: "aviso", text: "Vale, lo dejo. Dime si necesitas otra cosa." };
      shortcut = true;
      session.clarifies.clear();
    }
    const answered = (value: string) => [...(pending.answers ?? []), `${pending.field.replace(/_/g, " ")}: ${value}`].slice(-6);
    if (cancelled) {
      // Ya resuelto arriba.
    } else if (price !== null && pending.routing) {
      message = pending.message;
      page = pending.page;
      pageContext = pending.pageContext;
      overrides = { ...pending.overrides, precio: price };
      answers = answered(text);
      reuse = pending.routing;
    } else if (option === null && !typed && NAME_FIELDS.has(pending.field) && pending.routing && !changes && !isNewQuestion(text) && !isGenericName(text)) {
      // «¿Cómo se llama el producto nuevo?» → «Prueba Luis»: es el nombre, se sigue con la misma orden.
      const { sentido: _sentido, ...rest } = pending.overrides;
      void _sentido;
      message = pending.message;
      page = pending.page;
      pageContext = pending.pageContext;
      overrides = { ...rest, nombre: text };
      answers = answered(text);
      reuse = pending.routing;
    } else if (option !== null && pending.fromShortcut && pending.field === "documento" && officeAction(pending.message, ctx, pending.pageContext?.locationId)) {
      // «¿Qué factura marco como pagada?» → la elegida: misma orden de oficina con ese documento.
      message = pending.message;
      page = pending.page;
      pageContext = pending.pageContext;
      plan = officeAction(pending.message, ctx, pending.pageContext?.locationId);
      overrides = { documento: option };
      shortcut = true;
    } else if (option !== null && pending.fromShortcut) {
      message = pending.message;
      page = pending.page;
      pageContext = pending.pageContext;
      const product = ctx.products.find((p) => p.name === option);
      plan = await resolveShortcut(pending.message, ctx, retriever, pageContext?.locationId, product);
      shortcut = true;
    } else if ((option !== null || typed) && pending.routing) {
      message = pending.message;
      page = pending.page;
      pageContext = pending.pageContext;
      overrides = option !== null ? { ...pending.overrides, ...overrides, [overrideKey(pending, option)]: overrideValue(option) } : quantityOverrides(pending, typed!);
      answers = answered(option !== null ? (pending.optionLabels?.[pending.optionIds.indexOf(option)] ?? text) : text);
      reuse = pending.routing;
    } else if (ENTITY_FIELDS.has(pending.field) && !pending.restart && !isNewQuestion(text) && !changes) {
      // Falta un dato de la orden y no encaja con ninguna opción: se completa la orden original.
      message = `${pending.message}. ${text}`.slice(0, 1000);
      page = pending.page;
      pageContext = pending.pageContext;
      overrides = fieldOverrides(pending.overrides);
      answers = pending.answers ?? [];
    }
    // Si no, lo escrito es un mensaje nuevo: la orden anterior no se arrastra.
  } else if (req.clarification) {
    // La aclaración ya no está (sesión perdida o caducada). Si era el nombre de un producto nuevo, lo
    // escrito sigue siendo ese nombre: se retoma el alta en vez de leerlo como un mensaje suelto.
    const text = (req.clarification.freeText ?? req.message).trim();
    console.warn("copiloto: aclaración no encontrada", { field: req.clarification.field ?? null });
    if (req.clarification.field === "nombre" && operationOf(text) === null) {
      message = `nuevo producto «${text.replace(/[«»"]/g, "")}»`;
      overrides = { intent: "proponer_accion", tipo_accion: "nuevo_producto" };
    }
  }
  return { message, page, pageContext, overrides, answers, reuse, plan, shortcut };
}

/** ¿Se hizo esta misma pregunta en los últimos turnos del asistente? (bucle de aclaraciones) */
export function askedRecently(session: Session, question: string): boolean {
  const recent = session.turns.filter((t) => t.role === "assistant").slice(-3);
  const head = question.slice(0, 40);
  return recent.some((t) => t.text.includes(head));
}

/** Cómo se contesta cada pregunta, para cuando lo escrito no la contestaba. */
const ANSWER_HINT: Partial<Record<ClarifyPlan["field"], string>> = {
  local: "Elige uno o escribe su nombre.",
  local_destino: "Elige uno o escribe su nombre.",
  producto: "Elige uno o escribe el nombre como sale en el catálogo.",
  cantidad: "Escribe solo la cantidad, por ejemplo «3 botellas».",
  precio: "Escribe solo el precio, por ejemplo «1,50».",
  formato: "Elige uno de los formatos.",
  documento: "Elige uno de la lista.",
};

/** La misma pregunta por segunda vez: se dice claro que falta ese dato, con un ejemplo de respuesta. */
export function insistedQuestion(plan: ClarifyPlan): string {
  const hint = ANSWER_HINT[plan.field];
  return `Me falta ese dato para seguir. ${plan.question}${hint ? ` ${hint}` : ""}`;
}
