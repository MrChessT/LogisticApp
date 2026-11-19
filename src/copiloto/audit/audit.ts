import type { Decision } from "../contract/index";

export type AuditEvent =
  | {
      type: "mensaje";
      at: string;
      userId: string;
      orgId: string;
      sessionId: string;
      messageId: string;
      message: string;
      intent: string;
      decisions: Decision[];
      outcome: string;
      jevModel: string | null;
      catalogVersion: string;
      shortcut: boolean;
      /** La comprensión reescribió el mensaje: lo que se entendió (message es lo que dijo el usuario). */
      understoodAs?: string;
      /** Cómo fue el turno (fase 0 del plan de mejora): sin esto no se mide la calidad real, solo la intención. */
      turn?: TurnTrace;
    }
  | { type: "borrador"; at: string; userId: string; orgId: string; messageId: string; draftId: string; kind: string; coherence: number }
  | { type: "confirmacion"; at: string; userId: string; orgId: string; draftId: string; kind: string; ok: boolean; code?: string }
  | { type: "bloqueo"; at: string; userId: string; orgId: string; messageId: string; reason: string };

/** Por dónde se resolvió un mensaje: los indicadores separan lo que va por atajo de lo que pasa por Jev. */
export type Via = "documento" | "varias_ordenes" | "boton" | "formulario" | "aclaracion" | "atajo" | "comprension" | "jev";

export interface TurnTrace {
  via: Via;
  /** Lo que se respondió (recortado al guardarlo). */
  reply: string;
  /** Tipo de plan ejecutado (consulta, accion, tarea, aviso…) y quién lo atendió. */
  plan: string | null;
  especialista: string | null;
  /** Milisegundos en total y por etapa (entidades, jev1, redacción…). */
  ms: number;
  stages: Record<string, number>;
  /** Si fue una aclaración, sobre qué; si salió un miniformulario o un borrador. */
  clarifyField: string | null;
  form: boolean;
  draft: boolean;
  /** Plantilla o modelo de lenguaje. */
  textSource: string | null;
  /** «bateria» si lo mandó una batería de pruebas: no es uso real. */
  origin: string | null;
}

export interface AuditSink {
  record(event: AuditEvent): Promise<void>;
}

export class MemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];

  async record(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
}

/** Varios destinos a la vez (logs + Supabase). Un destino caído no bloquea a los demás. */
export class CompositeAuditSink implements AuditSink {
  constructor(private readonly sinks: AuditSink[]) {}

  async record(event: AuditEvent): Promise<void> {
    await Promise.allSettled(this.sinks.map((sink) => sink.record(event)));
  }
}

/** Auditoría en los logs de la plataforma (Vercel no tiene disco persistente). Sin el texto completo del mensaje. */
export class ConsoleAuditSink implements AuditSink {
  async record(event: AuditEvent): Promise<void> {
    const safe = event.type === "mensaje" ? { ...event, message: event.message.slice(0, 120) } : event;
    console.info(JSON.stringify({ copiloto_audit: safe }));
  }
}
