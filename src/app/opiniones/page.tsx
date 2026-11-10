"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, ClipboardCopy, Download, FlaskConical, MessageSquareWarning, RotateCcw, Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { normalizeText } from "@/lib/format";
import { FEEDBACK_CATEGORIES, FEEDBACK_STATUS, feedbackMarkdown, type FeedbackRow, type FeedbackStatus } from "@/lib/copilot-feedback";
import "../productos/productos.css";
import "../productos/product-editor.css";
import "./opiniones.css";
import { LoadingRows } from "@/components/ui/loading-rows";

// Opiniones sobre el asistente (migración 0025). Quien prueba el asistente reporta desde el propio chat;
// aquí la administración los revisa (aceptar, descartar, hecha) y exporta los aceptados en Markdown para
// pasárselos a Claude. El resto del equipo ve solo los suyos y en qué estado están.

type Tab = FeedbackStatus | "todas";
const TABS: Tab[] = ["nueva", "aceptada", "hecha", "descartada", "todas"];

const fecha = (iso: string) => new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });

export default function OpinionesPage() {
  const [rows, setRows] = useState<FeedbackRow[] | null>(null);
  const [admin, setAdmin] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("nueva");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function reload() {
    const supabase = createClient();
    if (!supabase) return setError("Configura las variables de Supabase.");
    const userId = (await supabase.auth.getSession()).data.session?.user.id;
    const [{ data: me }, list] = await Promise.all([
      supabase.from("memberships").select("role").eq("user_id", userId ?? "").limit(1).maybeSingle(),
      supabase.rpc("copilot_feedback_list", { p_status: null, p_limit: 500 }),
    ]);
    setAdmin(me?.role === "owner" || me?.role === "admin");
    if (list.error) return setError("No se pudieron cargar las opiniones.");
    setError("");
    setRows((list.data ?? []) as unknown as FeedbackRow[]);
  }

  useEffect(() => {
    async function start() {
      await Promise.resolve();
      await reload();
    }
    void start();
  }, []);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { nueva: 0, aceptada: 0, hecha: 0, descartada: 0, todas: rows?.length ?? 0 };
    for (const r of rows ?? []) c[r.status] += 1;
    return c;
  }, [rows]);

  const visible = (rows ?? []).filter(
    (r) =>
      (tab === "todas" || r.status === tab) &&
      (!query || normalizeText(`${r.comment} ${r.expected ?? ""} ${r.author} ${r.transcript.map((t) => t.text).join(" ")}`).includes(normalizeText(query))),
  );

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function review(ids: string[], status: FeedbackStatus) {
    if (!ids.length) return;
    setBusy(true);
    const supabase = createClient();
    // Una llamada por nota distinta (las notas son por reporte); sin nota, todas juntas.
    const withNote = ids.filter((id) => notes[id]?.trim());
    const without = ids.filter((id) => !notes[id]?.trim());
    const calls = [
      ...(without.length ? [supabase?.rpc("copilot_feedback_review", { p_ids: without, p_status: status })] : []),
      ...withNote.map((id) => supabase?.rpc("copilot_feedback_review", { p_ids: [id], p_status: status, p_note: notes[id]!.trim() })),
    ];
    const results = await Promise.all(calls);
    setBusy(false);
    if (results.some((r) => r?.error)) return setNotice("No se pudo guardar algún cambio. Inténtalo de nuevo.");
    setSelected(new Set());
    setNotes({});
    setNotice(`${ids.length === 1 ? "Reporte marcado" : `${ids.length} reportes marcados`} como «${FEEDBACK_STATUS[status].toLowerCase()}».`);
    await reload();
  }

  function exportable(): FeedbackRow[] {
    const all = rows ?? [];
    return selected.size ? all.filter((r) => selected.has(r.id)) : all.filter((r) => r.status === "aceptada");
  }

  async function exportMarkdown(mode: "copy" | "download") {
    const list = exportable();
    if (!list.length) return setNotice("No hay nada que exportar: acepta algún reporte o selecciónalos.");
    const md = feedbackMarkdown(list);
    if (mode === "download") {
      const url = URL.createObjectURL(new Blob([md], { type: "text/markdown;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `opiniones-asistente-${new Date().toISOString().slice(0, 10)}.md`;
      a.click();
      URL.revokeObjectURL(url);
      return setNotice(`Descargado: ${list.length} ${list.length === 1 ? "reporte" : "reportes"}. Pásale el archivo a Claude.`);
    }
    try {
      await navigator.clipboard.writeText(md);
      setNotice(`Copiado: ${list.length} ${list.length === 1 ? "reporte" : "reportes"}. Pégaselo a Claude.`);
    } catch {
      setNotice("No se pudo copiar: usa «Descargar .md».");
    }
  }

  const exportLabel = selected.size ? `${selected.size} seleccionados` : `${counts.aceptada} aceptados`;

  return (
    <main className="catalog-page">
      <div className="catalog-content">
        <div className="catalog-heading">
          <div>
            <p className="eyebrow">Asistente · Mejoras</p>
            <h1>Opiniones del asistente</h1>
            <p className="catalog-subtitle">
              {admin
                ? "Lo que el equipo ha reportado desde el chat. Acepta lo que quieras cambiar y expórtalo para pasárselo a Claude."
                : "Lo que has reportado desde el chat y en qué estado está."}
            </p>
          </div>
          {admin && (
            <div className="fb-export">
              <button className="catalog-primary" onClick={() => void exportMarkdown("copy")}><ClipboardCopy size={16} /> Copiar para Claude</button>
              <button className="ghost-button" onClick={() => void exportMarkdown("download")}><Download size={15} /> Descargar .md</button>
              <small>{exportLabel}</small>
            </div>
          )}
        </div>

        {notice && (
          <p className="editor-message fb-notice">
            {notice} <button onClick={() => setNotice("")} aria-label="Cerrar aviso"><X size={14} /></button>
          </p>
        )}

        <div className="catalog-tabs">
          {TABS.map((t) => (
            <button key={t} className={tab === t ? "active" : undefined} onClick={() => { setTab(t); setSelected(new Set()); }}>
              {t === "todas" ? "Todas" : `${FEEDBACK_STATUS[t]}s`} <b>{counts[t]}</b>
            </button>
          ))}
        </div>

        <section className="catalog-panel">
          <div className="catalog-toolbar">
            <div className="catalog-search">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar en reportes y conversaciones" />
            </div>
            {admin && selected.size > 0 && (
              <div className="fb-bulk">
                <span>{selected.size} seleccionados</span>
                <button className="ghost-button" disabled={busy} onClick={() => void review([...selected], "aceptada")}><Check size={14} /> Aceptar</button>
                <button className="ghost-button" disabled={busy} onClick={() => void review([...selected], "hecha")}>Marcar hechas</button>
                <button className="ghost-button danger" disabled={busy} onClick={() => void review([...selected], "descartada")}><X size={14} /> Descartar</button>
              </div>
            )}
          </div>

          <div className="fb-list">
            {!rows && !error && <LoadingRows label="Cargando" />}
            {error && <div className="catalog-empty"><strong>{error}</strong></div>}
            {rows && visible.length === 0 && !error && (
              <div className="catalog-empty">
                <MessageSquareWarning size={26} />
                <strong>{query ? "Nada coincide" : tab === "nueva" ? "No hay reportes nuevos" : "Nada por aquí"}</strong>
                <span>Los reportes se hacen desde el asistente, con «Reportar» en cada respuesta o arriba en el panel.</span>
              </div>
            )}
            {visible.map((r) => (
              <FeedbackCard
                key={r.id}
                row={r}
                admin={admin}
                busy={busy}
                selected={selected.has(r.id)}
                note={notes[r.id] ?? ""}
                onToggle={() => toggle(r.id)}
                onNote={(text) => setNotes((n) => ({ ...n, [r.id]: text }))}
                onReview={(status) => void review([r.id], status)}
              />
            ))}
          </div>
        </section>
        <p className="fb-footnote">
          Para que alguien pruebe el asistente sin tocar el inventario, actívale «Modo pruebas del asistente» en su ficha de Equipo: lo que confirme en el chat no se guarda.
        </p>
      </div>
    </main>
  );
}

function FeedbackCard({
  row,
  admin,
  busy,
  selected,
  note,
  onToggle,
  onNote,
  onReview,
}: {
  row: FeedbackRow;
  admin: boolean;
  busy: boolean;
  selected: boolean;
  note: string;
  onToggle: () => void;
  onNote: (text: string) => void;
  onReview: (status: FeedbackStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <article className={`fb-card status-${row.status} ${selected ? "selected" : ""}`}>
      <div className="fb-card-head">
        {admin && <input type="checkbox" checked={selected} onChange={onToggle} aria-label="Seleccionar reporte" />}
        <span className={`fb-cat cat-${row.category}`}>{FEEDBACK_CATEGORIES[row.category]}</span>
        {row.scope === "conversacion" && <span className="fb-chip">Toda la conversación</span>}
        {row.test_mode && <span className="fb-chip test"><FlaskConical size={11} /> Modo pruebas</span>}
        <span className={`fb-status s-${row.status}`}>{FEEDBACK_STATUS[row.status]}</span>
        <small className="fb-meta">{row.mine ? "Tú" : row.author} · {fecha(row.created_at)}{row.page ? ` · ${row.page}` : ""}</small>
      </div>
      <p className="fb-comment">{row.comment}</p>
      {row.expected && <p className="fb-expected"><b>Esperaba:</b> {row.expected}</p>}
      {row.review_note && <p className="fb-review-note"><b>Nota{row.reviewed_by_name ? ` de ${row.reviewed_by_name}` : ""}:</b> {row.review_note}</p>}

      {row.transcript.length > 0 && (
        <button className="fb-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {open ? "Ocultar" : "Ver"} conversación ({row.transcript.length} mensajes)
        </button>
      )}
      {open && (
        <div className="fb-transcript">
          {row.transcript.map((t, i) => (
            <div key={i} className={`fb-msg ${t.role} ${t.flagged ? "flagged" : ""}`}>
              {t.flagged && <span className="fb-flag">Reportado</span>}
              <p>{t.text || <i>(sin texto)</i>}</p>
              {t.detail && <small>{t.detail}</small>}
            </div>
          ))}
        </div>
      )}

      {admin && (
        <div className="fb-actions">
          <input value={note} onChange={(event) => onNote(event.target.value)} placeholder="Nota para Claude (opcional): qué cambiar exactamente" maxLength={1000} aria-label="Nota de revisión" />
          {row.status !== "aceptada" && <button className="ghost-button" disabled={busy} onClick={() => onReview("aceptada")}><Check size={14} /> Aceptar</button>}
          {row.status !== "hecha" && <button className="ghost-button" disabled={busy} onClick={() => onReview("hecha")}>Hecha</button>}
          {row.status !== "descartada" && <button className="ghost-button danger" disabled={busy} onClick={() => onReview("descartada")}><X size={14} /> Descartar</button>}
          {row.status !== "nueva" && <button className="ghost-button" disabled={busy} onClick={() => onReview("nueva")} title="Volver a nueva"><RotateCcw size={14} /></button>}
        </div>
      )}
    </article>
  );
}
