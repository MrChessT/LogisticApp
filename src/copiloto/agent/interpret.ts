// Respuestas de la llamada nº 1 → plan, aplicando la compuerta de confianza de cada decisión.
// Cero adivinanzas: si una decisión en juego no llega a su umbral, el plan es una aclaración.
import type { TareaPlan } from "../skills/tareas";
import type { ChoiceResponse } from "@typesafe-ai/sdk";
import type { AppRoute, ClarifyField, Decision, GateOutcome } from "../contract/index";
import type { Product, SessionContext } from "../domain";
import { asChoice, asNoul, gateChoice, gateNoulNo, gateNoulYes, worst, type ChoiceGate, type RankedOption } from "../gates/gate";
import type { GateSpec, Thresholds } from "../gates/thresholds";
import {
  label,
  NINGUNO,
  NO_APLICA,
  NO_INDICADO,
  TODOS,
  VARIOS,
  type Accion,
  isInfoTool,
  type Dato,
  type Herramienta,
  type InfoTool,
  type Intent,
  type MotivoMerma,
  type Periodo,
} from "../jev/catalog";
import type { JevAnswer } from "../jev/client";
import type { ToolName } from "../tools/tools";
import { asksSameAgain, mentionsWaste, referencesPrevious, venueRoles, wantsAreaBreakdown, type RoutingMeta } from "./routing";
import type { Focus } from "./session";
import { preferredLocation, type Habits } from "./habits";
import { need, relevant, slotSpec, type ContextKey } from "../gates/policy";
import { namesAll, namesProduct, unexplainedWords } from "../entities/mentions";
import { familyOf, type Family } from "../entities/family";
import { formatDecimal } from "../entities/units";
import { isUnitWord } from "../entities/quantity-parser";
import { normalize, tokenize } from "../entities/normalize";
import { operationOf } from "./free-text";

export interface ClarifyPlan {
  type: "clarify";
  field: ClarifyField;
  question: string;
  options: Array<{ id: string; label: string; probability: number | null }>;
  segmentIndex?: number;
  /** La pregunta pide repetir la orden entera: lo que se escriba es un mensaje nuevo, no un añadido. */
  restart?: boolean;
}

export interface ResolvedProduct {
  product: Product;
  segmentIndex: number;
  amount: string | null;
  unit: string | null;
  price: string | null;
  quantityOutcome: GateOutcome | null;
  /** Unidades sueltas que se suman a las cajas («3 cajas y 5 sueltas»). */
  loose?: string | null;
  looseUnit?: string | null;
  /** "confirmar": Jev lo eligió sin llegar al umbral de actuar; el borrador lo marca para revisar. */
  productOutcome?: GateOutcome;
}

/** Dinero metido en el stock (no precio de compra): «pasta», «dinero», «euros» con «tenemos/hay/metido». */
const MONEY_OF_STOCK = /\b(pasta|dinero|pelas|euros|pasta gansa)\b.*\b(tenemos|hay|metid[oa]s?|invertid[oa]s?|parad[oa]s?|en stock)\b|\b(tenemos|hay)\b.*\b(metid[oa]s?|invertid[oa]s?)\b.*\b(pasta|dinero|euros)\b|\bvalor(acion)? (de|del|en) (stock|inventario|almacen)\b|\bque valor\b.*\b(hay|tenemos)\b/;

/** El fragmento es el mensaje entero (la cantidad no traía producto): no se cita en la pregunta. */
function wholeMessage(segment: { text: string; productText: string }): boolean {
  return segment.productText === segment.text && segment.text.split(/\s+/).length > 4;
}

export interface QueryPlan {
  type: "consultar";
  tool: ToolName;
  locationIds: string[];
  locationsDefaulted: boolean;
  areaId: string | null;
  products: ResolvedProduct[];
  periodo: Periodo;
  /** Lo heredado del mensaje anterior, para decírselo al usuario ("Barceló", "Parador"…). */
  inherited?: string[];
  /** Qué quiere saber (cantidad, precio, valor…): la respuesta enseña solo eso. Sin él, todo. */
  dato?: Dato;
  /** La consulta es de una familia entera del catálogo («Ron»): el titular la nombra. */
  familia?: string;
}

/** Información de gestión (facturas, equipo, escandallos, zonas, inventarios, proveedores): tools/info.ts. */
export interface InfoPlan {
  type: "info";
  tool: InfoTool;
  locationIds: string[];
  locationsDefaulted: boolean;
  products: ResolvedProduct[];
  periodo: Periodo;
}

export interface ActionPlan {
  type: "accion";
  accion: Exclude<Accion, "ninguna" | CatalogAccion | DocumentAccion>;
  locationId: string;
  locationOutcome: GateOutcome;
  toLocationId: string | null;
  toLocationOutcome: GateOutcome;
  areaId: string | null;
  products: ResolvedProduct[];
  motivo: MotivoMerma;
  ambiguous: number;
  /** Jev veía que faltaba algo aunque cada dato estaba claro: el borrador lo avisa. */
  reviewAll?: boolean;
}

/** Operaciones sobre el catálogo (no mueven stock). */
export const CATALOG_ACCIONES = ["cambiar_precio", "nuevo_producto", "cambiar_minimo", "archivar_producto", "preparar_pedido"] as const;
export type CatalogAccion = (typeof CATALOG_ACCIONES)[number];

export interface CatalogPlan {
  type: "catalogo";
  accion: CatalogAccion;
  /** Local: obligatorio para el mínimo; opcional en el alta (se activa el producto en él). */
  locationId: string | null;
  locationOutcome: GateOutcome;
  /** Producto existente al que se refiere (precio, mínimo, archivar). Vacío en el alta. */
  products: ResolvedProduct[];
  /** Periodo que debe cubrir un pedido ("para el finde", "de la semana"). */
  periodo?: Periodo;
}

/** Operaciones sobre traspasos y pedidos que ya existen. */
export const DOCUMENT_ACCIONES = ["recibir_traspaso", "cancelar_traspaso", "enviar_pedido", "recibir_pedido", "cancelar_pedido"] as const;
export type DocumentAccion = (typeof DOCUMENT_ACCIONES)[number];

export interface DocumentPlan {
  type: "documento";
  accion: DocumentAccion;
  /** Locales donde buscar el documento (el nombrado o, si no, todos los del usuario). */
  locationIds: string[];
  /** Traspasos: de dónde salió y a dónde llega, si la frase lo dice («lo que mandó Pickles al Parador»). */
  fromLocationId?: string;
  toLocationId?: string;
}

