// Bucle del agente por mensaje: Jev DECIDE → el código CALCULA y EJECUTA → la LLM REDACTA.
import { randomUUID } from "node:crypto";
import type { EntryType } from "@typesafe-ai/sdk";
import type { AuditSink } from "../audit/audit";
import type { AppRoute, ChatRequest, ClarifyEvent, Decision, Emit, ErrorEvent } from "../contract/index";
import type { SessionContext } from "../domain";
import type { Retriever } from "../entities/retriever";
import { asNoul, asScore, gateNoulYes } from "../gates/gate";
import type { Thresholds } from "../gates/thresholds";
import { CATALOG_VERSION, evaluationQuestions, label, URGENCY_KEYS, type Intent } from "../jev/catalog";
import { JevError, type JevPort, type JevResult } from "../jev/client";
import { runTarea, type TareaPlan } from "../skills/tareas";
import { StageTimer, type Metrics } from "../metrics/metrics";
import { DataError } from "../supabase/client";
import { Analytics, VIEW_FOR_TOOL } from "../analytics/analytics";
import { businessDay } from "../../lib/business-day";
import { daysInclusive, horizon, pastPeriod } from "../tools/periods";
import type { ToolName, Tools } from "../tools/tools";
import { movementTypesIn, type EvalItem, type ToolParams } from "../tools/types";
import type { Assistant } from "../writer/assistant";
import type { Writer } from "../writer/writer";
import { Interpreter, locationLabel, type ActionPlan, type CatalogPlan, type ClarifyPlan, type DocumentPlan, type Plan, type QueryPlan } from "./interpret";
import { validateDraft } from "../drafts/schemas";
import type { DraftBuilder } from "../drafts/builder";
import type { DraftStore } from "../drafts/store";
import type { DecisionReport, Evaluation, ReportOutcome } from "./report";
import { buildRouting, referencesPrevious, wantsAreaBreakdown, type RoutingMeta } from "./routing";
import { activeFocus, type Focus, type PendingClarify, type Session, type SessionStore } from "./session";
import { HabitsStore } from "./habits";
import type { Draft } from "../contract/index";
import type { ConfirmResponse } from "../drafts/confirm";
import { isShortcut, resolveShortcut, tareaTopicOf } from "./shortcuts";
import { CANCEL_OPTION, changesOperation, ENTITY_FIELDS, fieldOverrides, isNewQuestion, NAME_FIELDS, operationOf, operationOnly, readFreeText, type FreeTextAnswer } from "./free-text";
import { tokenize } from "../entities/normalize";
import { reorderTable, tableFor } from "../writer/table";
import { followUpsFor } from "./followups";
import { fastStockPlan } from "./fast-path";
import { consumptionByHand, screenHelp, topicReply } from "./topics";
import { infoTopicOf, runInfo, type InfoSource } from "../tools/info";
import type { InfoPlan } from "./interpret";

/** Confirma un borrador con el mismo servicio (y las mismas comprobaciones) que el botón. */
export type ConfirmDraft = (draftId: string) => Promise<ConfirmResponse>;

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

/** Máximo de ítems evaluados por Jev en la llamada nº 2. */
const MAX_EVAL_ITEMS = 15;

/** Pantalla a la que lleva cada consulta ("Ver en…"). Las que tienen gráfica van a /informes. */
const TOOL_ROUTE: Record<ToolName, AppRoute> = {
  query_stock: "/stock",
  query_movements: "/informes",
  query_prices: "/informes",
  query_pending_transfers: "/traspasos",
  query_count_variance: "/informes",
  query_reorder: "/informes",
  query_orders: "/pedidos",
  query_spend: "/recepciones",
  query_product: "/productos",
  query_top_usage: "/informes",
};

/** Consultas cuya gráfica repite la tabla. */
const CHART_REPEATS_TABLE = new Set<ToolName>(["query_stock", "query_spend"]);

