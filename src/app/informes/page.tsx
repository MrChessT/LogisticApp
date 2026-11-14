"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Building2, Download, Layers, Sparkles } from "lucide-react";
import { ChartCard } from "@/components/charts/charts";
import type { AnalyticsResponse, AnalyticsView } from "@/copiloto/contract";
import "../productos/productos.css";
import "./informes.css";

const VIEWS: Array<{ id: AnalyticsView; label: string }> = [
  { id: "resumen", label: "Resumen" },
  { id: "compras", label: "Compras" },
  { id: "consumo", label: "Consumo" },
  { id: "mermas", label: "Mermas" },
  { id: "stock", label: "Stock" },
  { id: "precios", label: "Precios" },
  { id: "reposicion", label: "Reposición" },
  { id: "desvios", label: "Desvíos" },
];
const PERIODS = [7, 30, 90] as const;

/** Todo lo que cambia el informe: se guarda en la URL, así que una vista filtrada se puede compartir. */
interface Filters {
  view: AnalyticsView;
  location: string;
  days: number;
  /** Departamento del catálogo (cuenta de análisis); vacío = todos. */
  department: string;
}

function readFilters(): Filters {
  const params = new URLSearchParams(window.location.search);
  const view = VIEWS.find((v) => v.id === params.get("vista"))?.id ?? "resumen";
  const days = Number(params.get("dias"));
  return {
    view,
    location: params.get("local") ?? "",
    days: PERIODS.includes(days as 7) ? days : 30,
    department: params.get("departamento") ?? "",
  };
}

/** Parámetros del informe, iguales para la pantalla, el resumen y el PDF. */
function reportParams(f: Filters, vista: string = f.view): URLSearchParams {
  const params = new URLSearchParams({ vista, dias: String(f.days) });
  if (f.location) params.set("locationId", f.location);
  if (f.department) params.set("departamento", f.department);
  return params;
}

/** Descarga del PDF que genera el servidor con los mismos datos, permisos y filtros que la pantalla. */
function PdfButton({ label, vista, filters, ready }: { label: string; vista: AnalyticsView | "todas"; filters: Filters; ready: boolean }) {
  if (!ready) return <span className="informes-print" aria-disabled="true"><Download size={15} aria-hidden /> {label}</span>;
  return (
    <a className="informes-print" href={`/api/copiloto/analytics/pdf?${reportParams(filters, vista).toString()}`} download>
      <Download size={15} aria-hidden /> {label}
    </a>
  );
}

