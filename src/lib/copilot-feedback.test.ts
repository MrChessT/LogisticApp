import { describe, expect, it } from "vitest";
import { cleanTranscript, feedbackMarkdown, transcriptSlice, type FeedbackRow } from "./copilot-feedback";

const row: FeedbackRow = {
  id: "1",
  scope: "mensaje",
  category: "incorrecto",
  comment: "Dijo 3 cajas y había 2",
  expected: "Que mire el último conteo",
  transcript: [
    { role: "user", text: "¿Cuánto Barceló hay?" },
    { role: "assistant", text: "Hay 3 cajas.", detail: "Tabla: 1 fila", flagged: true },
  ],
  page: "/stock",
  test_mode: true,
  status: "aceptada",
  review_note: "Mirar cálculo",
  reviewed_at: null,
  reviewed_by_name: null,
  created_at: "2026-10-14T10:00:00Z",
  author: "Marta",
  mine: false,
};

describe("opiniones del asistente", () => {
  it("adjunta el mensaje reportado y los anteriores que se pidan", () => {
    const items = ["a", "b", "c", "d", "e"];
    expect(transcriptSlice(items, 3, 1)).toEqual(["c", "d"]);
    expect(transcriptSlice(items, 3, null)).toEqual(["a", "b", "c", "d"]);
    expect(transcriptSlice(items, 0, 5)).toEqual(["a"]);
    expect(transcriptSlice(items, 9, 0)).toEqual(["e"]);
  });

  it("recorta textos largos y quita lo vacío", () => {
    const [e] = cleanTranscript([{ role: "assistant", text: "x".repeat(2000), detail: "  " }]);
    expect(e!.text.length).toBe(1500);
    expect(e).not.toHaveProperty("detail");
    expect(e).not.toHaveProperty("flagged");
  });

  it("exporta a Markdown con lo pedido y la conversación, marcando el mensaje reportado", () => {
    const md = feedbackMarkdown([row], new Date("2026-10-14T12:00:00Z"));
    expect(md).toContain("## 1. Respuesta incorrecta");
    expect(md).toContain("**Quién:** Marta (modo pruebas)");
    expect(md).toContain("**Qué está mal o qué cambiaría:** Dijo 3 cajas y había 2");
    expect(md).toContain("**Qué esperaba:** Que mire el último conteo");
    expect(md).toContain("**▶ Reportado** · *Asistente:*\n> Hay 3 cajas.\n> [Tabla: 1 fila]");
    expect(md).toContain("1 reporte.");
  });
});
