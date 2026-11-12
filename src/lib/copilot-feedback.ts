// Opiniones sobre el asistente (migración 0025): categorías, conversación que se adjunta y exportación
// a Markdown para pasárselo a quien desarrolla. La base de datos decide quién ve y revisa qué.

export const FEEDBACK_CATEGORIES = {
  incorrecto: "Respuesta incorrecta",
  no_entendio: "No me entendió",
  falta_funcion: "Debería poder hacer algo más",
  mejorar_texto: "Se explica mal o es muy largo",
  error: "Falló o se quedó colgado",
  otro: "Otra cosa",
} as const;
export type FeedbackCategory = keyof typeof FEEDBACK_CATEGORIES;

export const FEEDBACK_STATUS = {
  nueva: "Nueva",
  aceptada: "Aceptada",
  hecha: "Hecha",
  descartada: "Descartada",
} as const;
export type FeedbackStatus = keyof typeof FEEDBACK_STATUS;

/** Un mensaje de la conversación tal como se guarda en el reporte. */
export type TranscriptEntry = {
  role: "user" | "assistant";
  text: string;
  /** Lo que acompañaba al texto: borrador, tabla, opciones, error… */
  detail?: string;
  /** El mensaje sobre el que se reporta. */
  flagged?: boolean;
};

export type FeedbackRow = {
  id: string;
  scope: "mensaje" | "conversacion";
  category: FeedbackCategory;
  comment: string;
  expected: string | null;
  transcript: TranscriptEntry[];
  page: string | null;
  test_mode: boolean;
  status: FeedbackStatus;
  review_note: string | null;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
  created_at: string;
  author: string;
  mine: boolean;
};

/** Cuántos mensajes se adjuntan como máximo (la base de datos admite 60). */
const MAX_TRANSCRIPT = 40;
const MAX_TEXT = 1500;

const clip = (text: string, max = MAX_TEXT) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * La parte de la conversación que va con el reporte. `upTo`: índice del mensaje reportado (incluido);
 * `before`: cuántos mensajes anteriores incluir (null = todos).
 */
export function transcriptSlice<T>(items: T[], upTo: number, before: number | null): T[] {
  const end = Math.min(Math.max(upTo, 0), items.length - 1) + 1;
  const start = before === null ? 0 : Math.max(0, end - 1 - before);
  return items.slice(Math.max(start, end - MAX_TRANSCRIPT), end);
}

export function cleanTranscript(entries: TranscriptEntry[]): TranscriptEntry[] {
  return entries.slice(-MAX_TRANSCRIPT).map((e) => ({
    role: e.role,
    text: clip(e.text.trim()),
    ...(e.detail?.trim() ? { detail: clip(e.detail.trim(), 600) } : {}),
    ...(e.flagged ? { flagged: true } : {}),
  }));
}

const fecha = (iso: string) =>
  new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });

const quote = (text: string) =>
  text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");

/** Markdown listo para pegar en una conversación con Claude: qué se pide y la conversación de cada caso. */
export function feedbackMarkdown(rows: FeedbackRow[], now = new Date()): string {
  const out: string[] = [
    "# Opiniones sobre el asistente de LogisticApp",
    "",
    `Exportado el ${fecha(now.toISOString())} · ${rows.length} ${rows.length === 1 ? "reporte" : "reportes"}.`,
    "",
    "Para cada reporte: entiende el problema con la conversación adjunta, busca la causa en el código del asistente (`src/copiloto/`) y propón o aplica el cambio. Si un reporte no tiene sentido o choca con otro, dilo.",
  ];
  rows.forEach((r, i) => {
    out.push(
      "",
      "---",
      "",
      `## ${i + 1}. ${FEEDBACK_CATEGORIES[r.category]}${r.scope === "conversacion" ? " (toda la conversación)" : ""}`,
      "",
      `- **Quién:** ${r.author}${r.test_mode ? " (modo pruebas)" : ""} · ${fecha(r.created_at)}${r.page ? ` · pantalla ${r.page}` : ""}`,
      `- **Estado:** ${FEEDBACK_STATUS[r.status]}${r.review_note ? ` · nota de revisión: ${r.review_note}` : ""}`,
      `- **Qué está mal o qué cambiaría:** ${r.comment}`,
    );
    if (r.expected) out.push(`- **Qué esperaba:** ${r.expected}`);
    if (r.transcript.length) {
      out.push("", "**Conversación:**", "");
      for (const e of r.transcript) {
        const who = e.role === "user" ? "Usuario" : "Asistente";
        out.push(`${e.flagged ? "**▶ Reportado** · " : ""}*${who}:*`, quote(e.text || "(sin texto)"));
        if (e.detail) out.push(quote(`[${e.detail}]`));
        out.push("");
      }
    }
  });
  return `${out.join("\n").trimEnd()}\n`;
}
