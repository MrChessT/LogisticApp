// Respuestas de la llamada nº 1 → plan, aplicando la compuerta de confianza de cada decisión.
// Cero adivinanzas: si una decisión en juego no llega a su umbral, el plan es una aclaración.
import type { Decision } from "../../contract/index";
import type { SessionContext } from "../../domain";
import { asChoice, asNoul, gateChoice, gateNoulNo, worst } from "../gates/gate";
import type { Thresholds } from "../gates/thresholds";
import { label, NINGUNO, type Intent } from "../catalog";
import type { JevAnswer } from "../client";
import type { RoutingMeta } from "../request";
import type { Focus } from "../../agent/session";
import type { Habits } from "../../agent/habits";
import type { Plan } from "../../agent/plans";
import { JevReading } from "./reading";
import { actionCorroborates, action } from "./action";
import { queryCorroborates, query } from "./query";

export interface Interpretation {
  intent: Intent;
  decisions: Decision[];
  plan: Plan;
}

/** Respuestas de intent_alt compatibles con cada intención (navegar o conversar pueden leerse como "leer"). */
const INTENT_ALT_EXPECTED: Record<Intent, string[]> = {
  consultar: ["leer"],
  pedir_sugerencias: ["leer"],
  proponer_accion: ["cambiar"],
  // Conversar tampoco escribe nada: «¿cómo hago un traspaso?» suena a «cambiar» (0,63) y es ayuda (1,00).
  conversar: ["ninguno", "leer", "cambiar"],
  fuera_de_ambito: ["ninguno", "leer"],
};

export class Interpreter {
  private readonly r: JevReading;

  constructor(
    answers: Record<string, JevAnswer>,
    meta: RoutingMeta,
    ctx: SessionContext,
    thresholds: Thresholds,
    overrides: Record<string, string>,
    pageLocationId: string | undefined,
    /** Foco vigente de la conversación (si lo hay). */
    focus?: Focus,
    /** Hábitos del usuario (locales y productos más usados). */
    habits?: Habits,
  ) {
    this.r = new JevReading(answers, meta, ctx, thresholds, overrides, pageLocationId, focus, habits);
  }

  get decisions(): Decision[] {
    return this.r.decisions;
  }

  run(): Interpretation {
    const t = this.r.thresholds;

    const injection = asNoul(this.r.answers.inyeccion);
    if (injection && gateNoulNo(injection, t.inyeccion) === "preguntar") {
      this.r.decisions.push({ id: "inyeccion", label: "Seguridad", value: "bloqueado", valueLabel: "Petición bloqueada", probability: injection.noul, confidence: null, gate: "preguntar" });
      return { intent: "fuera_de_ambito", decisions: this.r.decisions, plan: { type: "bloqueado" } };
    }

    // Hay un borrador esperando respuesta: «sí, adelante» o «cancélalo» se resuelven antes que nada.
    const draftAnswer = this.draftAnswer();
    if (draftAnswer) return this.done("proponer_accion", draftAnswer);

    const rawIntent = this.r.choice("intent");
    if (!rawIntent) throw new Error("Falta la respuesta de intent");
    const intentValue = rawIntent.choice as Intent;
    const spec = intentValue === "proponer_accion" ? t.intent_accion : intentValue === "fuera_de_ambito" ? t.intent_fuera : t.intent_lectura;
    const intentGate = this.r.gate("intent", "Intención", spec)!;
    let intentOutcome = intentGate.outcome;

    // Autoconsistencia: la segunda formulación debe estar de acuerdo.
    const alt = asChoice(this.r.answers.intent_alt);
    if (alt && this.r.overrides.intent === undefined) {
      const probabilities = alt.probabilities as Record<string, number>;
      const agreement = INTENT_ALT_EXPECTED[intentValue].reduce((sum, key) => sum + (probabilities[key] ?? 0), 0);
      // «Qué reponer»: pedir sugerencias 0,98, pero la segunda formulación lo lee como «cambiar» (reponer
      // suena a hacer). Pedir sugerencias solo lee y nunca prepara nada: la discrepancia no frena la respuesta.
      if (agreement < t.consistencia.act && intentValue !== "pedir_sugerencias") intentOutcome = worst(intentOutcome, "confirmar");
    }

    // «Ha llegado el traspaso del Parador»: proponer_accion 0,66 (dudoso) pero recibir_traspaso 0,99.
    // Si Jev tiene clarísima la operación concreta, la intención queda corroborada: preguntar «¿Qué
    // quieres hacer?» sobraría, y el resultado es un borrador que nunca se ejecuta sin confirmar.
    if (intentValue === "proponer_accion" && intentOutcome === "confirmar" && this.r.overrides.intent === undefined && actionCorroborates(this.r)) {
      intentOutcome = "actuar";
    }
    // Lo mismo en una lectura: «ficha del Barceló» (consultar 0,59, navegar 0,40) con query_product 1,00
    // y «leer» 1,00. Solo lectura: nada se escribe.
    if (intentValue === "consultar" && intentOutcome !== "actuar" && this.r.overrides.intent === undefined && queryCorroborates(this.r)) {
      intentOutcome = "actuar";
    }

    if (intentValue === "fuera_de_ambito") {
      return this.done(intentValue, intentOutcome === "actuar" ? { type: "fuera_de_ambito" } : { type: "conversar" });
    }
    if (intentOutcome !== "actuar") {
      return this.done(intentValue, this.r.clarify("intent", "¿Qué quieres hacer?", intentGate.ranked, ["fuera_de_ambito"]));
    }

    switch (intentValue) {
      case "conversar":
        return this.done(intentValue, { type: "conversar" });
      case "consultar":
      case "pedir_sugerencias":
        return this.done(intentValue, query(this.r, intentValue));
      case "proponer_accion":
        return this.done(intentValue, action(this.r));
    }
  }

  /** Confirmar o descartar el borrador pendiente. Ejecutar exige mucha seguridad; si no, se pregunta. */
  private draftAnswer(): Plan | null {
    const draftId = this.r.focus?.draftId;
    const answer = this.r.choice("borrador");
    if (!draftId || !answer || answer.choice === NINGUNO) return null;
    const g = gateChoice(answer, this.r.thresholds.borrador_chat);
    const action = g.choice as "confirmar" | "cancelar";
    this.r.decisions.push({ id: "borrador", label: "Borrador pendiente", value: action, valueLabel: label(action), probability: g.probability, confidence: g.confidence, gate: g.outcome });
    if (g.outcome === "actuar") return { type: "borrador", action, draftId };
    if (g.outcome === "confirmar") {
      const title = this.r.focus?.draftTitle ?? "el borrador";
      return {
        type: "clarify",
        field: "borrador",
        question: action === "confirmar" ? `¿Confirmo «${title}»?` : `¿Descarto «${title}»?`,
        options: [{ id: action, label: action === "confirmar" ? "Sí, confírmalo" : "Sí, descártalo", probability: g.probability }],
      };
    }
    return null;
  }

  private done(intent: Intent, plan: Plan): Interpretation {
    return { intent, decisions: this.r.decisions, plan };
  }
}

export { locationLabel } from "./reading";
