"use client";

// Reporte de una respuesta (o de toda la conversación) para mejorar el asistente.
import { useState } from "react";
import { Check, Flag, Loader2, Send, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cleanTranscript, FEEDBACK_CATEGORIES, transcriptSlice, type FeedbackCategory } from "@/lib/copilot-feedback";
import { toEntry, type Item } from "./chat-model";

const CONTEXT_OPTIONS = [
  { value: "2", label: "Esta respuesta y lo que le pedí" },
  { value: "6", label: "Los últimos 3 intercambios" },
  { value: "all", label: "Toda la conversación" },
] as const;

/**
 * Reporte sobre una respuesta (o sobre toda la conversación): qué está mal o qué cambiaría y, si quiere,
 * qué esperaba. Se adjunta la conversación para entenderlo después sin tener que preguntar.
 */
export function ReportForm({
  items,
  index,
  sessionId,
  page,
  onClose,
  onSent,
}: {
  items: Item[];
  /** Mensaje reportado; null = toda la conversación. */
  index: number | null;
  sessionId: string | null;
  page: string | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [comment, setComment] = useState("");
  const [expected, setExpected] = useState("");
  const [context, setContext] = useState<(typeof CONTEXT_OPTIONS)[number]["value"]>("2");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  const target = index === null ? null : items[index];
  const preview = target ? (target.role === "assistant" ? target.text || target.draft?.title || target.error || "(respuesta sin texto)" : target.text) : null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!category) return setError("Elige qué tipo de problema es.");
    if (comment.trim().length < 3) return setError("Cuenta en una frase qué está mal o qué cambiarías.");
    const slice =
      index === null ? items : transcriptSlice(items, index, context === "all" ? null : Number(context) - 1);
    const transcript = cleanTranscript(slice.map((item) => toEntry(item, item === target)));
    setState("sending");
    setError("");
    const supabase = createClient();
    const { error: err } = (await supabase?.rpc("copilot_feedback_add", {
      p_scope: index === null ? "conversacion" : "mensaje",
      p_category: category,
      p_comment: comment.trim(),
      p_expected: expected.trim() || null,
      p_transcript: transcript,
      p_session: sessionId,
      p_page: page,
    })) ?? { error: { message: "Supabase no está configurado" } };
    if (err) {
      setState("idle");
      setError("No se ha podido enviar. Inténtalo de nuevo en un momento.");
      return;
    }
    setState("sent");
    onSent();
  }

  return (
    <div className="copiloto-report-layer" onClick={() => state !== "sending" && onClose()}>
      <form className="copiloto-report" onSubmit={submit} onClick={(event) => event.stopPropagation()} aria-label="Reportar al asistente">
        <header>
          <strong><Flag size={15} /> {index === null ? "Reportar la conversación" : "Reportar esta respuesta"}</strong>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar"><X size={16} /></button>
        </header>
        {state === "sent" ? (
          <div className="copiloto-report-sent">
            <Check size={22} />
            <p><b>Gracias, enviado.</b> Lo revisaremos para mejorar el asistente.</p>
            <button type="button" className="primary-button" onClick={onClose}>Seguir probando</button>
          </div>
        ) : (
          <>
            {preview && <blockquote>{preview.length > 220 ? `${preview.slice(0, 219)}…` : preview}</blockquote>}
            <p className="copiloto-report-label">¿Qué pasa?</p>
            <div className="copiloto-report-cats" role="radiogroup" aria-label="Tipo de problema">
              {(Object.keys(FEEDBACK_CATEGORIES) as FeedbackCategory[]).map((c) => (
                <button key={c} type="button" role="radio" aria-checked={category === c} className={category === c ? "active" : undefined} onClick={() => { setCategory(c); setError(""); }}>
                  {FEEDBACK_CATEGORIES[c]}
                </button>
              ))}
            </div>
            <label className="copiloto-report-label">
              ¿Qué está mal o qué cambiarías?
              <textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={2000} rows={3} placeholder="Ej.: me dijo 3 cajas de Barceló y en el almacén hay 2" autoFocus />
            </label>
            <label className="copiloto-report-label">
              ¿Qué esperabas que hiciera? <small>(opcional)</small>
              <textarea value={expected} onChange={(event) => setExpected(event.target.value)} maxLength={2000} rows={2} placeholder="Ej.: que mirase el último inventario" />
            </label>
            {index !== null && index > 0 && (
              <label className="copiloto-report-label">
                Adjuntar
                <select value={context} onChange={(event) => setContext(event.target.value as typeof context)}>
                  {CONTEXT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            )}
            {error && <p className="copiloto-error">{error}</p>}
            <div className="copiloto-report-actions">
              <button type="button" className="ghost-button" onClick={onClose} disabled={state === "sending"}>Cancelar</button>
              <button type="submit" className="primary-button" disabled={state === "sending"}>
                {state === "sending" ? <Loader2 size={14} className="copiloto-spin" /> : <Send size={14} />} Enviar
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