export default function InformesPage() {
  const [filters, setFilters] = useState<Filters>({ view: "resumen", location: "", days: 30, department: "" });
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Resumen redactado (llega después de las cifras; si no hay ayudante o no es fiable, no se muestra).
  const [summary, setSummary] = useState<{ state: "cargando" | "listo"; text: string | null }>({ state: "listo", text: null });
  // Cada cambio de filtro cancela la petición anterior: no se calcula ni se pinta algo que ya no se ve.
  const inFlight = useRef<AbortController | null>(null);

  async function loadSummary(params: URLSearchParams, signal: AbortSignal) {
    setSummary({ state: "cargando", text: null });
    try {
      const res = await fetch(`/api/copiloto/analytics/resumen?${params.toString()}`, { signal });
      const body = (await res.json()) as { text?: string | null };
      if (!signal.aborted) setSummary({ state: "listo", text: res.ok ? (body.text ?? null) : null });
    } catch {
      if (!signal.aborted) setSummary({ state: "listo", text: null });
    }
  }

  async function load(next: Filters) {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const { signal } = controller;
    setLoading(true);
    setError("");
    setSummary({ state: "listo", text: null });
    const params = reportParams(next);
    window.history.replaceState(null, "", `/informes?${params.toString()}`);
    try {
      const res = await fetch(`/api/copiloto/analytics?${params.toString()}`, { signal });
      const body = (await res.json()) as AnalyticsResponse & { message?: string };
      if (!res.ok) throw new Error(body.message ?? "No se pudieron cargar los informes.");
      setData(body);
      if (body.kpis.length > 0 || body.charts.length > 0) void loadSummary(params, signal);
    } catch (err) {
      if (signal.aborted) return;
      setError(err instanceof Error ? err.message : "No se pudieron cargar los informes.");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }

  function change(patch: Partial<Filters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    void load(next);
  }

  useEffect(() => {
    // Carga inicial con los filtros de la URL (el asistente enlaza aquí con ?vista=&local=&dias=&departamento=).
    async function bootstrap() {
      await Promise.resolve();
      const initial = readFilters();
      setFilters(initial);
      await load(initial);
    }
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al entrar: después manda `change`
  }, []);

  const current = VIEWS.find((v) => v.id === filters.view)!;
  const [lead, ...rest] = data?.charts ?? [];
  const departmentName = filters.department || "Todos los departamentos";

  return (
    <main className="informes-page">
      <div className="informes-content">
        <div className="informes-heading">
          <div>
            <h1>Informes</h1>
            <p className="informes-meta">
              {current.label} · {data?.locationName ?? "Todos los locales"} · {departmentName} · últimos {filters.days} días
            </p>
          </div>
          <div className="informes-download">
            <PdfButton label="Esta vista" vista={filters.view} filters={filters} ready={data !== null} />
            <PdfButton label="Informe completo" vista="todas" filters={filters} ready={data !== null} />
          </div>
        </div>

        <div className="informes-filters" role="toolbar" aria-label="Filtros">
          <div className="informes-tabs" role="tablist">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" role="tab" aria-selected={v.id === filters.view} className={v.id === filters.view ? "active" : ""} onClick={() => change({ view: v.id })}>
                {v.label}
              </button>
            ))}
          </div>
          <div className="informes-selects">
            <label className="location-select">
              <Building2 size={15} />
              <select value={filters.location} onChange={(event) => change({ location: event.target.value })} aria-label="Local">
                {/* Con un único local, «todos» es ese local: no se repite. */}
                <option value="">{data?.locations.length === 1 ? data.locations[0]!.name : "Todos los locales"}</option>
                {(data?.locations.length ?? 0) > 1 && data?.locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </label>
            <label className="location-select">
              <Layers size={15} />
              <select value={filters.department} onChange={(event) => change({ department: event.target.value })} aria-label="Departamento">
                <option value="">Todos los departamentos</option>
                {data?.departments.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </label>
            <div className="informes-periods" role="group" aria-label="Periodo">
              {PERIODS.map((p) => (
                <button key={p} type="button" className={p === filters.days ? "active" : ""} onClick={() => change({ days: p })}>
                  {p} días
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && <p className="informes-error">{error}</p>}

        <div className={`informes-body${loading ? " loading" : ""}`}>
          {data && data.kpis.length > 0 && (
            <div className="informes-kpis">
              {data.kpis.map((kpi) => (
                <div key={kpi.id} className="informes-kpi">
                  <span>{kpi.label}</span>
                  <strong>{kpi.value}</strong>
                  {kpi.delta ? (
                    <small className={kpi.delta.direction === "flat" ? "flat" : kpi.delta.good ? "good" : "bad"}>
                      {kpi.delta.direction === "up" ? <ArrowUpRight size={13} /> : kpi.delta.direction === "down" ? <ArrowDownRight size={13} /> : <ArrowRight size={13} />}
                      {kpi.delta.display}
                    </small>
                  ) : (
                    kpi.hint && <small>{kpi.hint}</small>
                  )}
                </div>
              ))}
            </div>
          )}

          {(summary.state === "cargando" || summary.text) && (
            <section className="informes-summary" aria-live="polite">
              <Sparkles size={16} aria-hidden />
              <div>
                <p>{summary.text ?? "Redactando el resumen…"}</p>
              </div>
            </section>
          )}

          {!data && loading && <p className="informes-muted">Calculando…</p>}

          {data && data.kpis.length === 0 && data.charts.length === 0 && (
            <p className="informes-muted">No hay productos en este departamento para el periodo elegido.</p>
          )}

          {data && (
            <div className="informes-grid">
              {lead && (
                <div className={lead.kind === "line" ? "wide" : ""}>
                  <ChartCard spec={lead} />
                </div>
              )}
              {rest.map((chart) => (
                <div key={chart.id}>
                  <ChartCard spec={chart} />
                </div>
              ))}
            </div>
          )}
          {data && <p className="informes-muted">Cifras calculadas a coste medio. Actualizado {new Date(data.generatedAt).toLocaleString("es-ES")}.</p>}
        </div>
      </div>
    </main>
  );
}
