"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { seconds, summarize, TARGETS, VIA_LABEL, type CopilotIndicators } from "@/lib/copilot-indicators";
import "@/components/ui/kpi-strip.css";

// Indicadores del asistente en uso real (migración 0062), solo para la administración: si las respuestas son
// preguntas de vuelta, si la gente se queda en bucle o se rinde y si los borradores llegan a confirmarse.
// Es la medida del plan de mejora (docs/copiloto/PROMPT_MEJORA_ASISTENTE.md); la batería no la sustituye.

const PERIODS = [7, 30, 90] as const;

const value = (n: number | null) => (n === null ? "—" : `${n} %`);

export function AssistantIndicators({ orgId }: { orgId: string }) {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [tests, setTests] = useState(false);
  const [data, setData] = useState<CopilotIndicators | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    async function load() {
      const supabase = createClient();
      if (!supabase) return;
      const { data: result, error: err } = await supabase.rpc("copilot_indicators", { p_org: orgId, p_days: days, p_include_tests: tests });
      if (!alive) return;
      if (err) setError("No se pudieron cargar los indicadores.");
      else {
        setError("");
        setData(result as unknown as CopilotIndicators);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [orgId, days, tests]);

  const s = data ? summarize(data) : null;
  return (
    <section className="fb-indicators" aria-label="Indicadores del asistente">
      <header className="fb-indicators-head">
        <div>
          <h2>Cómo funciona en uso real</h2>
          <p>
            Mensajes de los últimos {days} días{tests ? ", con baterías y cuentas en modo pruebas" : " de personas (sin baterías ni cuentas en modo pruebas)"}. Se
            cuentan desde que el asistente guarda el rastro de cada turno (19/11/2026).
          </p>
        </div>
        <div className="fb-indicators-controls">
          {PERIODS.map((d) => (
            <button key={d} className={`filter-button ${d === days ? "active" : ""}`} onClick={() => setDays(d)}>
              {d} días
            </button>
          ))}
          <label className="fb-indicators-tests">
            <input type="checkbox" checked={tests} onChange={(e) => setTests(e.target.checked)} /> Incluir pruebas
          </label>
        </div>
      </header>
      {error && <p className="editor-message">{error}</p>}
      {data && s && (
        <>
          <div className="kpi-strip">
            <div className="kpi">
              <span className="kpi-label">Respuestas que son una pregunta</span>
              <span className={`kpi-value ${s.clarifyPct !== null && s.clarifyPct > TARGETS.aclaraciones ? "alert" : ""}`}>{value(s.clarifyPct)}</span>
              <span className="kpi-note">{data.aclaraciones} de {data.mensajes} · objetivo &lt; {TARGETS.aclaraciones} %</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Conversaciones en bucle</span>
              <span className={`kpi-value ${data.con_bucle > TARGETS.bucles ? "alert" : ""}`}>{value(s.loopPct)}</span>
              <span className="kpi-note">{data.con_bucle} de {data.conversaciones} · racha más larga {data.racha_max}</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Acaban sin resolver</span>
              <span className={`kpi-value ${s.unresolvedPct !== null && s.unresolvedPct > TARGETS.sinResolver ? "alert" : ""}`}>{value(s.unresolvedPct)}</span>
              <span className="kpi-note">{data.sin_resolver} conversaciones · {data.cancelaciones} «olvídalo»</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Borradores confirmados</span>
              <span className={`kpi-value ${s.confirmedPct !== null && s.confirmedPct < TARGETS.confirmados ? "alert" : ""}`}>{value(s.confirmedPct)}</span>
              <span className="kpi-note">{s.drafts.confirmed} de {s.drafts.prepared} · objetivo &gt; {TARGETS.confirmados} %</span>
            </div>
          </div>
          <div className="fb-indicators-tables">
            <table className="fb-indicators-table">
              <thead>
                <tr><th>Vía</th><th>Mensajes</th><th>Preguntas</th><th>Tarda (p50)</th><th>Tarda (p90)</th></tr>
              </thead>
              <tbody>
                {data.por_via.map((v) => (
                  <tr key={v.via}>
                    <td>{VIA_LABEL[v.via] ?? v.via}</td>
                    <td>{v.mensajes}</td>
                    <td>{v.mensajes ? `${Math.round((v.aclaraciones / v.mensajes) * 100)} %` : "—"}</td>
                    <td>{seconds(v.p50_ms)}</td>
                    <td>{seconds(v.p90_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="fb-indicators-table">
              <thead>
                <tr><th>Borrador</th><th>Preparados</th><th>Confirmados</th></tr>
              </thead>
              <tbody>
                {data.borradores.map((b) => (
                  <tr key={b.tipo}>
                    <td>{b.tipo}</td>
                    <td>{b.preparados}</td>
                    <td>{b.confirmados}</td>
                  </tr>
                ))}
                {data.borradores.length === 0 && (
                  <tr><td colSpan={3}>Ningún borrador en este periodo.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
