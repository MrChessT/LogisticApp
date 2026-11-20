// Pasos de la ejecución de un mensaje que no dependen del agente: responder a un borrador pendiente («sí»,
// «cancélalo»), consultas de gestión ya redactadas, tareas de varios pasos y botones con frase.
import { randomUUID } from "node:crypto";
import type { AuditSink } from "../audit/audit";
import type { AppRoute, ChatRequest, Decision, Emit } from "../contract/index";
import type { SessionContext } from "../domain";
import type { ConfirmResponse } from "../drafts/confirm";
import type { DraftStore } from "../drafts/store";
import type { JevResult } from "../jev/client";
import type { RoutingMeta } from "../jev/request";
import type { StageTimer } from "../metrics/metrics";
import { runTarea, type TareaPlan } from "../skills/tareas";
import { runInfo, type InfoSource } from "../tools/info";
import type { Tools } from "../tools/tools";
import type { InfoPlan, Plan } from "./plans";
import type { ReportOutcome } from "./report";
import type { Session, SessionStore } from "./session";

/** Confirma un borrador con el mismo servicio (y las mismas comprobaciones) que el botón. */
export type ConfirmDraft = (draftId: string) => Promise<ConfirmResponse>;

export interface ExecEnv {
  message: string;
  /** La comprensión ya dijo que no es una pregunta general: no se vuelve a preguntar a la IA. */
  skipGeneral?: boolean;
  /** Petición tal como la entendió la comprensión (se dice también al aclarar). */
  understoodAs?: string;
  messageId: string;
  page: AppRoute;
  pageContext: ChatRequest["pageContext"];
  overrides: Record<string, string>;
  /** Respuestas a las aclaraciones de esta orden, en texto. */
  answers: string[];
  routing: { meta: RoutingMeta; jev: JevResult } | undefined;
  ctx: SessionContext;
  session: Session;
  emit: Emit;
  timer: StageTimer;
  tools: Tools;
  info?: InfoSource;
  /** Decisiones del mensaje; la coherencia del borrador se añade aquí para el informe y la auditoría. */
  decisions: Decision[];
  audit: AuditSink;
  drafts: DraftStore;
  confirmDraft?: ConfirmDraft;
}

export async function answerDraft(plan: Extract<Plan, { type: "borrador" }>, env: ExecEnv, now: Date): Promise<ReportOutcome> {
  const stored = await env.drafts.get(plan.draftId, env.ctx.userId, env.ctx.orgId);
  if (!stored || stored.status !== "pendiente" || new Date(stored.draft.expiresAt).getTime() < now.getTime()) {
    return { kind: "error", message: "Ese borrador ya no está disponible (se confirmó, se descartó o caducó). Pídemelo de nuevo." };
  }
  const title = stored.draft.title;
  const resolved = async (status: "confirmado" | "descartado", message: string): Promise<ReportOutcome> => {
    await env.emit({ event: "resolved", data: { draftId: plan.draftId, status, message } });
    return { kind: "resuelto", status, message };
  };

  if (plan.action === "cancelar") {
    // Se bloquea en el servidor para que la tarjeta antigua ya no pueda confirmarlo.
    await env.drafts.claim(plan.draftId);
    env.drafts.delete(plan.draftId);
    return resolved("descartado", `Descartado: ${title}.`);
  }

  if (stored.draft.checks?.some((c) => c.status === "revisar")) {
    return { kind: "error", message: "Ese borrador tiene avisos que revisar: márcalos en la tarjeta y confírmalo desde allí." };
  }
  if (!env.confirmDraft) return { kind: "error", message: "Confírmalo con el botón de la tarjeta." };
  const result = await env.confirmDraft(plan.draftId);
  if (!result.ok) return { kind: "error", message: result.message };
  if (result.navigate) await env.emit({ event: "navigate", data: result.navigate });
  return resolved("confirmado", result.message);
}

/** El borrador corregido sustituye al anterior: este se bloquea y su tarjeta pasa a descartada. */
export async function retireDraft(draftId: string, drafts: DraftStore, emit: Emit): Promise<void> {
  await drafts.claim(draftId);
  drafts.delete(draftId);
  await emit({ event: "resolved", data: { draftId, status: "descartado", message: "Sustituido por el borrador corregido." } });
}

/** Facturas, equipo, escandallos, zonas, inventarios o proveedores: texto y tabla ya redactados. */
export async function infoStep(plan: InfoPlan, env: ExecEnv, now: Date, sessions: SessionStore): Promise<ReportOutcome> {
  if (!env.info) return { kind: "error", message: "Esa consulta no está disponible ahora mismo." };
  const result = await env.timer.time("herramientas", () =>
    runInfo(env.info!, env.ctx, {
      tool: plan.tool,
      message: env.message,
      locationIds: plan.locationIds,
      locationsChosen: !plan.locationsDefaulted,
      productNames: plan.products.map((p) => p.product.name),
      now,
    }),
  );
  if (result.table) await env.emit({ event: "table", data: result.table });
  await env.emit({ event: "navigate", data: { route: result.route, filters: {}, auto: false } });
  await offerPhrases(result.actions, env, sessions);
  return { kind: "tarea", tarea: plan.tool, text: result.text, rows: result.rows };
}

/** Botones que envían una frase ya escrita («Registrar como merma», «Validarlas»). */
export async function offerPhrases(actions: Array<{ label: string; say: string }> | undefined, env: ExecEnv, sessions: SessionStore): Promise<void> {
  if (!actions?.length) return;
  const followUps = actions.map((a) => ({ id: randomUUID().slice(0, 12), label: a.label, say: a.say }));
  sessions.setFollowUps(env.session, followUps);
  await env.emit({ event: "actions", data: { actions: followUps.map((f) => ({ id: f.id, label: f.label })) } });
}

/** Tarea de varios pasos: tabla, botones que preparan los borradores y enlace a su pantalla. */
export async function tareaStep(plan: TareaPlan, env: ExecEnv, now: Date, sessions: SessionStore): Promise<ReportOutcome> {
  const result = await env.timer.time("herramientas", () => runTarea(plan.tarea, { ctx: env.ctx, source: env.tools.source, locationIds: plan.locationIds, now }));
  if (result.table) await env.emit({ event: "table", data: result.table });
  if (result.navigate) await env.emit({ event: "navigate", data: result.navigate });
  const followUps = result.followUps.map((f) => ({ ...f, id: randomUUID().slice(0, 12) }));
  if (followUps.length > 0) {
    sessions.setFollowUps(env.session, followUps);
    await env.emit({ event: "actions", data: { actions: followUps.map((f) => ({ id: f.id, label: f.label })) } });
  }
  return { kind: "tarea", tarea: result.tarea, text: result.text, rows: result.table?.rows.length ?? 0 };
}
