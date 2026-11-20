// Operación a medias: cuando sale el miniformulario («registra una merma» sin más), la persona a menudo no lo
// rellena, sino que sigue escribiendo: «larios», «2 botellas», «en el vivero». Cada uno de esos mensajes llegaba
// suelto, sin saber que completaba la merma, y el formulario volvía a salir vacío: el bucle que más se repetía en
// producción. Aquí se guarda lo que ya se sabe de la operación, cada mensaje corto rellena lo que falta y se arma la
// frase completa, que sigue el camino de siempre (Jev decide; nada se guarda sin confirmar).
import type { FormEvent } from "../contract/index";
import type { SessionContext } from "../domain";
import { normalize, tokenize } from "../entities/normalize";
import { editDistance } from "../entities/family";
import { canonicalUnit, parseNumber, parseQuantities } from "../entities/quantity-parser";
import { tokenSimilarity } from "../entities/retriever";
import { isCancel, isNewQuestion, operationOf } from "./free-text";

type TaskAction = FormEvent["accion"];

export interface PendingTask {
  accion: TaskAction;
  local?: string;
  destino?: string;
  producto?: string;
  cantidad?: string;
  motivo?: string;
  /** Epoch ms: pasado un rato, lo que se escriba ya no se da por continuación. */
  at: number;
}

/** Una operación a medias caduca: después de esto, lo escrito es un mensaje nuevo. */
const TASK_TTL_MS = 20 * 60 * 1000;
/** Un dato suelto es corto («larios», «2 botellas», «del parador al vivero»); una orden nueva, no. */
const MAX_FRAGMENT_WORDS = 9;

const CONNECTORS = new Set(["de", "del", "en", "el", "la", "los", "las", "al", "a", "para", "por", "desde", "hasta", "hacia", "y", "con", "pues", "vale", "es", "son", "eran", "seran", "sea", "sean"]);
const OPERATION_WORDS = new Set([
  "merma", "mermas", "traspaso", "traspasos", "traspasar", "pasa", "pasar", "mueve", "mover", "recepcion", "llegado", "llegaron", "llego", "han",
  "registra", "registrar", "apunta", "apuntar", "haz", "hacer", "quiero", "una", "un", "se", "ha", "hay", "me", "nos",
]);
const REASONS: Array<[string, RegExp]> = [
  ["rotura", /\b(rot[oa]s?|rompi\w*|rotura|se (ha |han )?ca(id|y)\w*|cayo|cayeron)\b/],
  ["caducidad", /\b(caduc\w*|estropead\w*|podrid\w*|pasad[oa]s?)\b/],
  ["derrame", /\b(derram\w*|se (ha |han )?salido)\b/],
  ["invitacion", /\b(invitaci\w*|invitad\w*)\b/],
  ["error_servicio", /\b(error|equivoca\w*|mal servid\w*)\b/],
];

const REQUIRED: Record<TaskAction, Array<"local" | "destino" | "producto" | "cantidad">> = {
  merma: ["local", "producto", "cantidad"],
  traspaso: ["local", "destino", "producto", "cantidad"],
  recepcion: ["local", "producto", "cantidad"],
};

/** Lo que el formulario ya traía relleno: el punto de partida de la operación a medias. */
function taskFromForm(form: FormEvent, now: number): PendingTask {
  const value = (key: string) => form.fields.find((f) => f.key === key)?.value;
  const task: PendingTask = { accion: form.accion, at: now };
  for (const key of ["local", "destino", "producto", "cantidad", "motivo"] as const) {
    const v = value(key);
    if (v) task[key] = v;
  }
  return task;
}

/**
 * Lo que ya se sabe de una operación cuando se le preguntó un dato suelto («¿en qué local?»): los locales fijados y
 * el producto y la cantidad de la frase. Así la respuesta escrita se suma ordenada, no pegada al final.
 */
