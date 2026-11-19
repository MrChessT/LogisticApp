// Auditoría de cada turno (fase 0 del plan de mejora): sin la respuesta, la vía y el tiempo no se puede medir la
// calidad real del asistente, solo la intención. Los turnos de archivo y de varias órdenes también cuentan.
import { describe, expect, it } from "vitest";
import type { AuditEvent } from "../audit/audit";
import type { ChatDocument } from "../contract/index";
import { auditRow } from "../supabase/audit-sink";
import { chat, FakeJev, find, makeAgent, run } from "./helpers";

type Mensaje = Extract<AuditEvent, { type: "mensaje" }>;
const mensajes = (events: AuditEvent[]) => events.filter((e): e is Mensaje => e.type === "mensaje");

describe("auditoría del turno", () => {
  it("una consulta por Jev guarda la vía, la respuesta, el plan y el tiempo", async () => {
    const { agent, audit } = makeAgent(new FakeJev([{ intent: "consultar", intent_alt: "leer", herramienta: "query_stock", local: "Parador", producto_0: "Ron Barceló Añejo 70 cl" }]));
    const events = await run(agent, chat("¿cuánto ron Barceló queda en Parador?"));
    const [m] = mensajes(audit.events);
    expect(m!.turn).toMatchObject({ via: "jev", plan: "consultar", clarifyField: null, draft: false, textSource: "plantilla" });
    expect(m!.turn!.reply).toBe(find(events, "done")!.text);
    expect(m!.turn!.ms).toBeGreaterThanOrEqual(0);
    expect(Object.keys(m!.turn!.stages)).toContain("jev1");
  });

  it("una aclaración guarda sobre qué pregunta", async () => {
    // Sin respuestas de Jev no se adivina la intención: se pregunta, y la auditoría dice sobre qué.
    const { agent, audit } = makeAgent(new FakeJev([{}]));
    const events = await run(agent, chat("lo de ayer"));
    const clarify = find(events, "clarify")!;
    const [m] = mensajes(audit.events);
    expect(m).toMatchObject({ outcome: "aclaracion", turn: { via: "jev", plan: "clarify", clarifyField: clarify.field } });
  });

  it("un comando va por atajo y un botón queda como «boton»", async () => {
    const { agent, audit } = makeAgent(new FakeJev([{ coherencia: 0.95 }]));
    const events = await run(agent, chat("/equilibrar"));
    const button = find(events, "actions")!.actions[0]!;
    await run(agent, chat(button.label, { followUpId: button.id }));
    expect(mensajes(audit.events).map((m) => m.turn!.via)).toEqual(["atajo", "boton"]);
    expect(mensajes(audit.events)[1]!.turn!.draft).toBe(true);
  });

  it("un turno sobre el archivo leído también se audita (antes salía sin registro)", async () => {
    const factura: ChatDocument = {
      kind: "factura", file: "f.pdf", number: "F-1", date: "2026-11-14", party: "Makro", base: "15.00", vat: "1.50", total: "16.50", status: "cuadra",
      lines: [{ code: null, description: "LIMONES MALLA", qty: "12", unit: "kg", price: "1.25", amount: "15.00" }],
    };
    const { agent, audit } = makeAgent(new FakeJev([]));
    await run(agent, chat("¿qué trae esta factura?", { document: factura }));
    const [m] = mensajes(audit.events);
    expect(m).toMatchObject({ intent: "documento", outcome: "consulta", turn: { via: "documento" } });
    expect(m!.turn!.reply).toMatch(/^Esta factura F-1 de Makro/);
  });

  it("en la tabla va recortado y con nombres de columna de la base", () => {
    const row = auditRow({
      type: "mensaje", at: "", userId: "u", orgId: "o", sessionId: "s", messageId: "m", message: "hola", intent: "conversar", decisions: [],
      outcome: "conversacion", jevModel: null, catalogVersion: "v", shortcut: true,
      turn: { via: "atajo", reply: "x".repeat(2000), plan: "aviso", especialista: null, ms: 12, stages: { jev1: 3 }, clarifyField: null, form: false, draft: false, textSource: "plantilla", origin: "bateria" },
    });
    const detail = row.detail as Record<string, unknown>;
    expect((detail.reply as string).length).toBe(600);
    expect(detail).toMatchObject({ via: "atajo", plan: "aviso", ms: 12, stages: { jev1: 3 }, clarify_field: null, text_source: "plantilla", origen: "bateria" });
  });
});
