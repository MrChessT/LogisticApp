// Bucle del agente por mensaje: Jev DECIDE → el código CALCULA y EJECUTA → la LLM REDACTA.
import { randomUUID } from "node:crypto";
import type { EntryType } from "@typesafe-ai/sdk";
import type { AuditSink } from "../audit/audit";
import type { AppRoute, ChatRequest, ClarifyEvent, Decision, Emit, ErrorEvent } from "../contract/index";
import type { SessionContext } from "../domain";
import type { Retriever } from "../entities/retriever";
import { asNoul, gateNoulYes } from "../jev/gates/gate";
import type { Thresholds } from "../jev/gates/thresholds";
import { CATALOG_VERSION, evaluationQuestions, label, type Intent } from "../jev/catalog";
import { JevError, type JevPort, type JevResult } from "../jev/client";
import { StageTimer, type Metrics } from "../metrics/metrics";
import { DataError } from "../supabase/client";
import type { Tools } from "../tools/tools";
import { GENERAL_NOTE, type Assistant } from "../writer/assistant";
import type { Writer } from "../writer/writer";
import { Interpreter } from "../jev/interpret";
import { needsCoherenceCheck, shortcutIntent, type ActionPlan, type CatalogPlan, type ClarifyPlan, type DocumentPlan, type Plan } from "./plans";
import { validateDraft } from "../drafts/schemas";
import type { DraftBuilder } from "../drafts/builder";
import type { DraftStore } from "../drafts/store";
import type { DecisionReport, ReportOutcome } from "./report";
import { buildRouting, type RoutingMeta } from "../jev/request";
import { activeFocus, type PendingClarify, type Session, type SessionStore } from "./session";
import { HabitsStore } from "./habits";
import { asksNewProduct, asksOrder, CANCEL_OPTION, operationOnly } from "./free-text";
import { askedRecently, insistedQuestion, resumeClarification } from "./clarify-answer";
import { asksUser, describeFocus, groundedLocations, needsUnderstanding, resolves, rewriteFollowUp } from "./comprehension";
import { nextFocus } from "./focus";
import { multiTaskTurn } from "./multi-task";
import { runQuery } from "./run-query";
import { tokenize } from "../entities/normalize";
import { corregirJerga } from "../entities/jerga";
import { documentTurn } from "./document-turn";
import { especialistaDe } from "../especialistas/mapa";
import { fueraDeAlcance } from "../especialistas/puerta";
import { dropStaleDraft } from "./stale-draft";
import { smallTalk } from "./topics";
import type { InfoSource } from "../tools/info";
import { preroute } from "./preroute";
import { formFor, readForm } from "./action-form";
import { auditEarlyTurn, auditTurn, traceEmit } from "./turn-trace";
import { rememberTask, resumeTask, settleTask, taskPrompt } from "./task-in-progress";
import { answerDraft, infoStep, offerPhrases, retireDraft, tareaStep, type ConfirmDraft, type ExecEnv } from "./execute-steps";
import { draftCorrection } from "./draft-correction";
import { recommendOrigin } from "./recommend-origin";

export interface RequestScope {
  tools?: Tools;
  audit?: AuditSink;
  sessions?: SessionStore;
  drafts?: DraftStore;
  confirmDraft?: ConfirmDraft;
  habits?: HabitsStore;
  /** Facturas, equipo, escandallos, zonas, inventarios y proveedores (con el JWT del usuario). */
  info?: InfoSource;
}

export interface AgentDeps {
  jev: JevPort;
  /** Herramientas por defecto (tests y desarrollo). En producción se pasan por petición con el JWT del usuario. */
  tools?: Tools;
  retriever: Retriever;
  writer: Writer;
  /** Aviso de un fallo no previsto al procesar un mensaje (en producción, el registro de errores). */
  onError?: (err: unknown) => void;
  /** Preguntas generales fuera de ámbito (LLM sin datos). Opcional: sin él, respuesta fija. */
  assistant?: Assistant;
  metrics: Metrics;
  thresholds: Thresholds;
  sessions: SessionStore;
  audit: AuditSink;
  selfConsistency: boolean;
  drafts: DraftStore;
  builder: DraftBuilder;
  /** Confirmación por chat en desarrollo y tests (en producción llega por petición). */
  confirmDraft?: ConfirmDraft;
  /** Hábitos del usuario (en producción, con Supabase por petición). */
  habits?: HabitsStore;
  /** Información de gestión por defecto (tests y desarrollo). */
  info?: InfoSource;
  /** Vía rápida sin Jev para preguntas de stock puras (por defecto, activada). */
  fastPath?: boolean;
  now?: () => Date;
}

