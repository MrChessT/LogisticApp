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
    }
  | { type: "borrador"; at: string; userId: string; orgId: string; messageId: string; draftId: string; kind: string; coherence: number }
  | { type: "confirmacion"; at: string; userId: string; orgId: string; draftId: string; kind: string; ok: boolean; code?: string }
  | { type: "bloqueo"; at: string; userId: string; orgId: string; messageId: string; reason: string };

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
