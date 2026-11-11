// Informe de decisión: lo único que ve el redactor. JSON cerrado, sin ids internos ni datos personales.
import type { ClarifyEvent, Decision, Draft } from "../contract/index";
import type { Dato, EvalKind, Intent, Urgency } from "../jev/catalog";
import type { ToolName } from "../tools/tools";
import type { ToolResult } from "../tools/types";

export interface Scope {
  locales: string[];
  espacio: string | null;
  productos: string[];
  periodo: string | null;
  /** Familia del catálogo consultada entera («Ron»): se dice en vez de «de 10 productos». */
  familia?: string | null;
}

export interface Evaluation {
  kind: EvalKind;
  data: Record<string, string>;
  /** Noul de Jev: ¿merece atención? */
  relevance: number;
  urgency: Urgency;
  urgencyScore: number;
  confidence: number;
}

export type ReportOutcome =
  | {
      kind: "consulta";
      tool: ToolName;
      scope: Scope;
      result: ToolResult;
      evaluations: Evaluation[];
      notices: string[];
      tabulated?: boolean;
      dato?: Dato;
      /** No queda en el local pedido pero sí en otros: dónde (va en la tabla). */
      elsewhere?: string[];
    }
  | { kind: "aclaracion"; clarify: ClarifyEvent }
  /** charla: saludo, despedida o agradecimiento (respuesta corta en vez de la ayuda). */
  | { kind: "conversacion"; charla?: "hola" | "gracias" | "adios" }
  /** general: respuesta general del ayudante (sin datos del negocio), si la pregunta lo permite. */
  | { kind: "fuera_de_ambito"; general?: string }
  | { kind: "bloqueado" }
  | { kind: "borrador"; draft: Draft }
  | { kind: "resuelto"; status: "confirmado" | "descartado"; message: string }
  | { kind: "error"; message: string }
  /** Tarea (pedidos, equilibrar, catálogo, parte): el texto ya viene redactado con las cifras exactas. */
  | { kind: "tarea"; tarea: string; text: string; rows: number };

export interface DecisionReport {
  version: 1;
  messageId: string;
  catalogVersion: string;
  jevModel: string | null;
  intent: Intent;
  decisions: Decision[];
  outcome: ReportOutcome;
}

/** Vista del informe para el redactor: solo textos y cifras ya formateadas. */
export function writerView(report: DecisionReport): Record<string, unknown> {
  const o = report.outcome;
  const decisiones = report.decisions.map((d) => ({ decision: d.label, valor: d.valueLabel, confianza_pct: Math.round((d.confidence ?? d.probability) * 100) }));
  switch (o.kind) {
    case "consulta":
      return {
        tipo: "consulta",
        consulta: o.tool,
        ...(o.dato ? { dato_pedido: o.dato } : {}),
        ambito: o.scope,
        resultado: { filas: o.result.rows.map(stripIds), totales: o.result.totals, total_filas: String(o.result.count), recortado: o.result.truncated },
        valoraciones: o.evaluations.map((e) => ({ ...e.data, urgencia: e.urgency, relevante: e.relevance >= 0.5 })),
        total_relevantes: String(o.evaluations.filter((e) => e.relevance >= 0.5).length),
        avisos: o.notices,
        ...(o.elsewhere ? { hay_en_otros_locales: o.elsewhere } : {}),
        decisiones,
      };
    case "aclaracion":
      return { tipo: "aclaracion", pregunta: o.clarify.question, opciones: o.clarify.options.map((opt) => opt.label) };
    case "borrador":
      return { tipo: "borrador", borrador: draftView(o.draft), decisiones };
    case "error":
      return { tipo: "error", mensaje: o.message };
    case "tarea":
      return { tipo: "tarea", tarea: o.tarea, texto: o.text };
    default:
      return { tipo: o.kind };
  }
}

function stripIds(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => key !== "id"));
}

const HIDDEN_DRAFT_KEYS = new Set(["draftId", "expiresAt", "editable"]);

function draftView(draft: Draft): Record<string, unknown> {
  return Object.fromEntries(Object.entries(draft).filter(([key]) => !HIDDEN_DRAFT_KEYS.has(key) && !/Id$/.test(key)));
}