function errorEvent(err: unknown): ErrorEvent {
  if (err instanceof JevError) {
    return err.code === "auth" || err.code === "invalid_request"
      ? {
          code: "internal",
          message: "El asistente no puede conectar con Jev (la clave o el AI Gateway no están bien configurados). Avisa al administrador; mientras tanto funcionan las Funciones y atajos como «/stock agua».",
          retryable: false,
        }
      : { code: "jev_unavailable", message: "El motor de decisiones no responde ahora mismo. Puedes usar atajos como «/stock agua» o «/pendientes».", retryable: true };
  }
  if (err instanceof DataError) {
    return { code: "data_unavailable", message: "No he podido leer los datos del inventario. Inténtalo de nuevo en un momento.", retryable: true };
  }
  return { code: "internal", message: "Algo ha fallado al procesar tu mensaje. Inténtalo de nuevo.", retryable: true };
}

export class Agent {
  constructor(private readonly deps: AgentDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /**
   * @param scope Recursos de la petición con el JWT del usuario (herramientas y auditoría).
   *              Sin ellos se usan los de `deps` (desarrollo y tests).
   */
  async handle(input: ChatRequest, ctx: SessionContext, emit: Emit, scope: RequestScope = {}): Promise<void> {
    const req: ChatRequest = { ...input, message: corregirJerga(input.message) }; // capa de entrada: jerga de chat
    const toolset = scope.tools ?? this.deps.tools;
    if (!toolset) throw new Error("Faltan las herramientas de datos");
    const deps = {
      ...this.deps,
      audit: scope.audit ?? this.deps.audit,
      sessions: scope.sessions ?? this.deps.sessions,
      drafts: scope.drafts ?? this.deps.drafts,
      confirmDraft: scope.confirmDraft ?? this.deps.confirmDraft,
      habits: scope.habits ?? this.deps.habits ?? new HabitsStore(),
      info: scope.info ?? this.deps.info,
    };
    const timer = new StageTimer();
    const messageId = randomUUID();
    // Lo que sale hacia el panel queda en la auditoría del turno (respuesta, aclaración, borrador), por cualquier vía.
    const traced = traceEmit(emit);
    emit = traced.emit;
    const [session, habits] = await Promise.all([deps.sessions.get(req.sessionId, ctx.userId), deps.habits.get(ctx.orgId, ctx.userId)]);
    deps.metrics.messages += 1;

    try {
      // Preguntas sobre el archivo que se dio al chat, o cargar sus ventas (document-turn.ts).
      if (req.document && !req.clarification && !req.form && !req.followUpId && (await documentTurn({ req, ctx, session, messageId, now: this.now(), elapsed: timer.total(), sessions: deps.sessions, drafts: deps.drafts, ...(deps.info ? { info: deps.info } : {}), ...(deps.retriever ? { retriever: deps.retriever } : {}), source: toolset.source, emit }))) {
        return await auditEarlyTurn(deps.audit, req, ctx, messageId, "documento", traced.seen, timer);
      }
      // Varias órdenes de oficina en una frase: un borrador por orden, sin Jev (multi-task.ts).
      if (!req.clarification && !req.form && !req.followUpId && (await multiTaskTurn({ req, ctx, session, messageId, now: this.now(), elapsed: timer.total(), sessions: deps.sessions, drafts: deps.drafts, builder: deps.builder, source: toolset.source, info: deps.info, retriever: deps.retriever, emit }))) {
        return await auditEarlyTurn(deps.audit, req, ctx, messageId, "varias_ordenes", traced.seen, timer);
      }

      let message = req.message;
      let page = req.page;
      let pageContext = req.pageContext;
      let overrides: Record<string, string> = {};
      let answers: string[] = [];
      let reuse: PendingClarify["routing"];
      let plan: Plan | null = null;
      let shortcut = false;

      // Un borrador que ya se confirmó (con el botón), se descartó o caducó no espera respuesta.
      await dropStaleDraft(session, ctx, deps.drafts, this.now());

      // Botón de seguimiento («Precios», «Consumo del mes»…): consulta ya resuelta, sin Jev.
      const followUp = req.followUpId ? session.followUps?.find((f) => f.id === req.followUpId) : undefined;
      // Un botón con frase («Registrar como merma») sigue el camino normal, como si se hubiera escrito.
      const byButton = Boolean(followUp?.plan);
      if (followUp?.plan) {
        plan = followUp.plan;
        message = followUp.label;
        shortcut = true;
      } else if (followUp?.say) message = followUp.say;

      // Miniformulario enviado: la frase completa y las decisiones fijadas con lo elegido (action-form.ts).
      const fromForm = Boolean(req.form);
      if (req.form) {
        const read = readForm(req.form, ctx);
        if ("error" in read) {
          plan = { type: "aviso", text: read.error };
          shortcut = true;
        } else {
          message = read.message;
          overrides = read.overrides;
        }
      }

      // Operación a medias tras un miniformulario: lo escrito la completa («larios», «2 botellas»; task-in-progress.ts).
      const resumed = !followUp && !fromForm && !req.clarification ? resumeTask(session, message, ctx, this.now().getTime()) : null;
      if (resumed?.cancelled) [plan, shortcut] = [{ type: "aviso", text: "Vale, lo dejo. Dime si necesitas otra cosa." }, true];
      else if (resumed) ({ message, overrides } = resumed);
      const continued = Boolean(resumed && !resumed.cancelled);

      // Corrección del borrador pendiente («mejor que sean 4», «cámbialo a Parador»): se rehace (draft-correction.ts).
      const correction = !plan && !followUp && !fromForm && !req.clarification && !continued ? await draftCorrection(message, activeFocus(session, this.now().getTime()), deps.drafts, ctx, deps.retriever, this.now()) : null;
      if (correction) ({ plan, overrides, answers, message } = { ...correction, message: correction.request });
      shortcut ||= Boolean(correction);

      // Respuesta a una aclaración: se retoma la orden original con lo contestado (ver clarify-answer.ts).
      if (req.clarification && !byButton) {
        ({ message, page, pageContext, overrides, answers, reuse, plan, shortcut } = await resumeClarification(req, session, ctx, deps.retriever, { message, page, pageContext, overrides, answers, reuse, plan, shortcut }));
      }

      // Seguimiento que depende de lo hablado («¿y sus proveedores?»): la IA lo completa antes de enrutar
      // (ver comprehension.ts). Lo reescrito sigue el camino normal; si falla, el mensaje tal cual.
      let understoodAs: string | null = null;
      if (deps.assistant?.enabled && !plan && !reuse && !req.clarification && !followUp && !fromForm && !continued) {
        understoodAs = await rewriteFollowUp(deps.assistant, message, session, activeFocus(session, this.now().getTime()), ctx, timer);
        if (understoodAs) message = understoodAs;
      }

      // «merma», «registrar merma», «nuevo producto»: empieza esa operación (Jev solo pregunta lo que falte).
      const onlyOperation = !plan && !reuse ? operationOnly(message) : null;
      if (onlyOperation) overrides = { ...overrides, intent: "proponer_accion", tipo_accion: onlyOperation };
      else if (!plan && !reuse && !continued && asksOrder(message)) overrides = { ...overrides, intent: "proponer_accion", tipo_accion: "preparar_pedido" };
      else if (!plan && !reuse && !continued && asksNewProduct(message)) overrides = { ...overrides, intent: "proponer_accion", tipo_accion: "nuevo_producto" };

      // Lo que se resuelve sin Jev (comandos, órdenes de oficina, respuestas escritas, temas claros, vía
      // rápida de stock): ver preroute.ts, con el orden de prioridad.
      if (!plan && !reuse && !fromForm && !continued) {
        const now = this.now();
        plan = await preroute(message, {
          ctx,
          session,
          retriever: deps.retriever,
          source: toolset.source,
          pageLocationId: pageContext?.locationId,
          now,
          draftPending: Boolean(activeFocus(session, now.getTime())?.draftId),
          answeringClarification: Boolean(req.clarification),
          fastPath: this.deps.fastPath !== false,
        });
        shortcut = plan !== null;
      }

      let intent: Intent;
      let decisions: Decision[] = [];
      let routing: { meta: RoutingMeta; jev: JevResult } | undefined = reuse;

      if (plan) {
        deps.metrics.shortcuts += 1;
        intent = shortcutIntent(plan);
      } else {
        if (!routing) {
          const built = await timer.time("entidades", () =>
            buildRouting(message, page, pageContext?.locationId, session.turns, ctx, deps.retriever, deps.selfConsistency, activeFocus(session, this.now().getTime())?.draftTitle),
          );
          const jev = await timer.time("jev1", () => deps.jev.evaluate(built.state as unknown as EntryType, built.questions));
          routing = { meta: built.meta, jev };
        }
        const interpretation = new Interpreter(routing.jev.answers, routing.meta, ctx, deps.thresholds, overrides, pageContext?.locationId, activeFocus(session, this.now().getTime()), habits).run();
        intent = interpretation.intent;
        decisions = interpretation.decisions;
        plan = interpretation.plan;
      }

      // Comprensión con IA (solo si Jev no ha entendido un mensaje nuevo): la IA reescribe la petición con el
      // contexto y esa petición vuelve a pasar por Jev y sus umbrales. Se adopta solo si ahora se entiende;
      // si no, sigue la aclaración de siempre. La IA nunca decide qué hacer ni da cifras.
      let skipGeneral = false;
      const focusNow = activeFocus(session, this.now().getTime());
      if (deps.assistant?.enabled && !understoodAs && !shortcut && !reuse && !req.clarification && !byButton && !fromForm && !focusNow?.draftId && needsUnderstanding(plan, message)) {
        const understanding = await timer.time("comprension", () => deps.assistant!.understand(message, { turns: session.turns, ...(focusNow ? { focus: describeFocus(focusNow, ctx) } : {}) }));
        if (understanding?.tipo === "general") {
          plan = { type: "aviso", text: `${understanding.respuesta}\n\n${GENERAL_NOTE}` };
          intent = "conversar";
          decisions = [];
        } else if (understanding?.tipo === "datos" && tokenize(understanding.consulta).join(" ") !== tokenize(message).join(" ") && !asksUser(understanding.consulta) && groundedLocations(understanding.consulta, message, session, focusNow, ctx)) {
          const again = await this.replan(understanding.consulta, page, pageContext, session, ctx, deps, timer, habits, toolset);
          if (resolves(again.plan)) {
            ({ plan, intent, decisions, routing, shortcut } = again);
            understoodAs = understanding.consulta;
            message = understanding.consulta;
          }
        } else if (understanding?.tipo === "otro") skipGeneral = true;
      }

      for (const d of decisions) deps.metrics.gates[d.gate] += 1;
      const intentDecision: Decision =
        decisions.find((d) => d.id === "intent") ??
        { id: "intent", label: "Intención", value: intent, valueLabel: label(intent), probability: 1, confidence: 1, gate: "actuar" };
      await emit({
        event: "decision",
        data: { messageId, intent: intentDecision, decisions: decisions.filter((d) => d.id !== "intent"), shortcut, especialista: especialistaDe(plan, decisions) },
      });

      const outcome = await this.execute(plan, { message, messageId, page, pageContext, overrides, answers, routing, ctx, session, emit, timer, tools: toolset, info: deps.info, decisions, audit: deps.audit, drafts: deps.drafts, confirmDraft: deps.confirmDraft, skipGeneral, ...(understoodAs ? { understoodAs } : {}) });
      settleTask(session, outcome);
      if (correction && outcome.kind === "borrador") {
        await retireDraft(correction.replaces, deps.drafts, emit);
        outcome.corrige = true;
      }
      // Lo que se entendió va delante de la respuesta: el usuario ve cómo se ha leído su mensaje.
      if (understoodAs) {
        const said = `Entiendo: «${understoodAs}».`;
        if (outcome.kind === "consulta") outcome.notices.unshift(said);
        else if (outcome.kind === "tarea") outcome.text = `${said}\n${outcome.text}`;
      }

      const report: DecisionReport = {
        version: 1,
        messageId,
        catalogVersion: CATALOG_VERSION,
        jevModel: routing?.jev.model ?? null,
        intent,
        decisions,
        outcome,
      };

      const previousFocus = session.focus;
      session.focus = nextFocus(plan, outcome, previousFocus, this.now().getTime());
      // Se aprende de lo que el usuario consulta o propone (locales y productos concretos).
      if (session.focus && session.focus !== previousFocus && (outcome.kind === "consulta" || outcome.kind === "borrador")) {
        await deps.habits.record(ctx.orgId, ctx.userId, { locationIds: session.focus.locationIds, productIds: session.focus.productIds }).catch(() => undefined);
      }

      const written = await timer.time("redaccion", () => deps.writer.write(report, emit));
      // En el historial va lo que el usuario dijo (no la orden original que se reutiliza al aclarar).
      deps.sessions.addTurn(session, { role: "user", text: req.clarification ? req.clarification.freeText ?? req.message : understoodAs || correction ? req.message : message });
      deps.sessions.addTurn(session, { role: "assistant", text: written.text });
      timer.flush(deps.metrics);
      await deps.sessions.save(req.sessionId, ctx.orgId, session).catch(() => undefined);
      await emit({ event: "done", data: { messageId, text: written.text, textSource: written.source, latencyMs: timer.total() } });

      await auditTurn(deps.audit, {
        ctx, req, messageId, message, understoodAs, intent, decisions, outcome: outcome.kind, jevModel: report.jevModel, shortcut, plan, seen: traced.seen, timer,
        via: byButton ? "boton" : fromForm ? "formulario" : continued ? "continuacion" : correction ? "correccion" : req.clarification ? "aclaracion" : understoodAs ? "comprension" : shortcut ? "atajo" : "jev",
      });
    } catch (err) {
      // El usuario ve un mensaje; el fallo se registra para poder arreglarlo (ver lib/report-error).
      this.deps.onError?.(err);
      await emit({ event: "error", data: errorEvent(err) });
    }
  }

  /**
   * Plan de una petición reescrita por la comprensión: lo mismo que un mensaje nuevo (temas sin Jev,
   * vía rápida de stock y, si no, Jev con sus umbrales). Sin aclaraciones pendientes ni anulaciones.
   */
  private async replan(
    message: string,
    page: AppRoute,
    pageContext: ChatRequest["pageContext"],
    session: Session,
    ctx: SessionContext,
    deps: AgentDeps & { retriever: Retriever },
    timer: StageTimer,
    habits: Awaited<ReturnType<HabitsStore["get"]>>,
    toolset: Tools,
  ): Promise<{ plan: Plan; intent: Intent; decisions: Decision[]; routing: { meta: RoutingMeta; jev: JevResult } | undefined; shortcut: boolean }> {
    const now = this.now();
    const quick = await preroute(message, {
      ctx,
      session,
      retriever: deps.retriever,
      source: toolset.source,
      pageLocationId: pageContext?.locationId,
      now,
      draftPending: false,
      answeringClarification: false,
      fastPath: this.deps.fastPath !== false,
      onlyQueries: true,
    });
    if (quick) return { plan: quick, intent: shortcutIntent(quick), decisions: [], routing: undefined, shortcut: true };
    const focus = activeFocus(session, this.now().getTime());
    const built = await timer.time("entidades", () => buildRouting(message, page, pageContext?.locationId, session.turns, ctx, deps.retriever, deps.selfConsistency, focus?.draftTitle));
    const jev = await timer.time("jev1", () => deps.jev.evaluate(built.state as unknown as EntryType, built.questions));
    const interpretation = new Interpreter(jev.answers, built.meta, ctx, deps.thresholds, {}, pageContext?.locationId, focus, habits).run();
    return { plan: interpretation.plan, intent: interpretation.intent, decisions: interpretation.decisions, routing: { meta: built.meta, jev }, shortcut: false };
  }

  private async clarify(original: ClarifyPlan, env: ExecEnv): Promise<ReportOutcome> {
    // Operación clara con dos datos o más por saber: se piden juntos en un miniformulario.
    const form = formFor(original, { decisions: env.decisions, overrides: env.overrides, meta: env.routing?.meta, answers: env.routing?.jev.answers, ctx: env.ctx });
    if (form) {
      rememberTask(env.session, form, this.now().getTime(), env.message, env.ctx);
      await env.emit({ event: "form", data: form });
      return { kind: "tarea", tarea: "formulario", text: taskPrompt(env.session.task), rows: 0 };
    }
    // El origen de un traspaso: primero el local al que le sobra (recommend-origin.ts).
    const plan = await recommendOrigin(original, { routing: env.routing, overrides: env.overrides, ctx: env.ctx, source: env.tools.source });
    // La misma pregunta otra vez: lo que se escribió no la contestaba. Se dice claro qué falta, con un
    // ejemplo de respuesta, y se ofrece dejarlo (nunca se manda a otra pantalla).
    const repeated = askedRecently(env.session, plan.question);
    const asked = repeated ? insistedQuestion(plan) : plan.question;
    const question = env.understoodAs ? `Entiendo: «${env.understoodAs}». ${asked}` : asked;
    const options = repeated ? [...plan.options, { id: CANCEL_OPTION, label: "Déjalo", probability: null }] : plan.options;
    const clarify: ClarifyEvent = {
      clarifyId: randomUUID().slice(0, 12),
      question,
      field: plan.field,
      options,
      allowFreeText: true,
    };
    this.deps.sessions.addClarify(env.session, {
      clarifyId: clarify.clarifyId,
      field: plan.field,
      ...(plan.segmentIndex !== undefined ? { segmentIndex: plan.segmentIndex } : {}),
      optionIds: options.map((o) => o.id),
      optionLabels: options.map((o) => o.label),
      ...(plan.restart ? { restart: true } : {}),
      message: env.message,
      page: env.page,
      ...(env.pageContext ? { pageContext: env.pageContext } : {}),
      ...(env.routing ? { routing: env.routing } : { fromShortcut: true }),
      overrides: env.overrides,
      ...(env.answers.length ? { answers: env.answers } : {}),
    });
    await env.emit({ event: "clarify", data: clarify });
    return { kind: "aclaracion", clarify };
  }

  /**
   * Borrador: el código lo construye y valida; Jev comprueba su coherencia (y, en el catálogo, revisa
   * duplicados, sentido y plausibilidad en la misma llamada); el usuario lo confirma.
   */
  private async draft(plan: ActionPlan | CatalogPlan | DocumentPlan, env: ExecEnv): Promise<ReportOutcome> {
    const { deps } = this;
    const built = await env.timer.time("herramientas", () =>
      deps.builder.build({ plan, message: env.message, ctx: env.ctx, source: env.tools.source, ...(env.info ? { info: env.info } : {}), retriever: deps.retriever, overrides: env.overrides, now: this.now() } as Parameters<DraftBuilder["build"]>[0]),
    );
    if (built.kind === "clarify") return this.clarify(built.plan, env);
    if (built.kind === "error") {
      if (built.navigate) await env.emit({ event: "navigate", data: built.navigate });
      return { kind: "error", message: built.message };
    }

    let draft = built.draft;
    const review = built.review;
    let coherence: number | null = null;
    let answers: Awaited<ReturnType<JevPort["evaluate"]>>["answers"] = {};
    // Un producto que el usuario nombró al responder «¿qué producto?» ya es la decisión: no hace falta comprobarla.
    const check = (review !== undefined || needsCoherenceCheck(plan)) && env.overrides.producto_elegido === undefined;
    if (check) {
      try {
        // La petición con lo respondido después: «pasa larios al Vivero» + «cantidad: 3» + «formato: Caja 6».
        const request = env.answers.length ? `${env.message} (después respondió: ${env.answers.join("; ")})` : env.message;
        const state = { request, draft: built.summary, ...(review?.state ?? {}) };
        const questions = { ...evaluationQuestions([], true), ...(review?.questions ?? {}) };
        ({ answers } = await env.timer.time("jev2", () => deps.jev.evaluate(state, questions)));
        coherence = asNoul(answers.coherencia)?.noul ?? null;
      } catch {
        coherence = null;
      }
    }
    if (review) {
      const reviewed = review.apply(answers, deps.thresholds);
      if (reviewed.kind === "clarify") return this.clarify(reviewed.plan, env);
      if (reviewed.kind === "error") {
        if (reviewed.navigate) await env.emit({ event: "navigate", data: reviewed.navigate });
        return { kind: "error", message: reviewed.message };
      }
    }
    draft = validateDraft(draft);
    if (env.overrides.uno_a_uno) draft.warnings.unshift("Van de uno en uno: confirma este y vuelve a pedírmelo para el siguiente.");
    if (plan.type === "accion" && plan.reviewAll) draft.warnings.unshift("Revisa los datos antes de confirmar: puede que falte algo de lo que querías.");
    if (coherence === null && check) {
      draft.warnings.unshift("No he podido comprobar el borrador: revísalo con atención.");
    } else if (coherence !== null) {
      draft.coherence = coherence;
      const gate = gateNoulYes({ type: "noul", noul: coherence }, deps.thresholds.coherencia);
      env.decisions.push({ id: "coherencia", label: "Coherencia del borrador", value: gate, valueLabel: gate === "actuar" ? "Coincide con la petición" : "Revisar", probability: coherence, confidence: null, gate });
      if (gate === "preguntar") {
        return this.clarify(
          { type: "clarify", field: "tipo_accion", question: "No estoy seguro de haber entendido la operación. ¿Me la repites con el producto, la cantidad y el local?", options: [], restart: true },
          env,
        );
      }
      if (gate === "confirmar") draft.warnings.unshift("Revisa los datos: puede que no coincida del todo con lo que pediste.");
    }

    await env.drafts.save({ draft, orgId: env.ctx.orgId, userId: env.ctx.userId, messageId: env.messageId, request: env.message });
    await env.emit({ event: "draft", data: draft });
    await env.audit
      .record({ type: "borrador", at: this.now().toISOString(), userId: env.ctx.userId, orgId: env.ctx.orgId, messageId: env.messageId, draftId: draft.draftId, kind: draft.kind, coherence: draft.coherence })
      .catch(() => undefined);
    return { kind: "borrador", draft };
  }

  /**
   * «Sí, adelante» / «cancélalo» sobre el borrador pendiente. Confirmar pasa por el mismo servicio
   * que el botón (dueño, caducidad, rol, idempotencia). Con avisos en «revisar» no se confirma por
   * chat: hay que marcarlos en la tarjeta.
   */
  private async execute(plan: Plan, env: ExecEnv): Promise<ReportOutcome> {
    const { ctx, emit } = env;
    // Puerta por especialista y por cuentas: lo que el perfil no puede usar o no ve recibe un aviso sin cifras.
    const fuera = fueraDeAlcance(plan, ctx, env.message, env.decisions);
    if (fuera) return this.execute(fuera, env);
    this.deps.metrics.recordEspecialista(especialistaDe(plan, env.decisions));
    switch (plan.type) {
      case "clarify":
        return this.clarify(plan, env);
      case "conversar": {
        const charla = smallTalk(env.message);
        return charla ? { kind: "conversacion", charla } : { kind: "conversacion" };
      }
      case "fuera_de_ambito": {
        const general = env.skipGeneral ? null : await this.deps.assistant?.general(env.message);
        return general ? { kind: "fuera_de_ambito", general } : { kind: "fuera_de_ambito" };
      }
      case "aviso":
        if (plan.route) await emit({ event: "navigate", data: { route: plan.route, filters: plan.filters ?? {}, auto: plan.go ?? false } });
        await offerPhrases(plan.actions, env, this.deps.sessions);
        return { kind: "tarea", tarea: "aviso", text: plan.text, rows: 0 };
      case "bloqueado":
        return { kind: "bloqueado" };
      case "info":
        return infoStep(plan, env, this.now(), this.deps.sessions);
      case "accion":
      case "catalogo":
      case "documento":
        return this.draft(plan, env);
      case "borrador":
        return answerDraft(plan, env, this.now());
      case "consultar":
        return runQuery(this.deps, this.now(), plan, env.message, ctx, emit, env.timer, env.tools, env.session);
      case "tarea":
        return tareaStep(plan, env, this.now(), this.deps.sessions);
    }
  }

}