const DEFAULT_PERIOD: Partial<Record<ToolName, "semana" | "mes">> = { query_movements: "semana", query_spend: "mes", query_top_usage: "mes" };

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
  async handle(req: ChatRequest, ctx: SessionContext, emit: Emit, scope: RequestScope = {}): Promise<void> {
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
    const [session, habits] = await Promise.all([deps.sessions.get(req.sessionId, ctx.userId), deps.habits.get(ctx.orgId, ctx.userId)]);
    deps.metrics.messages += 1;

    try {
      let message = req.message;
      let page = req.page;
      let pageContext = req.pageContext;
      let overrides: Record<string, string> = {};
      let answers: string[] = [];
      let reuse: PendingClarify["routing"];
      let plan: Plan | null = null;
      let shortcut = false;

      // Un borrador que ya se confirmó (con el botón), se descartó o caducó no espera respuesta.
      await this.dropStaleDraft(session, ctx, deps.drafts);

      // Botón de seguimiento («Precios», «Consumo del mes»…): consulta ya resuelta, sin Jev.
      const followUp = req.followUpId ? session.followUps?.find((f) => f.id === req.followUpId) : undefined;
      if (followUp) {
        plan = followUp.plan;
        message = followUp.label;
        shortcut = true;
      }

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
        } else if (option === null && !typed && NAME_FIELDS.has(pending.field) && pending.routing && !changes && !isNewQuestion(text)) {
          // «¿Cómo se llama el producto nuevo?» → «Prueba Luis»: es el nombre, se sigue con la misma orden.
          const { sentido: _sentido, ...rest } = pending.overrides;
          void _sentido;
          message = pending.message;
          page = pending.page;
          pageContext = pending.pageContext;
          overrides = { ...rest, nombre: text };
          answers = answered(text);
          reuse = pending.routing;
        } else if (option !== null && pending.fromShortcut) {
          message = pending.message;
          page = pending.page;
          pageContext = pending.pageContext;
          const product = ctx.products.find((p) => p.name === option);
          plan = await resolveShortcut(pending.message, ctx, deps.retriever, pageContext?.locationId, product);
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
      } else if (req.clarification && !followUp) {
        // La aclaración ya no está (sesión perdida o caducada). Si era el nombre de un producto nuevo, lo
        // escrito sigue siendo ese nombre: se retoma el alta en vez de leerlo como un mensaje suelto.
        const text = (req.clarification.freeText ?? req.message).trim();
        console.warn("copiloto: aclaración no encontrada", { field: req.clarification.field ?? null });
        if (req.clarification.field === "nombre" && operationOf(text) === null) {
          message = `nuevo producto «${text.replace(/[«»"]/g, "")}»`;
          overrides = { intent: "proponer_accion", tipo_accion: "nuevo_producto" };
        }
      }

      // «merma», «registrar merma», «nuevo producto»: empieza esa operación (Jev solo pregunta lo que falte).
      const onlyOperation = !plan && !reuse ? operationOnly(message) : null;
      if (onlyOperation) overrides = { ...overrides, intent: "proponer_accion", tipo_accion: onlyOperation };

      if (!plan && !reuse && isShortcut(message)) {
        plan = await resolveShortcut(message, ctx, deps.retriever, pageContext?.locationId);
        shortcut = plan !== null;
      }

      // Lo que no es del inventario (personal, ventas), el consumo «a mano» y «olvídalo»: respuesta fija.
      if (!plan && !reuse && !req.followUpId) {
        const topic = topicReply(message) ?? screenHelp(message, ctx.locations.map((l) => l.name)) ?? consumptionByHand(message);
        if (topic) {
          plan = { type: "aviso", text: topic.text, ...(topic.route ? { route: topic.route } : {}) };
          shortcut = true;
          session.clarifies.clear();
        }
      }

      // Facturas, equipo, escandallos, zonas, inventarios o proveedores dichos claramente: sin Jev (solo lectura).
      if (!plan && !reuse && !req.clarification && !activeFocus(session, this.now().getTime())?.draftId) {
        const tarea = tareaTopicOf(message);
        const infoTool = tarea ? null : infoTopicOf(message);
        if (tarea) {
          const named = namedLocations(ctx.locations, message);
          plan = { type: "tarea", tarea, locationIds: named.length > 0 ? named.map((l) => l.id) : pageContext?.locationId ? [pageContext.locationId] : ctx.locations.map((l) => l.id) };
          shortcut = true;
        } else if (infoTool) {
          const named = namedLocations(ctx.locations, message);
          const ids = named.length > 0 ? named.map((l) => l.id) : pageContext?.locationId ? [pageContext.locationId] : ctx.locations.map((l) => l.id);
          plan = { type: "info", tool: infoTool, locationIds: ids, locationsDefaulted: named.length === 0 && !pageContext?.locationId, products: [], periodo: "no_indicado" };
          shortcut = true;
        }
      }

      // Vía rápida: «¿cuántas cocas quedan en el Vivero?» sin llamar a Jev (solo lectura, solo si el
      // mensaje no dice nada más). Con un borrador esperando respuesta decide Jev.
      if (this.deps.fastPath !== false && !plan && !reuse && !req.clarification && !activeFocus(session, this.now().getTime())?.draftId) {
        plan = await fastStockPlan(message, ctx, deps.retriever);
        shortcut = plan !== null;
      }

      let intent: Intent;
      let decisions: Decision[] = [];
      let routing: { meta: RoutingMeta; jev: JevResult } | undefined = reuse;

      if (plan) {
        deps.metrics.shortcuts += 1;
        intent =
          plan.type === "conversar" || plan.type === "aviso"
              ? "conversar"
              : plan.type === "catalogo" || plan.type === "accion"
                ? "proponer_accion"
                : plan.type === "tarea"
                  ? "pedir_sugerencias"
                  : "consultar";
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

      for (const d of decisions) deps.metrics.gates[d.gate] += 1;
      const intentDecision: Decision =
        decisions.find((d) => d.id === "intent") ??
        { id: "intent", label: "Intención", value: intent, valueLabel: label(intent), probability: 1, confidence: 1, gate: "actuar" };
      await emit({
        event: "decision",
        data: { messageId, intent: intentDecision, decisions: decisions.filter((d) => d.id !== "intent"), shortcut },
      });

      const outcome = await this.execute(plan, { message, messageId, page, pageContext, overrides, answers, routing, ctx, session, emit, timer, tools: toolset, info: deps.info, decisions, audit: deps.audit, drafts: deps.drafts, confirmDraft: deps.confirmDraft });

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
      deps.sessions.addTurn(session, { role: "user", text: req.clarification ? req.clarification.freeText ?? req.message : message });
      deps.sessions.addTurn(session, { role: "assistant", text: written.text });
      timer.flush(deps.metrics);
      await deps.sessions.save(req.sessionId, ctx.orgId, session).catch(() => undefined);
      await emit({ event: "done", data: { messageId, text: written.text, textSource: written.source, latencyMs: timer.total() } });

      const at = new Date().toISOString();
      const audit =
        plan.type === "bloqueado"
          ? deps.audit.record({ type: "bloqueo", at, userId: ctx.userId, orgId: ctx.orgId, messageId, reason: "inyeccion" })
          : deps.audit.record({
              type: "mensaje",
              at,
              userId: ctx.userId,
              orgId: ctx.orgId,
              sessionId: req.sessionId,
              messageId,
              message,
              intent,
              decisions,
              outcome: outcome.kind,
              jevModel: report.jevModel,
              catalogVersion: CATALOG_VERSION,
              shortcut,
            });
      await audit.catch(() => undefined);
    } catch (err) {
      await emit({ event: "error", data: errorEvent(err) });
    }
  }

  private async dropStaleDraft(session: Session, ctx: SessionContext, drafts: DraftStore): Promise<void> {
    const draftId = session.focus?.draftId;
    if (!draftId || !session.focus) return;
    const stored = await drafts.get(draftId, ctx.userId, ctx.orgId).catch(() => undefined);
    if (stored && stored.status === "pendiente" && new Date(stored.draft.expiresAt).getTime() >= this.now().getTime()) return;
    const { draftId: _draftId, draftTitle: _draftTitle, ...rest } = session.focus;
    void _draftId;
    void _draftTitle;
    session.focus = rest;
  }

  private async clarify(plan: ClarifyPlan, env: ExecEnv): Promise<ReportOutcome> {
    // La misma pregunta otra vez: lo que se escribió no la contestaba. Se dice claro qué falta, con un
    // ejemplo de respuesta, y se ofrece dejarlo (nunca se manda a otra pantalla).
    const repeated = askedRecently(env.session, plan.question);
    const question = repeated ? `Me falta ese dato para seguir. ${plan.question}${ANSWER_HINT[plan.field] ? ` ${ANSWER_HINT[plan.field]}` : ""}` : plan.question;
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
      deps.builder.build({ plan, message: env.message, ctx: env.ctx, source: env.tools.source, overrides: env.overrides, now: this.now() } as Parameters<DraftBuilder["build"]>[0]),
    );
    if (built.kind === "clarify") return this.clarify(built.plan, env);
    if (built.kind === "error") {
      if (built.navigate) await env.emit({ event: "navigate", data: built.navigate });
      return { kind: "error", message: built.message };
    }

    let draft = built.draft;
    const review = built.review;
    let coherence: number | null;
    let answers: Awaited<ReturnType<JevPort["evaluate"]>>["answers"] = {};
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
    if (coherence === null) {
      draft.warnings.unshift("No he podido comprobar el borrador: revísalo con atención.");
    } else {
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
  private async answerDraft(plan: Extract<Plan, { type: "borrador" }>, env: ExecEnv): Promise<ReportOutcome> {
    const stored = await env.drafts.get(plan.draftId, env.ctx.userId, env.ctx.orgId);
    if (!stored || stored.status !== "pendiente" || new Date(stored.draft.expiresAt).getTime() < this.now().getTime()) {
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

  private async execute(plan: Plan, env: ExecEnv): Promise<ReportOutcome> {
    const { ctx, emit } = env;
    switch (plan.type) {
      case "clarify":
        return this.clarify(plan, env);
      case "conversar": {
        const charla = smallTalk(env.message);
        return charla ? { kind: "conversacion", charla } : { kind: "conversacion" };
      }
      case "fuera_de_ambito": {
        const general = await this.deps.assistant?.general(env.message);
        return general ? { kind: "fuera_de_ambito", general } : { kind: "fuera_de_ambito" };
      }
      case "aviso":
        if (plan.route) await emit({ event: "navigate", data: { route: plan.route, filters: {}, auto: false } });
        return { kind: "tarea", tarea: "aviso", text: plan.text, rows: 0 };
      case "bloqueado":
        return { kind: "bloqueado" };
      case "info":
        return this.info(plan, env);
      case "accion":
      case "catalogo":
      case "documento":
        return this.draft(plan, env);
      case "borrador":
        return this.answerDraft(plan, env);
      case "consultar":
        return this.query(plan, env.message, ctx, emit, env.timer, env.tools, env.session);
      case "tarea":
        return this.tarea(plan, env);
    }
  }

  /** Facturas, equipo, escandallos, zonas, inventarios o proveedores: texto y tabla ya redactados. */
  private async info(plan: InfoPlan, env: ExecEnv): Promise<ReportOutcome> {
    if (!env.info) return { kind: "error", message: "Esa consulta no está disponible ahora mismo." };
    const result = await env.timer.time("herramientas", () =>
      runInfo(env.info!, env.ctx, {
        tool: plan.tool,
        message: env.message,
        locationIds: plan.locationIds,
        locationsChosen: !plan.locationsDefaulted,
        productNames: plan.products.map((p) => p.product.name),
        now: this.now(),
      }),
    );
    if (result.table) await env.emit({ event: "table", data: result.table });
    await env.emit({ event: "navigate", data: { route: result.route, filters: {}, auto: false } });
    return { kind: "tarea", tarea: plan.tool, text: result.text, rows: result.rows };
  }

  /** Tarea de varios pasos: tabla, botones que preparan los borradores y enlace a su pantalla. */
  private async tarea(plan: TareaPlan, env: ExecEnv): Promise<ReportOutcome> {
    const result = await env.timer.time("herramientas", () => runTarea(plan.tarea, { ctx: env.ctx, source: env.tools.source, locationIds: plan.locationIds, now: this.now() }));
    if (result.table) await env.emit({ event: "table", data: result.table });
    if (result.navigate) await env.emit({ event: "navigate", data: result.navigate });
    const followUps = result.followUps.map((f) => ({ ...f, id: randomUUID().slice(0, 12) }));
    if (followUps.length > 0) {
      this.deps.sessions.setFollowUps(env.session, followUps);
      await env.emit({ event: "actions", data: { actions: followUps.map((f) => ({ id: f.id, label: f.label })) } });
    }
    return { kind: "tarea", tarea: result.tarea, text: result.text, rows: result.table?.rows.length ?? 0 };
  }

  private async query(plan: QueryPlan, message: string, ctx: SessionContext, emit: Emit, timer: StageTimer, tools: Tools, session: Session): Promise<ReportOutcome> {
    const now = this.now();
    const tzLocation = ctx.locations.find((l) => l.id === plan.locationIds[0]);
    const today = businessDay(now, tzLocation?.timezone ?? "Europe/Madrid", tzLocation?.dayCutoff ?? "06:00");
    const fallback = DEFAULT_PERIOD[plan.tool];
    const period = fallback || plan.periodo !== "no_indicado" ? pastPeriod(plan.periodo, today, message, fallback ?? "mes") : null;
    const h = horizon(plan.periodo, today);
    const params: ToolParams = {
      locationIds: plan.locationIds,
      areaId: plan.areaId,
      productIds: plan.products.map((p) => p.product.id),
      period,
      horizonDays: h.days,
      horizonLabel: h.label,
      now,
      ...(plan.tool === "query_stock" && wantsAreaBreakdown(message) ? { byArea: true } : {}),
      ...(plan.tool === "query_movements" ? movementFilter(message, plan, session) : {}),
    };

    let result = await timer.time("herramientas", () => tools.run(plan.tool, params, ctx));
    // «¿qué hay en cada sección?» sin stock repartido por zonas: no es «no hay stock», es que no hay
    // secciones con stock. Se dice y se enseña el total del local.
    const noSections = params.byArea === true && result.count === 0;
    if (noSections) result = await timer.time("herramientas", () => tools.run(plan.tool, { ...params, byArea: false }, ctx));
    // «En tus 4 locales» ya lo dice el titular: sin avisos que lo repitan.
    // Lo heredado («¿y en Parador?») ya se ve en el titular («Stock de Barceló en Parador»); solo
    // «los mismos productos» (el titular dice «de 7 productos») necesita decirse.
    const notices: string[] = [];
    if (plan.inherited?.includes("los mismos productos")) notices.push("Sigo con los mismos productos.");
    if (noSections) notices.push("Aún no hay stock repartido por secciones aquí (se reparte al contar por zonas); te enseño el total.");

    // Lo que ya se sabe sale ya: la tabla no espera a la valoración de Jev (llamada nº 2), y la gráfica
    // se calcula a la vez que esa valoración.
    const evaluated = result.evalItems.length > 0;
    const table = tableFor(result, evaluated, plan.dato);
    if (table) await emit({ event: "table", data: table });

    // «¿cuánto ron hay en el Parador?» y allí no queda: dónde sí hay, en vez de solo «no hay».
    let elsewhere: string[] | undefined;
    if (plan.tool === "query_stock" && result.count === 0 && plan.locationIds.length === 1 && plan.products.length > 0 && ctx.locations.length > 1) {
      const all = await timer.time("herramientas", () => tools.run("query_stock", { ...params, locationIds: ctx.locations.map((l) => l.id), areaId: null, byArea: false }, ctx));
      if (all.count > 0) {
        const places = new Set(all.rows.flatMap((r) => String(r.desglose ?? r.local ?? "").split(" · ").map((part) => part.replace(/\s+\d.*$/, "").trim())).filter(Boolean));
        elsewhere = ctx.locations.map((l) => l.name).filter((name) => places.has(name));
        const other = tableFor(all, false, plan.dato);
        if (other) await emit({ event: "table", data: other });
        // Con un solo producto no hay tabla: el reparto va en el texto.
        else elsewhere = [...elsewhere, ...all.rows.map((r) => `— ${r.producto}: ${r.desglose ?? r.cantidad}`)];
      }
    }

    const scope = {
      locales: plan.locationIds.map((id) => locationLabel(ctx, id)),
      espacio: plan.areaId ? ctx.areas.find((a) => a.id === plan.areaId)?.name ?? null : null,
      productos: plan.products.map((p) => p.product.name),
      periodo: plan.tool === "query_reorder" ? h.label : period?.label ?? null,
      ...(plan.familia ? { familia: plan.familia } : {}),
    };

    // Gráfica calculada por el código (decimal.js), solo si añade algo a la tabla: el stock y el gasto
    // por proveedor serían las mismas cifras en barras (y así se ahorra su consulta).
    const days = period ? daysInclusive(period.from, period.to) : 30;
    const chartPromise =
      table && CHART_REPEATS_TABLE.has(plan.tool)
        ? Promise.resolve(null)
        : timer
            .time("herramientas", () =>
              new Analytics(tools.source).chartForTool(
                plan.tool,
                { ctx, locationIds: plan.locationIds, productIds: plan.products.map((p) => p.product.id), days: Math.max(days, 7), now },
                h.days,
              ),
            )
            .catch(() => null);
    const [evaluations, chart] = await Promise.all([timer.time("jev2", () => this.evaluate(result.evalItems, message, h.label)), chartPromise]);
    if (evaluated && evaluations === null) notices.push("No he podido valorar la urgencia; te muestro los datos tal cual.");
    // Reposición: en tabla, ya ordenada por la urgencia que ha valorado Jev.
    const reorder = !table ? reorderTable(result, evaluations ?? []) : null;
    if (reorder) await emit({ event: "table", data: reorder });
    if (chart) await emit({ event: "chart", data: chart });

    const route = TOOL_ROUTE[plan.tool];
    await emit({
      event: "navigate",
      data: {
        route,
        filters: {
          ...(route === "/informes" ? { view: params.movementTypes?.includes("waste") ? "mermas" : VIEW_FOR_TOOL[plan.tool], days: Math.max(days, 7) } : {}),
          ...(plan.locationIds.length === 1 ? { locationId: plan.locationIds[0]! } : {}),
          ...(plan.areaId ? { areaId: plan.areaId } : {}),
          ...(plan.products.length === 1 ? { productId: plan.products[0]!.product.id } : {}),
          ...(plan.tool === "query_pending_transfers" ? { status: "in_transit" } : {}),
        },
        auto: false,
      },
    });

    // Botones para seguir («Precios», «Consumo del mes», «Ficha»…): se ejecutan sin Jev.
    const followUps = followUpsFor(plan, result.rows.some((r) => r.bajo_minimo === true)).map((f) => ({ ...f, id: randomUUID().slice(0, 12) }));
    if (followUps.length > 0 && result.count > 0) {
      this.deps.sessions.setFollowUps(session, followUps);
      await emit({ event: "actions", data: { actions: followUps.map((f) => ({ id: f.id, label: f.label })) } });
    }

    return {
      kind: "consulta",
      tool: plan.tool,
      scope,
      result,
      evaluations: evaluations ?? [],
      notices,
      ...(table || reorder ? { tabulated: true } : {}),
      ...(plan.dato ? { dato: plan.dato } : {}),
      ...(elsewhere?.length ? { elsewhere } : {}),
    };
  }

  /** Llamada nº 2: Jev juzga las cifras calculadas. Devuelve null si Jev falla (se degrada sin valoración). */
  private async evaluate(items: EvalItem[], request: string, horizonLabel: string): Promise<Evaluation[] | null> {
    if (items.length === 0) return [];
    const selected = items.slice(0, MAX_EVAL_ITEMS);
    const state = { request, horizon: horizonLabel, items: selected.map((i) => i.data) };
    try {
      const { answers } = await this.deps.jev.evaluate(state, evaluationQuestions(selected.map((i) => i.kind), false));
      return selected.map((item, i) => {
        const relevance = asNoul(answers[`${item.kind}_${i}`])?.noul ?? 0;
        const urgency = asScore(answers[`urgencia_${i}`]);
        const level = Math.max(0, Math.min(3, Math.round(urgency?.score ?? 0)));
        return {
          kind: item.kind,
          data: item.data,
          relevance,
          urgency: URGENCY_KEYS[level]!,
          urgencyScore: urgency?.score ?? 0,
          confidence: urgency?.confidence ?? 0,
        };
      });
    } catch {
      return null;
    }
  }
}

interface ExecEnv {
  message: string;
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

/** Saludo, agradecimiento o despedida corta («gracias!», «buenas», «hasta luego»). */
export function smallTalk(message: string): "hola" | "gracias" | "adios" | undefined {
  const words = tokenize(message);
  if (words.length === 0 || words.length > 5) return undefined;
  const text = words.join(" ");
  if (/^(muchas |mil )?gracias\b|^(genial|perfecto|vale|ok|estupendo)( muchas)? gracias\b|^thanks?\b/.test(text)) return "gracias";
  if (/^(adios|hasta luego|hasta manana|chao|nos vemos|bye)\b/.test(text)) return "adios";
  if (/^(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|ey)\b/.test(text)) return "hola";
  return undefined;
}

/**
 * Tipos de movimiento: los que nombra el mensaje o, si continúa el anterior («¿y en el Vivero?» tras
 * «¿cuántas mermas en La Oliva?»), los de ese mensaje.
 */
function movementFilter(message: string, plan: QueryPlan, session: Session): { movementTypes?: ToolParams["movementTypes"] } {
  const own = movementTypesIn(message);
  if (own.length > 0) return { movementTypes: own };
  if (!plan.inherited?.length && !referencesPrevious(message)) return {};
  const previous = [...session.turns].reverse().find((t) => t.role === "user");
  const types = previous ? movementTypesIn(previous.text) : [];
  return types.length > 0 ? { movementTypes: types } : {};
}

/** Productos y locales que menciona un borrador (para heredarlos en el siguiente mensaje). */
function draftRefs(draft: Draft): { locationIds: string[]; productIds: string[] } {
  const d = draft as unknown as Record<string, unknown>;
  const locationIds = [d.locationId, d.fromLocationId].filter((v): v is string => typeof v === "string");
  const lines = (Array.isArray(d.lines) ? d.lines : Array.isArray(d.orders) ? (d.orders as Array<{ lines: unknown[] }>).flatMap((o) => o.lines) : []) as Array<{ productId?: string }>;
  const productIds = [d.productId, ...lines.map((l) => l.productId)].filter((v): v is string => typeof v === "string");
  return { locationIds, productIds: [...new Set(productIds)] };
}

/** Foco tras responder: lo consultado o propuesto. Aclaraciones y charla no lo cambian. */
function nextFocus(plan: Plan, outcome: ReportOutcome, previous: Focus | undefined, now: number): Focus | undefined {
  if (outcome.kind === "consulta" && plan.type === "consultar") {
    return {
      kind: "consulta",
      tool: plan.tool,
      locationIds: plan.locationsDefaulted ? [] : plan.locationIds,
      productIds: plan.products.map((p) => p.product.id),
      periodo: plan.periodo,
      at: now,
    };
  }
  if (outcome.kind === "resuelto") {
    // El borrador ya no está pendiente; el tema sigue siendo lo que trataba.
    if (!previous) return undefined;
    const { draftId: _draftId, draftTitle: _draftTitle, ...rest } = previous;
    void _draftId;
    void _draftTitle;
    return { ...rest, at: now };
  }
  if (outcome.kind === "borrador") {
    return {
      kind: "borrador",
      accion: outcome.draft.kind,
      ...draftRefs(outcome.draft),
      periodo: "no_indicado",
      draftId: outcome.draft.draftId,
      draftTitle: outcome.draft.title,
      at: now,
    };
  }
  // Tras una aclaración, una navegación o una charla, lo anterior sigue siendo el tema.
  return previous ? { ...previous, at: previous.at } : undefined;
}

/** ¿Se hizo esta misma pregunta en los últimos turnos del asistente? (bucle de aclaraciones) */
function askedRecently(session: Session, question: string): boolean {
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

/** Locales nombrados en el mensaje por sus palabras con sentido («la» de «La Oliva» no cuenta: «la caja de ayer»). */
export function namedLocations<L extends { name: string }>(locations: readonly L[], message: string): L[] {
  const words = new Set(tokenize(message));
  return locations.filter((l) => tokenize(l.name).some((w) => w.length > 2 && words.has(w)));
}