/** Respuesta a un borrador pendiente desde el chat («sí, adelante», «cancélalo»). */
export interface DraftAnswerPlan {
  type: "borrador";
  action: "confirmar" | "cancelar";
  draftId: string;
}

export type Plan =
  | TareaPlan
  | ClarifyPlan
  | DraftAnswerPlan
  | CatalogPlan
  | DocumentPlan
  | QueryPlan
  | InfoPlan
  | ActionPlan
  | { type: "conversar" }
  | { type: "fuera_de_ambito" }
  | { type: "bloqueado" }
  /** Respuesta fija para lo que el asistente no lleva (personal, ventas) o no se registra a mano (consumo). */
  | { type: "aviso"; text: string; route?: AppRoute };

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

/** Una respuesta forzada por el usuario (aclaración) cuenta como certeza total. */
function forced(value: string, options: string[]): ChoiceResponse {
  const probabilities = Object.fromEntries(options.map((o) => [o, o === value ? 1 : 0]));
  return { type: "choice", choice: value, confidence: 1, probabilities };
}

export class Interpreter {
  readonly decisions: Decision[] = [];

  constructor(
    private readonly answers: Record<string, JevAnswer>,
    private readonly meta: RoutingMeta,
    private readonly ctx: SessionContext,
    private readonly thresholds: Thresholds,
    private readonly overrides: Record<string, string>,
    private readonly pageLocationId: string | undefined,
    /** Foco vigente de la conversación (si lo hay). */
    private readonly focus?: Focus,
    /** Hábitos del usuario (locales y productos más usados). */
    private readonly habits?: Habits,
  ) {}

  /** Palabras de locales y espacios: no describen productos («2 de barceló del parador»). */
  private readonly placeWords = new Set([...this.ctx.locations.map((l) => l.name), ...this.ctx.areas.map((a) => a.name)].flatMap((n) => tokenize(n)));

  /** Local habitual del usuario, si lo tiene claro (solo ordena las opciones al preguntar). */
  private habitualLocation(): string | undefined {
    return preferredLocation(this.habits, this.ctx.locations.map((l) => l.id));
  }

  /** ¿El mensaje continúa el anterior? Solo si hay foco y Jev lo ve con seguridad suficiente (menos si el mensaje lo marca: «¿y…?», «eso»). */
  private followsUp(): boolean {
    if (!this.focus) return false;
    const answer = asNoul(this.answers.seguimiento);
    const marked = !!this.meta.message && referencesPrevious(this.meta.message);
    if (!answer || answer.noul < (marked ? this.thresholds.seguimiento_marcado : this.thresholds.seguimiento).act) return false;
    if (!this.decisions.some((d) => d.id === "seguimiento")) {
      this.decisions.push({ id: "seguimiento", label: "Conversación", value: "continua", valueLabel: "Continúa lo anterior", probability: answer.noul, confidence: null, gate: "actuar" });
    }
    return true;
  }

  private choice(id: string): ChoiceResponse | undefined {
    const answer = asChoice(this.answers[id]);
    const override = this.overrides[id];
    // Una respuesta anterior solo cuenta si sigue siendo una de las opciones (el mensaje pudo cambiar).
    if (override !== undefined && answer && override in answer.probabilities) return forced(override, Object.keys(answer.probabilities));
    return answer;
  }

  /** Opciones de local con el habitual del usuario primero (propuesto, nunca decidido). */
  private locationOptions(ranked: RankedOption[]): RankedOption[] {
    const habitual = this.habitualLocation();
    const name = habitual ? this.ctx.locations.find((l) => l.id === habitual)?.name : undefined;
    if (!name) return ranked;
    const rest = ranked.filter((r) => r.option !== name);
    return [{ option: name, probability: ranked.find((r) => r.option === name)?.probability ?? 0 }, ...rest];
  }

