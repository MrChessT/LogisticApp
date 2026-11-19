// Rastro de un turno para la auditoría (fase 0 del plan de mejora): qué se respondió, si fue una aclaración o un
// borrador, por qué vía y cuánto tardó. Se toma de lo que sale hacia el panel, así vale para cualquier camino
// (archivo, varias órdenes, atajos, Jev) sin que cada uno tenga que acordarse de auditar.
import type { AuditSink, TurnTrace, Via } from "../audit/audit";
import type { ChatRequest, Decision, Emit, SseEvent } from "../contract/index";
import { especialistaDe } from "../especialistas/mapa";
import { CATALOG_VERSION } from "../jev/catalog";
import type { SessionContext } from "../domain";
import type { StageTimer } from "../metrics/metrics";
import type { Plan } from "./plans";

export interface SeenTurn {
  reply: string;
  clarifyField: string | null;
  form: boolean;
  draft: boolean;
  textSource: string | null;
}

export function traceEmit(emit: Emit): { emit: Emit; seen: SeenTurn } {
  const seen: SeenTurn = { reply: "", clarifyField: null, form: false, draft: false, textSource: null };
  return {
    seen,
    emit: (e: SseEvent) => {
      if (e.event === "done") {
        seen.reply = e.data.text;
        seen.textSource = e.data.textSource ?? null;
      } else if (e.event === "clarify") seen.clarifyField = e.data.field;
      else if (e.event === "form") seen.form = true;
      else if (e.event === "draft") seen.draft = true;
      return emit(e);
    },
  };
}

function turnTrace(seen: SeenTurn, via: Via, timer: StageTimer, plan: string | null, especialista: string | null, origin: string | null): TurnTrace {
  return {
    via,
    reply: seen.reply,
    plan,
    especialista,
    ms: timer.total(),
    stages: { ...timer.durations },
    clarifyField: seen.clarifyField,
    form: seen.form,
    draft: seen.draft,
    textSource: seen.textSource,
    origin,
  };
}

/** Lo que se resolvió antes de Jev (archivo, varias órdenes): también cuenta en los indicadores. */
export async function auditEarlyTurn(audit: AuditSink, req: ChatRequest, ctx: SessionContext, messageId: string, via: Via, seen: SeenTurn, timer: StageTimer): Promise<void> {
  await audit
    .record({
      type: "mensaje",
      at: new Date().toISOString(),
      userId: ctx.userId,
      orgId: ctx.orgId,
      sessionId: req.sessionId,
      messageId,
      message: req.message,
      intent: via,
      decisions: [],
      outcome: seen.draft ? "borrador" : seen.clarifyField || seen.form ? "aclaracion" : "consulta",
      jevModel: null,
      catalogVersion: CATALOG_VERSION,
      shortcut: true,
      turn: turnTrace(seen, via, timer, null, null, req.origen ?? null),
    })
    .catch(() => undefined);
}

export interface TurnInput {
  ctx: SessionContext;
  req: ChatRequest;
  messageId: string;
  /** Lo que se procesó (puede ser la orden retomada al responder una aclaración). */
  message: string;
  understoodAs: string | null;
  intent: string;
  decisions: Decision[];
  outcome: string;
  jevModel: string | null;
  shortcut: boolean;
  plan: Plan;
  via: Via;
  seen: SeenTurn;
  timer: StageTimer;
}

/** El registro de un turno que pasó por el camino normal (atajos, botones, aclaraciones o Jev). */
export async function auditTurn(audit: AuditSink, t: TurnInput): Promise<void> {
  const at = new Date().toISOString();
  const base = { at, userId: t.ctx.userId, orgId: t.ctx.orgId, messageId: t.messageId };
  await (t.plan.type === "bloqueado"
    ? audit.record({ ...base, type: "bloqueo", reason: "inyeccion" })
    : audit.record({
        ...base,
        type: "mensaje",
        sessionId: t.req.sessionId,
        message: t.understoodAs ? t.req.message : t.message,
        ...(t.understoodAs ? { understoodAs: t.understoodAs } : {}),
        intent: t.intent,
        decisions: t.decisions,
        outcome: t.outcome,
        jevModel: t.jevModel,
        catalogVersion: CATALOG_VERSION,
        shortcut: t.shortcut,
        turn: turnTrace(t.seen, t.via, t.timer, t.plan.type, especialistaDe(t.plan, t.decisions), t.req.origen ?? null),
      })
  ).catch(() => undefined);
}