export function taskFromPending(accion: string | null, overrides: Record<string, string>, segment: { productText: string; amount: string | null; unit: string | null } | undefined, now: number): PendingTask | null {
  if (accion !== "merma" && accion !== "traspaso" && accion !== "recepcion") return null;
  const task: PendingTask = { accion, at: now };
  if (overrides.local) task.local = overrides.local;
  if (overrides.local_destino) task.destino = overrides.local_destino;
  if (overrides.motivo_merma) task.motivo = overrides.motivo_merma;
  const product = segment ? cleanProduct(segment.productText) : undefined;
  if (product) task.producto = product;
  if (segment?.amount) task.cantidad = segment.unit ? `${segment.amount} ${unitText(segment.amount, segment.unit)}` : segment.amount;
  return task;
}

function activeTask(task: PendingTask | undefined, now: number): PendingTask | undefined {
  return task && now - task.at <= TASK_TTL_MS ? task : undefined;
}

/** La misma palabra o con una errata («pardor», «vivro»): una letra en palabras medianas, dos en largas. */
function sameWord(w: string, p: string): boolean {
  if (w === p) return true;
  if (w.length < 4 || p.length < 4) return false;
  return tokenSimilarity(w, p) >= 0.85 || editDistance(w, p) <= (Math.min(w.length, p.length) >= 8 ? 2 : 1);
}

/** ¿Este local está nombrado en el texto? Por sus palabras con sentido, admitiendo erratas. */
function locationAt(words: string[], name: string): number {
  const parts = tokenize(name).filter((w) => w.length > 2);
  if (parts.length === 0) return -1;
  return words.findIndex((w) => parts.some((p) => sameWord(w, p)));
}

export interface Fragment {
  locations: Array<{ name: string; role: "origen" | "destino" | null }>;
  cantidad?: string;
  /** La misma cantidad por partes («4», «caja»), para rehacer un borrador con ella. */
  amount?: string;
  unit?: string | null;
  producto?: string;
  motivo?: string;
}

/** Lo que dice un mensaje corto: locales (con su papel si lo marca «de»/«a»), cantidad, producto y motivo. */
export function readFragment(text: string, ctx: SessionContext): Fragment {
  const words = tokenize(text);
  const used = new Set<number>();
  const found: Array<{ name: string; role: "origen" | "destino" | null; at: number }> = [];
  for (const l of ctx.locations) {
    const at = locationAt(words, l.name);
    if (at < 0) continue;
    let k = at - 1;
    while (k >= 0 && ["el", "la", "los", "las"].includes(words[k]!)) k -= 1;
    const prev = words[k] ?? "";
    const role = ["del", "desde", "de"].includes(prev) ? "origen" : ["al", "a", "hacia", "para"].includes(prev) ? "destino" : null;
    found.push({ name: l.name, role, at });
    const parts = tokenize(l.name).filter((w) => w.length > 2);
    words.forEach((w, i) => {
      if (parts.some((p) => sameWord(w, p))) used.add(i);
    });
  }
  // En el orden en que se dicen: «del parador al vivero» y «al vivero desde el parador» dan lo mismo.
  const fragment: Fragment = { locations: found.sort((a, b) => a.at - b.at).map(({ name, role }) => ({ name, role })) };
  const norm = words.join(" ");
  fragment.motivo = REASONS.find(([, re]) => re.test(norm))?.[0];

  // Cantidad y producto: «2 botellas», «3 cajas de cocacola», «4 de larios».
  const withoutPlaces = words.filter((_, i) => !used.has(i)).join(" ");
  const segment = parseQuantities(withoutPlaces, 1)[0];
  if (segment?.amount) {
    fragment.cantidad = segment.unit ? `${segment.amount} ${unitText(segment.amount, segment.unit)}` : segment.amount;
    [fragment.amount, fragment.unit] = [segment.amount, segment.unit];
    const product = cleanProduct(segment.productText);
    if (product) fragment.producto = product;
  } else {
    // Una cifra suelta («3», «2 botellas» sin producto): la cantidad, con su unidad si la dice.
    const rest = withoutPlaces.split(" ");
    const amount = rest.map((w) => parseNumber(w)).find((n) => n !== null && n.gt(0));
    const unit = rest.map((w) => canonicalUnit(w)).find((u) => u !== null) ?? null;
    if (amount) {
      fragment.cantidad = unit ? `${amount.toString()} ${unitText(amount.toString(), unit)}` : amount.toString();
      [fragment.amount, fragment.unit] = [amount.toString(), unit];
    }
    const product = cleanProduct(rest.filter((w) => parseNumber(w) === null && canonicalUnit(w) === null).join(" "));
    if (product) fragment.producto = product;
  }
  return fragment;
}

