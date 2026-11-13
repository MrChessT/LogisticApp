// Varias órdenes en un mensaje («pon el PVP de las croquetas a 9 y pasa 2 cocas al Vivero»): cada trozo que es
// una orden de oficina se convierte en su propio borrador, y cada uno se confirma por separado. Solo entra si
// TODOS los trozos son órdenes de oficina (reglas fijas, sin Jev); si no, el mensaje sigue el camino normal.
// Un trozo que no se puede preparar no tumba los demás: se dice cuál y por qué.
import type { DocumentDraft } from "../contract/index";
import type { InfoSource } from "../tools/info";
import type { Retriever } from "../entities/retriever";
import type { ChatRequest, Emit } from "../contract/index";
import type { SessionContext } from "../domain";
import type { DraftBuilder } from "../drafts/builder";
import type { DraftStore } from "../drafts/store";
import type { Session, SessionStore } from "./session";
import { nextFocus } from "./focus";
import { officeAction } from "./office-actions";
import type { DocumentPlan } from "./plans";

/** Separadores entre órdenes: «;», «además», o « y » seguido de otra orden (no «Pan y tomate»). */
const ORDERS = "pon|ponle|pasa|saca|crea|crear|asocia|cambia|marca|valida|apunta|registra|anade|quita|mete|mueve|ajusta|sube|baja|cobra|paga|el proveedor|la categoria|la zona|un formato|el formato";
const SPLIT = new RegExp(`\\s*;\\s*|\\s+además\\s+|\\s+y\\s+(?=(?:${ORDERS})\\b)`, "i");
const ORDER_START = new RegExp(`^(?:${ORDERS})\\b`, "i");

/** Los trozos del mensaje si son al menos dos órdenes; null si no. */
export function splitTasks(message: string): string[] | null {
  const pieces = message
    .split(SPLIT)
    .map((piece) => piece.trim().replace(/[.,]+$/, ""))
    .filter(Boolean);
  if (pieces.length < 2) return null;
  return pieces.every((piece, i) => i === 0 || ORDER_START.test(piece)) ? pieces : null;
}

export interface MultiTaskTurn {
  req: ChatRequest;
  ctx: SessionContext;
  session: Session;
  messageId: string;
  now: Date;
  /** Milisegundos desde el inicio del turno (para el evento final). */
  elapsed: number;
  sessions: SessionStore;
  drafts: DraftStore;
  builder: DraftBuilder;
  source: Parameters<DraftBuilder["build"]>[0]["source"];
  info?: InfoSource;
  retriever?: Retriever;
  emit: Emit;
}

/**
 * Atiende el mensaje si son varias órdenes de oficina: un borrador por orden y un texto final.
 * Devuelve false si no lo es (el turno sigue su camino normal).
 */
export async function multiTaskTurn(input: MultiTaskTurn): Promise<boolean> {
  const { req, ctx, session, messageId, now, sessions, drafts, builder, emit } = input;
  const parts = splitTasks(req.message);
  if (!parts) return false;
  const plans = parts.map((part) => ({ part, plan: officeAction(part, ctx, req.pageContext?.locationId) }));
  if (plans.some((p) => !p.plan)) return false;

  const made: DocumentDraft[] = [];
  const notes: string[] = [];
  let lastPlan: DocumentPlan | null = null;
  for (const { part, plan } of plans as Array<{ part: string; plan: DocumentPlan }>) {
    const built = await builder.build({ plan, message: part, ctx, source: input.source, ...(input.info ? { info: input.info } : {}), retriever: input.retriever, overrides: {}, now } as Parameters<DraftBuilder["build"]>[0]);
    if (built.kind === "draft" && built.draft.kind === "documento") {
      made.push(built.draft);
      lastPlan = plan;
      await drafts.save({ draft: built.draft, orgId: ctx.orgId, userId: ctx.userId, messageId, request: part });
      await emit({ event: "draft", data: built.draft });
    } else if (built.kind === "clarify") {
      notes.push(`«${part}»: ${built.plan.question}`);
    } else {
      notes.push(`«${part}»: ${built.kind === "error" ? built.message : "no lo he podido preparar."}`);
    }
  }

  if (lastPlan) {
    const last = made[made.length - 1]!;
    session.focus = nextFocus(lastPlan, { kind: "borrador", draft: last } as Parameters<typeof nextFocus>[1], session.focus, now.getTime());
  }
  const text = [made.length ? `He preparado ${made.length === 1 ? "un borrador" : `${made.length} borradores`}: confírmalos uno a uno.` : "No he podido preparar ninguno.", ...notes].join(" ");
  sessions.addTurn(session, { role: "user", text: req.message });
  sessions.addTurn(session, { role: "assistant", text });
  await sessions.save(req.sessionId, ctx.orgId, session).catch(() => undefined);
  await emit({ event: "done", data: { messageId, text, textSource: "plantilla", latencyMs: input.elapsed, showText: true } });
  return true;
}
