// Lectura de las respuestas de Jev de un mensaje: aplica a cada decisión su umbral (actuar,
// confirmar o preguntar), deja constancia de lo decidido y arma las aclaraciones. Es la base común de
// la interpretación de consultas y de operaciones.
import type { ChoiceResponse } from "@typesafe-ai/sdk";
import type { ClarifyField, Decision, GateOutcome } from "../../contract/index";
import type { SessionContext } from "../../domain";
import { asChoice, asNoul, gateChoice, type ChoiceGate, type RankedOption } from "../gates/gate";
import type { GateSpec, Thresholds } from "../gates/thresholds";
import { label, NO_INDICADO, TODOS } from "../catalog";
import type { JevAnswer } from "../client";
import { referencesPrevious } from "../../entities/signals";
import type { RoutingMeta } from "../request";
import type { Focus } from "../../agent/session";
import { preferredLocation, type Habits } from "../../agent/habits";
import { relevant, slotSpec, type ContextKey } from "../gates/policy";
import { namesAll } from "../../entities/mentions";
import { tokenize } from "../../entities/normalize";
import type { ClarifyPlan } from "../../agent/plans";

/** Una respuesta forzada por el usuario (aclaración) cuenta como certeza total. */
function forced(value: string, options: string[]): ChoiceResponse {
  const probabilities = Object.fromEntries(options.map((o) => [o, o === value ? 1 : 0]));
  return { type: "choice", choice: value, confidence: 1, probabilities };
}

export class JevReading {
  readonly decisions: Decision[] = [];

  constructor(
    readonly answers: Record<string, JevAnswer>,
    readonly meta: RoutingMeta,
    readonly ctx: SessionContext,
    readonly thresholds: Thresholds,
    readonly overrides: Record<string, string>,
    readonly pageLocationId: string | undefined,
    /** Foco vigente de la conversación (si lo hay). */
    readonly focus?: Focus,
    /** Hábitos del usuario (locales y productos más usados). */
    readonly habits?: Habits,
  ) {}

  /** Palabras de locales y espacios: no describen productos («2 de barceló del parador»). */
  readonly placeWords = new Set([...this.ctx.locations.map((l) => l.name), ...this.ctx.areas.map((a) => a.name)].flatMap((n) => tokenize(n)));

  /** Local habitual del usuario, si lo tiene claro (solo ordena las opciones al preguntar). */
  habitualLocation(): string | undefined {
    return preferredLocation(this.habits, this.ctx.locations.map((l) => l.id));
  }

  /** ¿El mensaje continúa el anterior? Solo si hay foco y Jev lo ve con seguridad suficiente (menos si el mensaje lo marca: «¿y…?», «eso»). */
  followsUp(): boolean {
    if (!this.focus) return false;
    const answer = asNoul(this.answers.seguimiento);
    const marked = !!this.meta.message && referencesPrevious(this.meta.message);
    if (!answer || answer.noul < (marked ? this.thresholds.seguimiento_marcado : this.thresholds.seguimiento).act) return false;
    if (!this.decisions.some((d) => d.id === "seguimiento")) {
      this.decisions.push({ id: "seguimiento", label: "Conversación", value: "continua", valueLabel: "Continúa lo anterior", probability: answer.noul, confidence: null, gate: "actuar" });
    }
    return true;
  }

  choice(id: string): ChoiceResponse | undefined {
    const answer = asChoice(this.answers[id]);
    const override = this.overrides[id];
    // Una respuesta anterior solo cuenta si sigue siendo una de las opciones (el mensaje pudo cambiar).
    if (override !== undefined && answer && override in answer.probabilities) return forced(override, Object.keys(answer.probabilities));
    return answer;
  }

  /** Opciones de local con el habitual del usuario primero (propuesto, nunca decidido). */
  locationOptions(ranked: RankedOption[]): RankedOption[] {
    const habitual = this.habitualLocation();
    const name = habitual ? this.ctx.locations.find((l) => l.id === habitual)?.name : undefined;
    if (!name) return ranked;
    const rest = ranked.filter((r) => r.option !== name);
    return [{ option: name, probability: ranked.find((r) => r.option === name)?.probability ?? 0 }, ...rest];
  }

