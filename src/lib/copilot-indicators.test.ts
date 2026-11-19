import { describe, expect, it } from "vitest";
import { seconds, summarize, type CopilotIndicators } from "./copilot-indicators";

const base: CopilotIndicators = {
  desde: "2026-10-19T00:00:00Z",
  mensajes: 200,
  aclaraciones: 100,
  conversaciones: 40,
  con_bucle: 7,
  racha_max: 20,
  sin_resolver: 6,
  cancelaciones: 3,
  por_via: [],
  borradores: [
    { tipo: "merma", preparados: 10, confirmados: 1 },
    { tipo: "pedido", preparados: 4, confirmados: 0 },
  ],
};

describe("indicadores del asistente", () => {
  it("porcentajes sobre su base: mensajes, conversaciones y borradores", () => {
    expect(summarize(base)).toEqual({ clarifyPct: 50, loopPct: 18, unresolvedPct: 15, confirmedPct: 7, drafts: { prepared: 14, confirmed: 1 } });
  });

  it("sin datos no hay porcentaje (no un 0 % engañoso)", () => {
    expect(summarize({ ...base, mensajes: 0, conversaciones: 0, borradores: [] })).toMatchObject({ clarifyPct: null, loopPct: null, confirmedPct: null });
  });

  it("latencia en segundos", () => {
    expect(seconds(450)).toBe("0,5 s");
    expect(seconds(null)).toBe("—");
  });
});
