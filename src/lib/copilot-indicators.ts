// Indicadores del asistente (migración 0062): lo que dice si funciona en uso real. Aquí solo se leen y se
// resumen para la pantalla; el cálculo lo hace la base de datos.

export interface CopilotIndicators {
  desde: string;
  mensajes: number;
  aclaraciones: number;
  conversaciones: number;
  con_bucle: number;
  racha_max: number;
  sin_resolver: number;
  cancelaciones: number;
  por_via: Array<{ via: string; mensajes: number; aclaraciones: number; p50_ms: number | null; p90_ms: number | null }>;
  borradores: Array<{ tipo: string; preparados: number; confirmados: number }>;
}

/** Objetivos del plan de mejora (docs/copiloto/PROMPT_MEJORA_ASISTENTE.md): al final, la fase 7. */
export const TARGETS = { aclaraciones: 15, bucles: 0, sinResolver: 5, confirmados: 50 } as const;

export const VIA_LABEL: Record<string, string> = {
  documento: "Archivo leído",
  varias_ordenes: "Varias órdenes",
  boton: "Botón",
  formulario: "Miniformulario",
  aclaracion: "Respuesta a una aclaración",
  atajo: "Atajo (sin Jev)",
  comprension: "Reescrito por la IA",
  jev: "Jev",
};

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

export interface IndicatorSummary {
  clarifyPct: number | null;
  loopPct: number | null;
  unresolvedPct: number | null;
  confirmedPct: number | null;
  drafts: { prepared: number; confirmed: number };
}

export function summarize(i: CopilotIndicators): IndicatorSummary {
  const prepared = i.borradores.reduce((n, b) => n + b.preparados, 0);
  const confirmed = i.borradores.reduce((n, b) => n + b.confirmados, 0);
  return {
    clarifyPct: pct(i.aclaraciones, i.mensajes),
    loopPct: pct(i.con_bucle, i.conversaciones),
    unresolvedPct: pct(i.sin_resolver, i.conversaciones),
    confirmedPct: pct(confirmed, prepared),
    drafts: { prepared, confirmed },
  };
}

/** «0,4 s», «1,2 s»; sin dato, «—». */
export function seconds(ms: number | null): string {
  return ms === null ? "—" : `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}