  gate(id: string, decisionLabel: string, spec: GateSpec, valueLabel: (v: string) => string = label): ChoiceGate | null {
    const answer = this.choice(id);
    if (!answer) return null;
    const g = gateChoice(answer, spec);
    this.decisions.push({
      id,
      label: decisionLabel,
      value: g.choice,
      valueLabel: valueLabel(g.choice),
      probability: g.probability,
      confidence: g.confidence,
      gate: g.outcome,
    });
    return g;
  }

  /**
   * Un dato según la política del contexto: si es irrelevante no se evalúa ni se enseña (null); si
   * el mensaje lo nombra tal cual, basta menos seguridad (salvo en operaciones críticas).
   */
  gateSlot(context: ContextKey, slot: "local" | "local_destino" | "espacio", id: string, decisionLabel: string): ChoiceGate | null {
    if (!relevant(context, slot)) return null;
    const answer = this.choice(id);
    if (!answer) return null;
    return this.gate(id, decisionLabel, slotSpec(this.thresholds, context, slot, this.literal(slot, answer.choice)));
  }

  /** ¿El mensaje nombra tal cual esta opción? */
  literal(slot: "local" | "local_destino" | "espacio", option: string): boolean {
    const message = this.meta.message;
    if (!message) return false;
    if (slot === "espacio") {
      const areaId = this.meta.areaKeys.get(option);
      const area = areaId ? this.ctx.areas.find((a) => a.id === areaId) : undefined;
      return !!area && namesAll(message, area.name);
    }
    return this.meta.locationKeys.has(option) && namesAll(message, option);
  }

  /** Con un solo local no hay nada que preguntar: es ese. */
  onlyLocation(): string | null {
    return this.ctx.locations.length === 1 ? this.ctx.locations[0]!.id : null;
  }

  clarify(field: ClarifyField, question: string, ranked: RankedOption[], exclude: string[] = [], labeler: (v: string) => string = label, segmentIndex?: number): ClarifyPlan {
    // Los locales son pocos: se ofrecen todos (hasta 6); del resto, las 3 opciones más probables.
    const max = field === "local" || field === "local_destino" ? 6 : 3;
    const options = ranked
      .filter((r) => !exclude.includes(r.option))
      .slice(0, max)
      .map((r) => ({ id: r.option, label: labeler(r.option), probability: Math.round(r.probability * 100) / 100 }));
    return { type: "clarify", field, question, options, ...(segmentIndex !== undefined ? { segmentIndex } : {}) };
  }

  /** La decisión ya registrada pasa a «actuar» (lo que se enseña en «Entendido» es lo que se decidió). */
  markActed(id: string): void {
    const decision = [...this.decisions].reverse().find((d) => d.id === id);
    if (decision) decision.gate = "actuar";
  }

  /** Local para una lectura: si no está claro, todos los accesibles (fallback seguro, se avisa). */
  readLocation(context: ContextKey): { ids: string[]; defaulted: boolean } {
    const all = this.ctx.locations.map((l) => l.id);
    if (all.length === 1) return { ids: all, defaulted: false };
    const g = this.gateSlot(context, "local", "local", "Local");
    if (!g) return { ids: all, defaulted: relevant(context, "local") };
    const id = this.meta.locationKeys.get(g.choice);
    if (g.outcome === "actuar" && id) return { ids: [id], defaulted: false };
    if (g.outcome === "actuar" && g.choice === TODOS) return { ids: all, defaulted: false };
    if (g.choice === NO_INDICADO && this.pageLocationId && all.includes(this.pageLocationId)) {
      return { ids: [this.pageLocationId], defaulted: false };
    }
    return { ids: all, defaulted: true };
  }

  readArea(context: ContextKey): { id: string | null; outcome: GateOutcome } {
    const g = this.gateSlot(context, "espacio", "espacio", "Espacio");
    if (!g || g.choice === NO_INDICADO) return { id: null, outcome: "actuar" };
    return { id: this.meta.areaKeys.get(g.choice) ?? null, outcome: g.outcome };
  }

  /** Nombre de la familia consultada, si la consulta es de una familia entera («Stock de ron en Parador»). */
  familia: string | undefined;
}

export function locationLabel(ctx: SessionContext, id: string): string {
  return ctx.locations.find((l) => l.id === id)?.name ?? id;
}