  private gate(id: string, decisionLabel: string, spec: GateSpec, valueLabel: (v: string) => string = label): ChoiceGate | null {
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
  private gateSlot(context: ContextKey, slot: "local" | "local_destino" | "espacio", id: string, decisionLabel: string): ChoiceGate | null {
    if (!relevant(context, slot)) return null;
    const answer = this.choice(id);
    if (!answer) return null;
    return this.gate(id, decisionLabel, slotSpec(this.thresholds, context, slot, this.literal(slot, answer.choice)));
  }

  /** ¿El mensaje nombra tal cual esta opción? */
  private literal(slot: "local" | "local_destino" | "espacio", option: string): boolean {
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
  private onlyLocation(): string | null {
    return this.ctx.locations.length === 1 ? this.ctx.locations[0]!.id : null;
  }

  private clarify(field: ClarifyField, question: string, ranked: RankedOption[], exclude: string[] = [], labeler: (v: string) => string = label, segmentIndex?: number): ClarifyPlan {
    // Los locales son pocos: se ofrecen todos (hasta 6); del resto, las 3 opciones más probables.
    const max = field === "local" || field === "local_destino" ? 6 : 3;
    const options = ranked
      .filter((r) => !exclude.includes(r.option))
      .slice(0, max)
      .map((r) => ({ id: r.option, label: labeler(r.option), probability: Math.round(r.probability * 100) / 100 }));
    return { type: "clarify", field, question, options, ...(segmentIndex !== undefined ? { segmentIndex } : {}) };
  }

  run(): Interpretation {
    const t = this.thresholds;

    const injection = asNoul(this.answers.inyeccion);
    if (injection && gateNoulNo(injection, t.inyeccion) === "preguntar") {
      this.decisions.push({ id: "inyeccion", label: "Seguridad", value: "bloqueado", valueLabel: "Petición bloqueada", probability: injection.noul, confidence: null, gate: "preguntar" });
      return { intent: "fuera_de_ambito", decisions: this.decisions, plan: { type: "bloqueado" } };
    }

    // Hay un borrador esperando respuesta: «sí, adelante» o «cancélalo» se resuelven antes que nada.
    const draftAnswer = this.draftAnswer();
    if (draftAnswer) return this.done("proponer_accion", draftAnswer);

    const rawIntent = this.choice("intent");
    if (!rawIntent) throw new Error("Falta la respuesta de intent");
    const intentValue = rawIntent.choice as Intent;
    const spec = intentValue === "proponer_accion" ? t.intent_accion : intentValue === "fuera_de_ambito" ? t.intent_fuera : t.intent_lectura;
    const intentGate = this.gate("intent", "Intención", spec)!;
    let intentOutcome = intentGate.outcome;

    // Autoconsistencia: la segunda formulación debe estar de acuerdo.
    const alt = asChoice(this.answers.intent_alt);
    if (alt && this.overrides.intent === undefined) {
      const probabilities = alt.probabilities as Record<string, number>;
      const agreement = INTENT_ALT_EXPECTED[intentValue].reduce((sum, key) => sum + (probabilities[key] ?? 0), 0);
      // «Qué reponer»: pedir sugerencias 0,98, pero la segunda formulación lo lee como «cambiar» (reponer
      // suena a hacer). Pedir sugerencias solo lee y nunca prepara nada: la discrepancia no frena la respuesta.
      if (agreement < t.consistencia.act && intentValue !== "pedir_sugerencias") intentOutcome = worst(intentOutcome, "confirmar");
    }

    // «Ha llegado el traspaso del Parador»: proponer_accion 0,66 (dudoso) pero recibir_traspaso 0,99.
    // Si Jev tiene clarísima la operación concreta, la intención queda corroborada: preguntar «¿Qué
    // quieres hacer?» sobraría, y el resultado es un borrador que nunca se ejecuta sin confirmar.
    if (intentValue === "proponer_accion" && intentOutcome === "confirmar" && this.overrides.intent === undefined && this.actionCorroborates()) {
      intentOutcome = "actuar";
    }
    // Lo mismo en una lectura: «ficha del Barceló» (consultar 0,59, navegar 0,40) con query_product 1,00
    // y «leer» 1,00. Solo lectura: nada se escribe.
    if (intentValue === "consultar" && intentOutcome !== "actuar" && this.overrides.intent === undefined && this.queryCorroborates()) {
      intentOutcome = "actuar";
    }

    if (intentValue === "fuera_de_ambito") {
      return this.done(intentValue, intentOutcome === "actuar" ? { type: "fuera_de_ambito" } : { type: "conversar" });
    }
    if (intentOutcome !== "actuar") {
      return this.done(intentValue, this.clarify("intent", "¿Qué quieres hacer?", intentGate.ranked, ["fuera_de_ambito"]));
    }

    switch (intentValue) {
      case "conversar":
        return this.done(intentValue, { type: "conversar" });
      case "consultar":
      case "pedir_sugerencias":
        return this.done(intentValue, this.query(intentValue));
      case "proponer_accion":
        return this.done(intentValue, this.action());
    }
  }

  /** Qué dato pide la consulta. Sin seguridad suficiente, «general» (se enseña todo, como antes). */
  private readDato(): Dato {
    // «¿cuánta pasta tenemos metida en ron?», «¿cuánto dinero hay en ginebra?»: dinero del stock, aunque
    // Jev lo lea como cantidad («cuánta» + «tenemos» pesa más que «pasta»; medido: cantidad 0,70).
    if (this.meta.message && MONEY_OF_STOCK.test(normalize(this.meta.message))) return "valor";
    const g = this.gate("dato", "Dato", this.thresholds.dato);
    return g && g.outcome === "actuar" ? (g.choice as Dato) : "general";
  }

  /**
   * Merma o traspaso («tírame 1 bolsa de hielo del parador»: merma 0,71, traspaso 0,29): un traspaso
   * necesita un local de destino distinto del de origen. Si Jev está seguro de que no se nombra ninguno
   * y ya se inclina por la merma, es merma; si nombra otro local y se inclina por el traspaso, traspaso.
   * Si no, null (se pregunta como siempre).
   */
  private wasteOrTransfer(ranked: RankedOption[]): "merma" | "traspaso" | null {
    const [first, second] = ranked;
    if (!first || !second) return null;
    const pair = new Set([first.option, second.option]);
    if (!pair.has("merma") || !pair.has("traspaso") || first.probability + second.probability < 0.85) return null;
    const dest = this.choice("local_destino");
    if (!dest) return null;
    const p = (dest.probabilities as Record<string, number>)[dest.choice] ?? 0;
    const origin = this.choice("local")?.choice;
    const sure = p >= this.thresholds.local_borrador.act;
    // «caducaron 3 packs de agua en la oliva»: un «destino» igual al origen es que no hay destino.
    const otherVenue = sure && this.meta.locationKeys.has(dest.choice) && dest.choice !== origin;
    const noDestination = (sure && dest.choice === NO_APLICA) || dest.choice === origin;
    const waste = !!this.meta.message && mentionsWaste(this.meta.message);
    // Solo confirma hacia donde Jev ya se inclina: «quita 6 cocas del vivero» (merma 0,55, traspaso
    // 0,40, sin palabras de merma) sigue siendo dudoso aunque no diga destino, y se pregunta.
    if (first.option === "merma" && !otherVenue && (waste || (noDestination && first.probability >= 0.65))) return "merma";
    return first.option === "traspaso" && otherVenue ? "traspaso" : null;
  }

  /** ¿Jev está seguro de una consulta concreta y de que se trata de leer? */
  private queryCorroborates(): boolean {
    const tool = this.choice("herramienta");
    if (!tool || tool.choice === "ninguna" || gateChoice(tool, this.thresholds.herramienta).outcome !== "actuar") return false;
    const alt = asChoice(this.answers.intent_alt);
    return !alt || ((alt.probabilities as Record<string, number>).leer ?? 0) >= 0.5;
  }

  /** La decisión ya registrada pasa a «actuar» (lo que se enseña en «Entendido» es lo que se decidió). */
  private markActed(id: string): void {
    const decision = [...this.decisions].reverse().find((d) => d.id === id);
    if (decision) decision.gate = "actuar";
  }

  /** ¿Jev está seguro de una operación concreta (no «ninguna»)? Nunca para cerrar inventario. */
  private actionCorroborates(): boolean {
    const answer = this.choice("tipo_accion");
    if (!answer || answer.choice === "ninguna" || answer.choice === "cierre_inventario") return false;
    return gateChoice(answer, this.thresholds.tipo_accion).outcome === "actuar";
  }

  /** Confirmar o descartar el borrador pendiente. Ejecutar exige mucha seguridad; si no, se pregunta. */
  private draftAnswer(): Plan | null {
    const draftId = this.focus?.draftId;
    const answer = this.choice("borrador");
    if (!draftId || !answer || answer.choice === NINGUNO) return null;
    const g = gateChoice(answer, this.thresholds.borrador_chat);
    const action = g.choice as "confirmar" | "cancelar";
    this.decisions.push({ id: "borrador", label: "Borrador pendiente", value: action, valueLabel: label(action), probability: g.probability, confidence: g.confidence, gate: g.outcome });
    if (g.outcome === "actuar") return { type: "borrador", action, draftId };
    if (g.outcome === "confirmar") {
      const title = this.focus?.draftTitle ?? "el borrador";
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
    return { intent, decisions: this.decisions, plan };
  }

  /** Local para una lectura: si no está claro, todos los accesibles (fallback seguro, se avisa). */
  private readLocation(context: ContextKey): { ids: string[]; defaulted: boolean } {
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

  private readArea(context: ContextKey): { id: string | null; outcome: GateOutcome } {
    const g = this.gateSlot(context, "espacio", "espacio", "Espacio");
    if (!g || g.choice === NO_INDICADO) return { id: null, outcome: "actuar" };
    return { id: this.meta.areaKeys.get(g.choice) ?? null, outcome: g.outcome };
  }

  /** Productos de cada segmento. Devuelve una aclaración si alguno no llega al umbral. */
  /** Candidatos parecidos al mejor (≥ 50 % de su puntuación de recuperación), como mucho 10. */
  /** Familia del catálogo que nombra el fragmento («ron», «cervezas»), para consultas. */
  private catalogFamily(segmentIndex: number): Family | null {
    const rs = this.meta.segments[segmentIndex];
    if (!rs) return null;
    const text = tokenize(rs.segment.productText || rs.segment.text).filter((w) => !this.placeWords.has(w)).join(" ");
    return familyOf(text, this.ctx.products);
  }

  /** Nombre de la familia consultada, si la consulta es de una familia entera («Stock de ron en Parador»). */
  familia: string | undefined;

  private family(segmentIndex: number): Product[] {
    const rs = this.meta.segments[segmentIndex]!;
    const top = Math.max(0, ...rs.scores.values());
    return [...rs.candidates.entries()]
      .filter(([key]) => (rs.scores.get(key) ?? 0) >= top * 0.5)
      .sort(([a], [b]) => (rs.scores.get(b) ?? 0) - (rs.scores.get(a) ?? 0))
      .slice(0, 10)
      .map(([, product]) => product);
  }

  private resolveProducts(context: ContextKey, forAction: boolean): ResolvedProduct[] | ClarifyPlan {
    const resolved: ResolvedProduct[] = [];
    if (!relevant(context, "producto")) return resolved;
    for (const [i, rs] of this.meta.segments.entries()) {
      const id = `producto_${i}`;
      const answer = this.choice(id);
      // Evidencia literal: el fragmento nombra el producto elegido («2 cajas de beefeater»).
      const chosen = answer ? rs.candidates.get(answer.choice) : undefined;
      // Para escribir, el nombre dicho debe encajar entero: «Prubea Luis» no es «Luis Latour» aunque
      // comparta «luis». Solo se mira el fragmento del producto (no la frase entera con la operación).
      // Solo en fragmentos con cantidad (en los demás «productText» es la frase entera).
      const unexplained =
        // Si el producto lo eligió el usuario al aclarar, manda su elección.
        forAction && chosen && this.overrides[id] === undefined && rs.segment.amount !== null && rs.segment.productText && rs.segment.productText !== rs.segment.text
          ? unexplainedWords(rs.segment.productText, chosen, (w) => isUnitWord(w) || this.placeWords.has(w))
          : [];
      const literal = !!chosen && unexplained.length === 0 && namesProduct(rs.segment.productText || rs.segment.text, chosen);
      const g = this.gate(id, "Producto", slotSpec(this.thresholds, context, "producto", literal), (v) => (v === NINGUNO || v === VARIOS ? label(v) : v));
      if (!g) continue;
      if (unexplained.length > 0 && g.choice === answer?.choice && g.outcome !== "preguntar") {
        g.outcome = "preguntar";
        const last = this.decisions[this.decisions.length - 1];
        if (last?.id === id) last.gate = "preguntar";
      }
      // Un solo candidato, el mensaje lo nombra tal cual y Jev lo pone primero («4 tónicas» con una sola
      // tónica: 0,50 frente a «varios» 0,38): no hay otro producto al que pueda referirse.
      if (g.outcome !== "actuar" && literal && rs.candidates.size === 1 && chosen && g.ranked[0]?.option === answer!.choice && g.probability >= 0.45) {
        g.outcome = "actuar";
        this.markActed(id);
      }
      // En una consulta (solo lectura) basta con que el mensaje nombre el único candidato y Jev le dé
      // algo de peso: «¿cuál es el mínimo de tónica en pickels?» (ninguno 0,46, la tónica 0,43).
      const [onlyKey, only] = rs.candidates.size === 1 ? [...rs.candidates.entries()][0]! : [undefined, undefined];
      if (!forAction && only && onlyKey && g.outcome !== "actuar" && namesProduct(rs.segment.productText || rs.segment.text, only) && ((answer!.probabilities as Record<string, number>)[onlyKey] ?? 0) >= 0.3) {
        this.markActed(id);
        resolved.push({ product: only, segmentIndex: i, amount: null, unit: null, price: null, quantityOutcome: null, productOutcome: "actuar" });
        continue;
      }
      if (g.choice === NINGUNO && g.outcome === "actuar") {
        const whole = !forAction && rs.segment.amount === null ? this.catalogFamily(i) : null;
        if (whole) {
          this.familia = whole.label;
          for (const product of whole.products) resolved.push({ product, segmentIndex: i, amount: null, unit: null, price: null, quantityOutcome: null });
        }
        continue;
      }
      // "ron" con varios rones: en una consulta se incluyen todos; en una escritura se pregunta cuál.
      if (g.choice === VARIOS && g.outcome !== "preguntar") {
        const family = this.family(i);
        if (!forAction) {
          const whole = this.catalogFamily(i);
          if (whole) this.familia = whole.label;
          for (const product of whole?.products ?? family) resolved.push({ product, segmentIndex: i, amount: null, unit: null, price: null, quantityOutcome: null });
          continue;
        }
        return {
          type: "clarify",
          field: "producto",
          question: rs.segment.amount !== null && !wholeMessage(rs.segment) ? `¿Cuál de estos productos es «${rs.segment.text}»?` : "¿Cuál de estos productos?",
          options: [...family]
            .sort((a, b) => (this.habits?.products[b.id] ?? 0) - (this.habits?.products[a.id] ?? 0))
            .slice(0, 4)
            .map((p) => ({ id: p.name, label: p.name, probability: null })),
          segmentIndex: i,
        };
      }
      // Entre ask y act con un producto concreto se sigue: en una escritura el borrador lo marca para
      // revisar (el propio borrador es la confirmación). Por debajo de ask, o "ninguno", se pregunta.
      if (g.choice === NINGUNO || g.outcome === "preguntar") {
        // En una consulta sin cantidad, la duda entre "ninguno" y "varios" no bloquea: sin filtro, o la familia.
        const whole = !forAction && rs.segment.amount === null ? this.catalogFamily(i) : null;
        if (whole) {
          // «¿cuántas cervezas quedan?»: la familia entera, aunque Jev dude entre «ninguno» y «varios».
          this.familia = whole.label;
          for (const product of whole.products) resolved.push({ product, segmentIndex: i, amount: null, unit: null, price: null, quantityOutcome: null });
          continue;
        }
        if (!forAction && rs.segment.amount === null && g.ranked[0]?.option === NINGUNO) continue;
        if (!forAction && rs.segment.amount === null && g.ranked[0]?.option === VARIOS) {
          for (const product of this.family(i)) resolved.push({ product, segmentIndex: i, amount: null, unit: null, price: null, quantityOutcome: null });
          continue;
        }
        const question =
          unexplained.length > 0
            ? `No encuentro «${rs.segment.productText}» tal cual en el catálogo. ¿Es alguno de estos? Si es un producto nuevo, primero hay que darlo de alta.`
            : rs.segment.amount !== null && !wholeMessage(rs.segment)
              ? `¿A qué producto te refieres con «${rs.segment.text}»?`
              : rs.segment.amount !== null
                ? `¿De qué producto son las ${amountLabel(rs.segment.amount, rs.segment.unit)}?`
                : "¿A qué producto te refieres?";
        return this.clarify("producto", question, g.ranked, [NINGUNO, VARIOS], (v) => v, i);
      }
      const product = rs.candidates.get(g.choice);
      if (!product) continue;
      // Cantidad escrita por el usuario al responder «¿qué cantidad?»: manda sobre la del mensaje.
      const typedAmount = this.overrides[`cantidad_${i}`];
      if (typedAmount !== undefined) {
        const typedUnit = this.overrides[`unidad_texto_${i}`] ?? null;
        this.decisions.push({ id: `cantidad_ok_${i}`, label: "Cantidad", value: `${typedAmount} ${typedUnit ?? ""}`.trim(), valueLabel: amountLabel(typedAmount, typedUnit), probability: 1, confidence: null, gate: "actuar" });
        resolved.push({ product, segmentIndex: i, amount: typedAmount, unit: typedUnit, price: rs.segment.price, quantityOutcome: "actuar", productOutcome: g.outcome });
        continue;
      }
      let quantityOutcome: GateOutcome | null = null;
      const q = asNoul(this.answers[`cantidad_ok_${i}`]);
      if (q && rs.segment.amount !== null) {
        quantityOutcome = this.overrides[`cantidad_ok_${i}`] ? "actuar" : gateNoulYes(q, this.thresholds.cantidad);
        this.decisions.push({
          id: `cantidad_ok_${i}`,
          label: "Cantidad",
          value: `${rs.segment.amount} ${rs.segment.unit ?? ""}${rs.segment.loose ? ` + ${rs.segment.loose}` : ""}`.trim(),
          valueLabel: `${amountLabel(rs.segment.amount, rs.segment.unit)}${rs.segment.loose ? ` + ${amountLabel(rs.segment.loose, rs.segment.looseUnit ?? "ud")} sueltas` : ""}`,
          probability: q.noul,
          confidence: null,
          gate: quantityOutcome,
        });
      }
      const loose = rs.segment.loose ? { loose: rs.segment.loose, looseUnit: rs.segment.looseUnit ?? null } : {};
      resolved.push({ product, segmentIndex: i, amount: rs.segment.amount, unit: rs.segment.unit, price: rs.segment.price, quantityOutcome, productOutcome: g.outcome, ...loose });
    }
    return resolved;
  }

  private query(intent: "consultar" | "pedir_sugerencias"): Plan {
    const g = this.gate("herramienta", "Consulta", this.thresholds.herramienta);
    let tool: Herramienta = g?.choice as Herramienta;
    const inherited: string[] = [];
    const focusTool = this.focus?.kind === "consulta" ? (this.focus.tool as Herramienta | undefined) : undefined;
    if (intent === "pedir_sugerencias" && (!g || tool === "ninguna" || g.outcome !== "actuar")) {
      tool = "query_reorder";
    } else if ((!g || g.outcome !== "actuar") && this.meta.message && wantsAreaBreakdown(this.meta.message)) {
      // «¿qué hay en cada sección del Vivero?»: stock por secciones (Jev dudaba: 0,63–0,72).
      tool = "query_stock";
    } else if (!g || tool === "ninguna" || g.outcome === "preguntar") {
      // Entre «preguntar» y «actuar» se contesta con la más probable: es solo leer, y preguntar «¿Qué
      // quieres consultar?» con «precio cocacola» era la pregunta de más más repetida en producción.
      // «¿y en el Vivero?»: sin consulta clara, la misma que antes.
      if (!focusTool || !this.followsUp()) return this.clarify("herramienta", "¿Qué quieres consultar?", g?.ranked ?? [], ["ninguna"]);
      tool = focusTool;
    } else if (focusTool && tool !== focusTool && this.meta.message && asksSameAgain(this.meta.message) && this.followsUp()) {
      // «¿y en el Parador?» tras «¿qué tengo que pedir?»: la misma consulta, en otro sitio (Jev lee «stock»).
      tool = focusTool;
    }
    if (isInfoTool(tool)) return this.info(tool);
    const context: ContextKey = `consulta:${tool as ToolName}`;
    const loc = this.readLocation(context);
    const area = this.readArea(context);
    let products = this.resolveProducts(context, false);
    if ("type" in products) return products;
    // Elegido al aclarar «¿De qué producto?» entre los de antes (no tiene por qué estar entre los candidatos
    // de este mensaje, que no nombra ninguno: «¿y a cuánto lo compramos?»).
    const picked = this.overrides.producto_0 ? this.ctx.products.find((p) => p.name === this.overrides.producto_0) : undefined;
    if (products.length === 0 && picked) products = [{ product: picked, segmentIndex: 0, amount: null, unit: null, price: null, quantityOutcome: null }];
    // Consultas de un producto concreto (su ficha): sin producto, o con varios («ginebra»), se pregunta cuál.
    if (need(context, "producto") === "requerido" && products.length !== 1 && !(products.length === 0 && this.focus?.productIds.length === 1 && this.followsUp())) {
      if (products.length === 0) {
        // Con los de la respuesta anterior («stock de larios» → 3 Larios) o los parecidos como opciones.
        const previous = (this.focus?.productIds ?? []).map((id) => this.ctx.products.find((p) => p.id === id)).filter((p): p is Product => !!p);
        const options = previous.length > 1 ? previous.slice(0, 4) : this.closestProducts(4).map((c) => c.product);
        return { type: "clarify", field: "producto", question: "¿De qué producto?", options: options.map((p) => ({ id: p.name, label: p.name, probability: null })), segmentIndex: 0 };
      }
      return {
        type: "clarify",
        field: "producto",
        question: "¿De cuál de estos productos?",
        options: products.slice(0, 4).map((p) => ({ id: p.product.name, label: p.product.name, probability: null })),
        segmentIndex: Math.max(0, products[0]!.segmentIndex),
      };
    }
    // El periodo solo cuenta donde importa (movimientos, gasto, precios…), no en el stock de ahora.
    let periodo = (relevant(context, "periodo") ? this.choice("periodo")?.choice ?? NO_INDICADO : NO_INDICADO) as Periodo;

    // Lo que este mensaje no dice se toma del anterior, si lo continúa.
    const focus = this.focus;
    if (focus && (products.length === 0 || loc.defaulted || periodo === NO_INDICADO) && this.followsUp()) {
      if (products.length === 0 && focus.productIds.length > 0 && relevant(context, "producto")) {
        products = focus.productIds
          .map((id) => this.ctx.products.find((p) => p.id === id))
          .filter((p): p is Product => !!p)
          .map((product) => ({ product, segmentIndex: -1, amount: null, unit: null, price: null, quantityOutcome: null }));
        if (products.length > 0) inherited.push(products.length === 1 ? products[0]!.product.name : "los mismos productos");
      }
      const focusLocations = focus.locationIds.filter((id) => this.ctx.locations.some((l) => l.id === id));
      if (loc.defaulted && focusLocations.length > 0 && relevant(context, "local")) {
        loc.ids = focusLocations;
        loc.defaulted = false;
        inherited.push(focusLocations.map((id) => locationLabel(this.ctx, id)).join(", "));
      }
      if (periodo === NO_INDICADO && focus.periodo && focus.periodo !== NO_INDICADO && relevant(context, "periodo")) {
        periodo = focus.periodo as Periodo;
        inherited.push(label(periodo).toLowerCase());
      }
    }
    if (periodo !== NO_INDICADO) {
      // Heredado sin que el mensaje hable de tiempo: Jev no dio periodo y cuenta la continuación.
      const p = this.choice("periodo");
      const probability = p ? (p.probabilities as Record<string, number>)[periodo] ?? 0 : asNoul(this.answers.seguimiento)?.noul ?? 0;
      this.decisions.push({ id: "periodo", label: "Periodo", value: periodo, valueLabel: label(periodo), probability, confidence: p?.confidence ?? null, gate: "actuar" });
    }
    const areaId = area.outcome === "actuar" ? area.id : null;
    const areaLocation = areaId ? this.ctx.areas.find((a) => a.id === areaId)?.locationId : undefined;
    const dato = this.readDato();
    tool = toolForDato(tool, dato, products.length);
    return {
      type: "consultar",
      tool: tool as ToolName,
      ...(dato !== "general" ? { dato } : {}),
      locationIds: areaLocation ? [areaLocation] : loc.ids,
      locationsDefaulted: areaLocation ? false : loc.defaulted,
      areaId,
      products,
      periodo,
      ...(inherited.length > 0 ? { inherited } : {}),
      ...(this.familia ? { familia: this.familia } : {}),
    };
  }

  /** Facturas, equipo, escandallos, zonas, inventarios o proveedores: el local, los productos y el periodo solo filtran. */
  private info(tool: InfoTool): Plan {
    const loc = this.readLocation("info");
    const products = this.resolveProducts("info", false);
    const periodo = (this.choice("periodo")?.choice ?? NO_INDICADO) as Periodo;
    return { type: "info", tool, locationIds: loc.ids, locationsDefaulted: loc.defaulted, products: "type" in products ? [] : products, periodo };
  }

  /**
   * Acciones de catálogo. El alta no busca un producto existente (lo busca después el constructor
   * para detectar duplicados); precio, mínimo y archivar necesitan un producto claro. Solo el mínimo
   * necesita local. El resto de datos (precio, proveedor, cantidad) los extrae el código del mensaje.
   */
  private catalogAction(accion: CatalogAccion): Plan {
    const context: ContextKey = `accion:${accion}`;
    const locGate = this.gateSlot(context, "local", "local", "Local");
    let locationId = locGate ? this.meta.locationKeys.get(locGate.choice) ?? null : this.onlyLocation();
    let locationOutcome: GateOutcome = locGate && locationId ? locGate.outcome : locationId ? "actuar" : "preguntar";

    if (accion === "nuevo_producto") {
      return { type: "catalogo", accion, locationId: locationOutcome === "actuar" ? locationId : null, locationOutcome, products: [] };
    }

    // Pedido: hace falta el local; los productos son opcionales (sin productos se pide lo que falta).
    if (accion === "preparar_pedido") {
      // En un pedido la mercancía llega AL local desde el proveedor: la pregunta de destino a veces
      // está segura cuando la de local duda (medido con Jev real). Se usa la que esté segura; si
      // ninguna lo está pero coinciden, se sigue marcando el local para revisar.
      if (locationOutcome !== "actuar") {
        const dest = this.gateSlot(context, "local_destino", "local_destino", "Local destino");
        const destId = dest && dest.choice !== NO_APLICA ? this.meta.locationKeys.get(dest.choice) ?? null : null;
        if (destId && dest!.outcome === "actuar") {
          locationId = destId;
          locationOutcome = "actuar";
        } else if (destId && destId === locationId && dest!.outcome === "confirmar") {
          locationOutcome = "confirmar";
        }
      }
      if (!locationId && this.pageLocationId) {
        locationId = this.pageLocationId;
        locationOutcome = "confirmar";
      }
      if (!locationId || locationOutcome === "preguntar") {
        return this.clarify("local", "¿Para qué local es el pedido?", this.locationOptions(locGate?.ranked ?? []), [TODOS, NO_INDICADO], (key) => key);
      }
      const products = this.resolveProducts(context, true);
      if ("type" in products) return products;
      const periodo = (this.choice("periodo")?.choice ?? NO_INDICADO) as Periodo;
      return { type: "catalogo", accion, locationId, locationOutcome, products, periodo };
    }

    const products = this.resolveProducts(context, true);
    if ("type" in products) return products;
    if (products.length === 0) {
      const question = accion === "cambiar_precio" ? "¿De qué producto quieres cambiar el precio?" : accion === "archivar_producto" ? "¿Qué producto quieres archivar?" : "¿De qué producto?";
      // Con los parecidos como opciones: sin ellas, escribir el nombre volvía a la misma pregunta.
      return { type: "clarify", field: "producto", question, options: this.closestProducts(4).map(({ key, product }) => ({ id: key, label: product.name, probability: null })), segmentIndex: 0 };
    }

    if (accion === "cambiar_minimo") {
      if (!locationId && this.pageLocationId) {
        locationId = this.pageLocationId;
        locationOutcome = "confirmar";
      }
      if (!locationId || locationOutcome === "preguntar") {
        return this.clarify("local", "¿En qué local?", this.locationOptions(locGate?.ranked ?? []), [TODOS, NO_INDICADO], (key) => key);
      }
    }
    return { type: "catalogo", accion, locationId, locationOutcome, products };
  }

  /** Los productos del catálogo más parecidos a lo que dice el mensaje (por la búsqueda, no por Jev). */
  private closestProducts(n: number): Array<{ key: string; product: Product }> {
    const scored = (this.meta.segments[0] ? [this.meta.segments[0]] : []).flatMap((rs) => [...rs.candidates.entries()].map(([key, product]) => ({ key, product, score: rs.scores.get(key) ?? 0 })));
    return scored.sort((a, b) => b.score - a.score).slice(0, n);
  }

  /** Recibir, enviar o cancelar un traspaso o un pedido: el local, si se dice, acota cuál. */
  private documentAction(accion: DocumentAccion): Plan {
    const context: ContextKey = `accion:${accion}`;
    const all = this.ctx.locations.map((l) => l.id);
    const g = this.gateSlot(context, "local", "local", "Local");
    let id = g && g.outcome === "actuar" ? this.meta.locationKeys.get(g.choice) : undefined;
    // «ya ha llegado lo que mandó el Vivero»: si Jev no lo recoge pero el mensaje nombra un solo local,
    // ese local acota el documento (solo filtra cuál; el borrador se confirma igual).
    if (!id && this.meta.message) {
      const named = [...this.meta.locationKeys.entries()].filter(([name]) => namesAll(this.meta.message!, name));
      if (named.length === 1) id = named[0]![1];
    }
    // Traspasos: origen y destino según la frase. Antes se buscaba cualquier traspaso que tocara el local
    // («lo que mandó Pickles al Parador» enseñaba los que salían del Parador hacia el Vivero).
    if ((accion === "recibir_traspaso" || accion === "cancelar_traspaso") && this.meta.message) {
      const names = [...this.meta.locationKeys.keys()];
      const named = names.filter((name) => namesAll(this.meta.message!, name));
      const roles = venueRoles(this.meta.message, names);
      const key = (name: string | null | undefined) => (name ? this.meta.locationKeys.get(name) : undefined);
      let to = key(roles.destination);
      let from = key(roles.origin);
      // Dos locales y uno con papel claro: el otro es el que falta («mandó Pickles al Parador»).
      if (named.length === 2) {
        if (to && !from) from = key(named.find((n) => key(n) !== to));
        if (from && !to) to = key(named.find((n) => key(n) !== from));
      }
      // Uno solo sin preposición: al recibir, «lo que mandó el Vivero» es el origen.
      if (named.length === 1 && !to && !from && accion === "recibir_traspaso" && /\b(mand|envi)/.test(normalize(this.meta.message))) from = key(named[0]);
      if (to || from) {
        return { type: "documento", accion, locationIds: all, ...(from ? { fromLocationId: from } : {}), ...(to ? { toLocationId: to } : {}) };
      }
    }
    return { type: "documento", accion, locationIds: id ? [id] : all };
  }

  private action(): Plan {
    const accionAnswer = this.choice("tipo_accion");
    const spec = accionAnswer?.choice === "cierre_inventario" ? this.thresholds.cierre_inventario : this.thresholds.tipo_accion;
    const g = this.gate("tipo_accion", "Operación", spec);
    let chosen = g && g.outcome === "actuar" && g.choice !== "ninguna" ? g.choice : null;
    // La frase nombra la operación y Jev la pone primera («prepárame el pedido para el parador»: pedido 0,55):
    // es esa. Solo prepara un borrador, que hay que confirmar. Nunca para cerrar inventario.
    const named = this.meta.message ? operationOf(this.meta.message) : null;
    if (g && !chosen && named && g.ranked[0]?.option === named && g.probability >= 0.45) {
      chosen = named;
      this.markActed("tipo_accion");
    }
    if (g && !chosen) {
      chosen = this.wasteOrTransfer(g.ranked);
      // Lo que se enseña en «Entendido» debe ser lo que se decidió.
      const decision = chosen ? this.decisions.find((d) => d.id === "tipo_accion") : undefined;
      if (decision && chosen) Object.assign(decision, { value: chosen, valueLabel: label(chosen), gate: "actuar" });
    }
    if (!chosen) {
      return this.clarify("tipo_accion", "¿Qué operación quieres registrar?", g?.ranked ?? [], ["ninguna"]);
    }
    if ((CATALOG_ACCIONES as readonly string[]).includes(chosen)) return this.catalogAction(chosen as CatalogAccion);
    if ((DOCUMENT_ACCIONES as readonly string[]).includes(chosen)) return this.documentAction(chosen as DocumentAccion);
    const accion = chosen as Exclude<Accion, "ninguna" | CatalogAccion | DocumentAccion>;
    const t = this.thresholds;
    const context: ContextKey = `accion:${accion}`;

    const area = this.readArea(context);
    const areaId = area.outcome === "actuar" ? area.id : null;
    const areaLocation = areaId ? this.ctx.areas.find((a) => a.id === areaId)?.locationId ?? null : null;
    const locationName = (key: string) => key;

    // Local de origen: donde se mueve el stock. Por debajo de ask → se pregunta.
    const locGate = this.gateSlot(context, "local", "local", "Local");
    let resolvedLocation = locGate ? this.meta.locationKeys.get(locGate.choice) ?? null : null;
    let locationOutcome: GateOutcome = resolvedLocation ? locGate!.outcome : "preguntar";
    // «pásame 4 tónicas del Pickels al Parador»: Jev duda entre los dos locales nombrados (0,65 / 0,35),
    // pero la preposición dice cuál es el origen. Si Jev ya lo pone primero, se confirma.
    const roles = accion === "traspaso" && this.meta.message ? venueRoles(this.meta.message, [...this.meta.locationKeys.keys()]) : null;
    if (roles && locGate && resolvedLocation && locationOutcome !== "actuar" && roles.origin === locGate.choice) {
      locationOutcome = "actuar";
      this.markActed("local");
    }
    // «pasa ron al Vivero»: el único local nombrado va con «al», es el destino. Jev lo ponía también de
    // origen (Vivero → Vivero) y se preguntaba el destino; la respuesta («Parador») acababa al revés.
    const namedDestination = roles?.destination ? this.meta.locationKeys.get(roles.destination) ?? null : null;
    if (accion === "traspaso" && namedDestination && !roles?.origin && resolvedLocation === namedDestination && this.overrides.local === undefined) {
      resolvedLocation = null;
      locationOutcome = "preguntar";
    }
    if (!resolvedLocation && this.onlyLocation()) {
      resolvedLocation = this.onlyLocation();
      locationOutcome = "actuar";
    } else if (!resolvedLocation && areaLocation) {
      resolvedLocation = areaLocation;
      locationOutcome = "actuar";
    } else if (!resolvedLocation && this.pageLocationId) {
      resolvedLocation = this.pageLocationId;
      locationOutcome = "confirmar";
    }
    // Sin local claro se pregunta; el habitual solo se ofrece como primera opción.
    if (!resolvedLocation || locationOutcome === "preguntar") {
      const question = accion === "traspaso" ? (namedDestination ? `¿Desde qué local sale la mercancía hacia ${locationLabel(this.ctx, namedDestination)}?` : "¿Desde qué local sale la mercancía?") : "¿En qué local?";
      const options = this.locationOptions(locGate?.ranked ?? []).filter((o) => !namedDestination || this.meta.locationKeys.get(o.option) !== namedDestination);
      return this.clarify("local", question, options, [TODOS, NO_INDICADO], locationName);
    }

    let toLocationId: string | null = null;
    let toLocationOutcome: GateOutcome = "actuar";
    if (accion === "traspaso") {
      const toGate = this.gateSlot(context, "local_destino", "local_destino", "Local destino");
      toLocationId = toGate && toGate.choice !== NO_APLICA ? this.meta.locationKeys.get(toGate.choice) ?? null : null;
      toLocationOutcome = toLocationId && toLocationId !== resolvedLocation ? toGate!.outcome : "preguntar";
      // El destino dicho con «al/a» manda si Jev no da otro distinto del origen.
      if (toLocationOutcome === "preguntar" && namedDestination && namedDestination !== resolvedLocation) {
        toLocationId = namedDestination;
        toLocationOutcome = "actuar";
      }
      if (roles && toGate && toLocationOutcome === "confirmar" && roles.destination === toGate.choice) {
        toLocationOutcome = "actuar";
        this.markActed("local_destino");
      }
      if (toLocationOutcome === "preguntar") {
        const ranked = (toGate?.ranked ?? []).filter((r) => this.meta.locationKeys.get(r.option) !== resolvedLocation);
        return this.clarify("local_destino", "¿A qué local va la mercancía?", ranked, [NO_APLICA], locationName);
      }
    }

    const products = this.resolveProducts(context, true);
    if ("type" in products) return products;
    if (products.length === 0 && relevant(context, "producto")) {
      return { type: "clarify", field: "producto", question: "¿Qué producto y qué cantidad?", options: [] };
    }
    for (const p of products) {
      if (relevant(context, "cantidad") && (p.amount === null || p.quantityOutcome === "preguntar")) {
        const options = p.amount !== null ? [{ id: "si", label: `Sí, ${p.amount} ${p.unit ?? ""}${p.loose ? ` y ${p.loose} sueltas` : ""}`.trim(), probability: null }] : [];
        return { type: "clarify", field: "cantidad", question: `¿Qué cantidad de ${p.product.name}?`, options, segmentIndex: p.segmentIndex };
      }
    }

    // Mucha ambigüedad percibida. Si algún dato era dudoso, se pide repetir la orden. Si todos estaban
    // claros (operación, locales, productos y cantidades), una pregunta genérica no ayuda: se prepara
    // el borrador con un aviso (nada se ejecuta sin confirmarlo) y el formato, si falta, se pregunta aparte.
    const ambiguo = asNoul(this.answers.ambiguo);
    const allClear =
      locationOutcome === "actuar" &&
      toLocationOutcome === "actuar" &&
      products.every((p) => (p.productOutcome ?? "actuar") === "actuar" && (p.quantityOutcome ?? "actuar") === "actuar");
    const tooAmbiguous = !!ambiguo && accion !== "cierre_inventario" && Object.keys(this.overrides).length === 0 && gateNoulNo(ambiguo, t.ambiguo) === "preguntar";
    if (tooAmbiguous && !allClear) {
      return {
        type: "clarify",
        field: "tipo_accion",
        question: "No tengo claro qué quieres registrar. ¿Puedes indicarme la operación, el producto, la cantidad y el local?",
        options: [],
        restart: true,
      };
    }

    const motivo = (relevant(context, "motivo") ? this.choice("motivo_merma")?.choice ?? NO_INDICADO : NO_INDICADO) as MotivoMerma;
    const ambiguous = asNoul(this.answers.ambiguo)?.noul ?? 0;
    return {
      type: "accion",
      accion,
      locationId: resolvedLocation,
      locationOutcome,
      toLocationId,
      toLocationOutcome,
      areaId: areaId && areaLocation === resolvedLocation ? areaId : null,
      products,
      motivo,
      ambiguous,
      ...(tooAmbiguous ? { reviewAll: true } : {}),
    };
  }
}

/**
 * La consulta que contesta ese dato de esos productos: «¿a cuánto nos sale el Beefeater?» es su
 * último precio (no la ficha entera), «¿cuántas botellas de Beefeater hay?» su stock, y el proveedor,
 * los formatos o el mínimo de un producto salen de su ficha. Sin productos, la consulta de Jev.
 */
export function toolForDato(tool: Herramienta, dato: Dato, productCount: number): Herramienta {
  if (productCount === 0) return tool;
  const lookup = tool === "query_stock" || tool === "query_product";
  if (dato === "precio" && (lookup || tool === "query_prices")) return "query_prices";
  if (!lookup) return tool;
  if (dato === "cantidad" || dato === "valor") return "query_stock";
  if ((dato === "proveedor" || dato === "formatos" || dato === "minimo") && productCount === 1) return "query_product";
  return tool;
}

/** «2 botellas», «1 caja», «6 ud»: la cantidad del mensaje para enseñarla. */
function amountLabel(amount: string, unit: string | null): string {
  const n = formatDecimal(amount, 4);
  if (!unit) return n;
  const plural = amount !== "1" && !/^(ud|kg|g|l|cl|ml)$/.test(unit) ? (/[aeiou]$/.test(unit) ? `${unit}s` : `${unit}es`) : unit;
  return `${n} ${plural}`;
}

export function locationLabel(ctx: SessionContext, id: string): string {
  return ctx.locations.find((l) => l.id === id)?.name ?? id;
}