/** «botella» → «botellas» con más de una (la frase armada debe leerse como la diría una persona). */
function unitText(amount: string, unit: string): string {
  if (amount === "1" || /^(ud|kg|g|l|cl|ml)$/.test(unit)) return unit;
  return /[aeiou]$/.test(unit) ? `${unit}s` : `${unit}es`;
}

/** Lo que queda al quitar conectores, palabras de la operación y motivos es el producto («larios»). */
function cleanProduct(text: string): string | undefined {
  const reasons = new RegExp(REASONS.map(([, re]) => re.source).join("|"));
  const kept = tokenize(text).filter((w) => !CONNECTORS.has(w) && !OPERATION_WORDS.has(w) && !reasons.test(w) && !/^\d+([.,]\d+)?$/.test(w));
  return kept.length ? kept.join(" ") : undefined;
}

/** La frase completa con lo que se sabe: la misma forma que la del formulario, para que Jev la lea igual. */
function sentence(t: PendingTask): string {
  const what = [t.cantidad ? `de ${t.cantidad}` : "", t.producto ? `de ${t.producto}` : ""].filter(Boolean).join(" ");
  if (t.accion === "merma") return ["merma", what, t.local ? `en ${t.local}` : "", t.motivo ? `por ${t.motivo.replace("_", " ")}` : ""].filter(Boolean).join(" ");
  // «desde X a Y»: con «de X» el lector de cantidades pegaba el local al producto («cocacola de Parador»).
  if (t.accion === "traspaso") return ["traspaso", what, t.local ? `desde ${t.local}` : "", t.destino ? `a ${t.destino}` : ""].filter(Boolean).join(" ");
  return ["han llegado", what || "mercancía", t.local ? `a ${t.local}` : ""].filter(Boolean).join(" ");
}

export type TaskStep =
  /** Lo escrito completa la operación: esta es la frase armada y lo que queda fijado. */
  | { kind: "continue"; task: PendingTask; message: string; overrides: Record<string, string>; missing: string[] }
  /** «olvídalo», «déjalo»: se abandona. */
  | { kind: "cancel" }
  /** Es otra cosa (una pregunta, otra operación, una orden larga): mensaje nuevo, la operación se olvida. */
  | { kind: "other" };

export function continueTask(task: PendingTask, text: string, ctx: SessionContext, now: number): TaskStep {
  if (isCancel(text)) return { kind: "cancel" };
  const words = tokenize(text);
  const op = operationOf(text);
  if (isNewQuestion(text) || words.length === 0 || words.length > MAX_FRAGMENT_WORDS || (op !== null && op !== task.accion)) return { kind: "other" };
  // «¿cuánto…», «qué…», «dónde…» sin signos: también es una pregunta, no un dato.
  if (/^(cuanto|cuanta|cuantos|cuantas|que|como|donde|cuando|quien|cual|dime|ensename|muestrame)\b/.test(normalize(text).trim())) return { kind: "other" };

  const f = readFragment(text, ctx);
  const next: PendingTask = { ...task, at: now };
  // Locales: con su papel si lo dice («del parador al vivero»); si no, el primero que falte.
  for (const l of f.locations) {
    if (task.accion === "traspaso" && l.role === "destino") next.destino = l.name;
    else if (task.accion === "traspaso" && l.role === "origen") next.local = l.name;
    else if (!next.local || (task.accion !== "traspaso" && f.locations.length === 1)) next.local = l.name;
    else if (task.accion === "traspaso" && !next.destino && l.name !== next.local) next.destino = l.name;
  }
  if (f.cantidad) next.cantidad = f.cantidad;
  if (f.producto) next.producto = f.producto;
  if (f.motivo) next.motivo = f.motivo;

  const learned = f.locations.length > 0 || f.cantidad || f.producto || f.motivo;
  if (!learned) return { kind: "other" };
  const byName = (name: string | undefined) => (name ? ctx.locations.find((l) => normalize(l.name) === normalize(name)) : undefined);
  const local = byName(next.local);
  const destino = byName(next.destino);
  const overrides: Record<string, string> = {
    intent: "proponer_accion",
    tipo_accion: next.accion,
    ...(local ? { local: local.name } : {}),
    ...(destino && destino.id !== local?.id ? { local_destino: destino.name } : {}),
    ...(next.accion === "merma" && next.motivo ? { motivo_merma: next.motivo } : {}),
  };
  const missing = REQUIRED[next.accion].filter((k) => !next[k]);
  return { kind: "continue", task: next, message: sentence(next), overrides, missing };
}

