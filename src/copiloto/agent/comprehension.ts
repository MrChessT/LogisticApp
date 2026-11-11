// Comprensión con IA, siempre validada: la IA solo reescribe o clasifica; decidir sigue siendo cosa de
// Jev y sus umbrales.
//
//   · Antes de enrutar (rewriteFollowUp): un seguimiento que depende de lo hablado («¿y sus proveedores?»,
//     «¿cuánto se vendió de eso?») se reescribe como petición completa. Las referencias claras siempre; un
//     «¿y…?» solo si lo cogería un atajo de palabras clave (Jev ya hereda el foco).
//   · Después (needsUnderstanding / resolves, en loop.ts): si Jev no entiende un mensaje nuevo, se
//     reescribe y se vuelve a pasar; solo se adopta si ahora se entiende.
//
// Una reescritura que nombra locales o productos que no salen en el mensaje, la conversación o el foco se
// descarta (groundedLocations / groundedProducts).
import type { SessionContext } from "../domain";
import { tokenize } from "../entities/normalize";
import type { StageTimer } from "../metrics/metrics";
import { infoTopicOf } from "../tools/info";
import type { Assistant } from "../writer/assistant";
import type { Plan } from "./plans";
import { contextReference, namedLocations } from "./routing";
import type { Focus, Session } from "./session";
import { tareaTopicOf } from "./shortcuts";
import { consumptionByHand, screenHelp, smallTalk, topicReply } from "./topics";

/** Lo cogería un atajo de palabras clave (temas, tareas, avisos fijos), que no mira la conversación. */
function takenByKeywordRoute(message: string, ctx: SessionContext): boolean {
  return Boolean(tareaTopicOf(message) ?? infoTopicOf(message) ?? topicReply(message) ?? screenHelp(message, ctx.locations.map((l) => l.name)) ?? consumptionByHand(message));
}

/** Petición completa de un seguimiento, o null (no depende del contexto, no hay conversación, la IA falla o inventa). */
export async function rewriteFollowUp(assistant: Assistant, message: string, session: Session, focus: Focus | undefined, ctx: SessionContext, timer: StageTimer): Promise<string | null> {
  // Hace falta conversación reciente: el foco (consultas de inventario) o los últimos turnos (informes,
  // facturas, escandallos, que no dejan foco). Con un borrador esperando respuesta decide Jev.
  const recent = focus ? !focus.draftId : session.turns.length > 0;
  if (!recent) return null;
  const reference = contextReference(message);
  if (reference !== "fuerte" && !(reference === "debil" && takenByKeywordRoute(message, ctx))) return null;
  const focusText = focus ? describeFocus(focus, ctx) : "";
  const understanding = await timer.time("comprension", () => assistant.understand(message, { turns: session.turns, ...(focusText ? { focus: focusText } : {}) }, "seguimiento"));
  const grounded =
    understanding?.tipo === "datos" &&
    tokenize(understanding.consulta).join(" ") !== tokenize(message).join(" ") &&
    // Una lista de productos («A, B y 12 más») no es una petición que alguien escribiría.
    !/\by \d+ mas\b/.test(tokenize(understanding.consulta).join(" ")) &&
    groundedLocations(understanding.consulta, message, session, focus, ctx) &&
    groundedProducts(understanding.consulta, [message, ...session.turns.map((t) => t.text), focusText].join(" "), ctx);
  return grounded ? understanding.consulta : null;
}

const HELP_RE = /\b(que (sabes|puedes) hacer|que haces|como funcionas|para que sirves|ayuda|ayudame|que te puedo preguntar)\b/;

/** Jev no ha entendido el mensaje: dudaba de la intención o de la consulta, o lo dio por ajeno o por charla (sin ser saludo ni ayuda). */
export function needsUnderstanding(plan: Plan, message: string): boolean {
  if (plan.type === "clarify") return plan.field === "intent" || plan.field === "herramienta";
  if (plan.type === "fuera_de_ambito") return true;
  if (plan.type === "conversar") return !smallTalk(message) && !HELP_RE.test(tokenize(message).join(" "));
  return false;
}

/** La petición reescrita se entiende ahora: ni duda la intención o la consulta, ni es charla o ajena. */
export function resolves(plan: Plan): boolean {
  if (plan.type === "clarify") return plan.field !== "intent" && plan.field !== "herramienta";
  return plan.type !== "conversar" && plan.type !== "fuera_de_ambito" && plan.type !== "bloqueado";
}

/** Lo último de la conversación en una línea, para la comprensión (nombres, no ids). */
export function describeFocus(focus: Focus, ctx: SessionContext): string {
  const all = focus.productIds.map((id) => ctx.products.find((p) => p.id === id)?.name).filter(Boolean);
  // Con una familia entera («el ron», «las tónicas») no se dan nombres: la IA los enumeraba en vez de
  // decir la familia como la dijo el usuario.
  const products = all.length > 3 ? [`${all.length} productos (los de la última consulta; nómbralos como los llamó el usuario)`] : all;
  const locations = focus.locationIds.map((id) => ctx.locations.find((l) => l.id === id)?.name).filter(Boolean);
  return [
    focus.tool ? `consulta: ${focus.tool.replace(/^query_/, "").replace(/_/g, " ")}` : focus.accion ? `operación: ${focus.accion}` : null,
    products.length ? `productos: ${products.join(", ")}` : null,
    locations.length ? `locales: ${locations.join(", ")}` : null,
    focus.periodo && focus.periodo !== "no_indicado" ? `periodo: ${focus.periodo.replace(/_/g, " ")}` : null,
  ].filter(Boolean).join(" · ");
}

/** La reescritura no se inventa locales: los que nombra están en el mensaje, la conversación o el foco. */
export function groundedLocations(rewrite: string, message: string, session: Session, focus: Focus | undefined, ctx: SessionContext): boolean {
  const named = namedLocations(ctx.locations, rewrite);
  if (named.length === 0) return true;
  const known = new Set([
    ...namedLocations(ctx.locations, [message, ...session.turns.map((t) => t.text)].join(" ")).map((l) => l.id),
    ...(focus?.locationIds ?? []),
  ]);
  return named.every((l) => known.has(l.id));
}

// Palabras de los nombres de producto que no identifican ninguno (formatos, envases, adjetivos comunes).
const GENERIC_PRODUCT_WORDS = new Set(["caja", "cajas", "botella", "botellas", "litro", "litros", "kilo", "kilos", "unidad", "unidades", "pack", "bandeja", "garrafa", "barril", "lata", "latas", "especial", "clasica", "clasico", "original", "premium", "extra", "zero", "fresco", "fresca", "natural"]);

/** La reescritura no se inventa productos: cada palabra de producto que usa está en el mensaje, la conversación o el foco. */
export function groundedProducts(rewrite: string, source: string, ctx: SessionContext): boolean {
  const productWords = new Set(ctx.products.flatMap((p) => tokenize(p.name)).filter((w) => w.length >= 4 && !/^\d/.test(w) && !GENERIC_PRODUCT_WORDS.has(w)));
  const known = tokenize(source).filter((w) => w.length >= 4);
  const stem = (w: string) => w.slice(0, 5);
  return tokenize(rewrite)
    .filter((w) => productWords.has(w))
    .every((w) => known.some((k) => k === w || stem(k) === stem(w)));
}