/**
 * Al llegar un mensaje: si hay una operación a medias y lo escrito la completa, la frase armada y lo fijado.
 * La operación se quita de la sesión; vuelve si sale otro formulario (rememberTask).
 */
export function resumeTask(session: { task?: PendingTask }, text: string, ctx: SessionContext, now: number): { message: string; overrides: Record<string, string>; cancelled: boolean } | null {
  const task = activeTask(session.task, now);
  session.task = undefined;
  if (!task) return null;
  const step = continueTask(task, text, ctx, now);
  if (step.kind === "cancel") return { message: text, overrides: {}, cancelled: true };
  if (step.kind !== "continue") return null;
  session.task = step.task;
  return { message: step.message, overrides: step.overrides, cancelled: false };
}

/** Sale el miniformulario: se guarda lo que ya se sabe (lo acumulado manda sobre lo que el formulario no trae). */
export function rememberTask(session: { task?: PendingTask }, form: FormEvent, now: number): void {
  const fromForm = taskFromForm(form, now);
  const kept = session.task?.accion === form.accion ? session.task : undefined;
  session.task = kept ? { ...fromForm, ...Object.fromEntries(Object.entries(kept).filter(([, v]) => v !== undefined)), at: now } : fromForm;
}

/** Cualquier respuesta que no sea pedir datos (un borrador, una consulta, un error) cierra la operación a medias. */
export function settleTask(session: { task?: PendingTask }, outcome: { kind: string; tarea?: string }): void {
  if (outcome.kind !== "aclaracion" && !(outcome.kind === "tarea" && outcome.tarea === "formulario")) session.task = undefined;
}

const MISSING_LABEL: Record<TaskAction, Record<string, string>> = {
  merma: { local: "en qué local", producto: "qué producto", cantidad: "cuánto" },
  traspaso: { local: "de qué local sale", destino: "a cuál va", producto: "qué producto", cantidad: "cuánto" },
  recepcion: { local: "a qué local llega", producto: "qué producto", cantidad: "cuánto" },
};

/**
 * El texto que acompaña al formulario: lo que ya está apuntado y lo que falta. Sin esto, cada mensaje volvía a decir
 * «Me faltan unos datos» y parecía que no se había entendido nada.
 */
export function taskPrompt(task: PendingTask | undefined): string {
  const fallback = "Me faltan unos datos: rellénalos aquí y te preparo el borrador.";
  if (!task) return fallback;
  const missing = REQUIRED[task.accion].filter((k) => !task[k]).map((k) => MISSING_LABEL[task.accion][k]!);
  const known = REQUIRED[task.accion].some((k) => task[k]);
  if (!known || missing.length === 0) return fallback;
  const list = missing.length === 1 ? missing[0]! : `${missing.slice(0, -1).join(", ")} y ${missing.at(-1)}`;
  return `Llevo apuntado: ${sentence(task)}. Me falta saber ${list}: rellénalo aquí o escríbemelo.`;
}
