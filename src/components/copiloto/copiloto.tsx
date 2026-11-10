"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, ArrowRight, Check, CircleAlert, CircleCheck, Flag, FlaskConical, LayoutGrid, Loader2, Send, ShieldAlert, MessagesSquare, X } from "lucide-react";
import { ChartCard } from "@/components/charts/charts";
import Decimal from "decimal.js";
import { decimalText, euros, parseDecimal } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { cleanTranscript, FEEDBACK_CATEGORIES, transcriptSlice, type FeedbackCategory, type TranscriptEntry } from "@/lib/copilot-feedback";
import type { ActionsEvent, AppRoute, ChartSpec, ClarifyEvent, Decision, DecisionEvent, DoneEvent, Draft, DraftCheck, ErrorEvent, NavigateEvent, ResolvedEvent, TableEvent } from "@/copiloto/contract";
import type { ConfirmResponse } from "@/copiloto/drafts/confirm";
import type { Suggestion } from "@/copiloto/suggestions/engine";
import { QuickActions } from "./quick-actions";
import "./copiloto.css";

type Item =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "assistant";
      text: string;
      pending: boolean;
      decision?: DecisionEvent;
      navigate?: NavigateEvent;
      clarify?: ClarifyEvent;
      draft?: Draft;
      /** El borrador se confirmó o descartó después, desde el chat. */
      resolved?: ResolvedEvent;
      charts?: ChartSpec[];
      table?: TableEvent;
      actions?: ActionsEvent["actions"];
      error?: string;
    };

type AssistantItem = Extract<Item, { role: "assistant" }>;

const ROUTE_LABELS: Record<AppRoute, string> = {
  "/": "Panel",
  "/productos": "Productos",
  "/stock": "Stock",
  "/pedidos": "Pedidos",
  "/recepciones": "Recepciones",
  "/traspasos": "Traspasos",
  "/inventarios": "Inventarios",
  "/mermas": "Mermas",
  "/informes": "Informes",
  "/almacen": "Almacén",
  "/proveedores": "Proveedores",
  "/escandallos": "Escandallos",
  "/facturas": "Facturas",
  "/equipo": "Equipo",
  "/zonas": "Zonas",
};

const EXAMPLES = [
  "¿Qué me falta para el finde?",
  "Prepara el pedido de la semana",
  "¿Qué pedidos tengo pendientes?",
  "¿Qué facturas vencen esta semana?",
  "¿Qué platos llevan gluten?",
  "El Barceló ahora cuesta 15 €",
];

const DECIMAL = /^\d+([.,]\d+)?$/;
/** Ediciones numéricas: se normalizan a "12.5". El resto (nombre, medida) va tal cual. */
const NUMERIC_PATH = /^(qtyBase|newPrice|price|packQtyBase|newValue|lines\.\d+\.(packPrice|qtyBase|packsQty)|orders\.\d+\.lines\.\d+\.packsQty)$/;

const DIMENSION_LABEL = { volume: "Volumen (ml)", mass: "Peso (g)", count: "Unidades" } as const;

function currentRoute(pathname: string | null): AppRoute {
  const route = (Object.keys(ROUTE_LABELS) as AppRoute[]).find((r) => r !== "/" && pathname?.startsWith(r));
  return route ?? "/";
}

/** Ruta de la app con los filtros que entienden las páginas (?local=, ?producto=, ?estado=). */
function hrefFor(nav: NavigateEvent): string {
  const params = new URLSearchParams();
  if (nav.filters.locationId) params.set("local", nav.filters.locationId);
  if (nav.filters.productId) params.set("producto", nav.filters.productId);
  if (nav.filters.status) params.set("estado", nav.filters.status);
  if (nav.filters.view) params.set("vista", nav.filters.view);
  if (nav.filters.days) params.set("dias", String(nav.filters.days));
  const query = params.toString();
  return query ? `${nav.route}?${query}` : nav.route;
}

function confidence(d: Decision): string {
  return `${Math.round((d.confidence ?? d.probability) * 100)} %`;
}

const EMPTY_VALUES = new Set(["no_indicado", "ninguno", "ninguna", "no_aplica"]);

/** Lo que el asistente ha entendido, en una línea: «Traspaso · Parador → Vivero · Larios 12 · 3 botellas». */
function understood(ev: DecisionEvent): Array<{ key: string; text: string; doubtful: boolean }> {
  const all = [ev.intent, ...ev.decisions];
  const by = (id: string) => all.find((d) => d.id === id);
  // «Sin indicar», «Ninguno», «No aplica» no dicen nada: fuera.
  const part = (d: Decision | undefined, text?: string) => (d && !EMPTY_VALUES.has(d.value) ? [{ key: d.id, text: text ?? d.valueLabel, doubtful: d.gate !== "actuar" }] : []);
  const what = by("tipo_accion") ?? by("herramienta") ?? ev.intent;
  const from = by("local");
  const to = by("local_destino");
  const places = from && to && !EMPTY_VALUES.has(from.value) && !EMPTY_VALUES.has(to.value) ? [{ key: "locales", text: `${from.valueLabel} → ${to.valueLabel}`, doubtful: from.gate !== "actuar" || to.gate !== "actuar" }] : [...part(from), ...part(to)];
  const products = all.filter((d) => /^producto_\d+$/.test(d.id) || /^cantidad_ok_\d+$/.test(d.id));
  return [...part(what), ...places, ...part(by("espacio")), ...products.flatMap((d) => part(d)), ...part(by("periodo"))];
}

/** Cantidad tal como se escribió: «2 × Botella 70 cl», «6 ud». */
function inputText(input: { amount: string; unit: string; packId?: string }): string {
  return input.packId ? `${decimalText(input.amount, 4)} × ${input.unit}` : `${decimalText(input.amount, 4)} ${input.unit}`;
}

/** Ediciones en el formato escrito (botellas, cajas…) → unidad base, con el mismo factor del borrador. */
function toBaseEdit(text: string, base: string, amount: string): string {
  const value = parseDecimal(text);
  return value ? value.mul(new Decimal(base).div(amount)).toString() : text;
}

function newId(): string {
  return crypto.randomUUID();
}

/** Un mensaje del chat tal como se adjunta a un reporte: el texto y, en una línea, lo que lo acompañaba. */
function toEntry(item: Item, flagged: boolean): TranscriptEntry {
  if (item.role === "user") return { role: "user", text: item.text, ...(flagged ? { flagged } : {}) };
  const detail = [
    item.draft && `Borrador: ${item.draft.title}`,
    item.resolved && `Borrador ${item.resolved.status}`,
    item.clarify && item.clarify.options.length > 0 && `Opciones: ${item.clarify.options.map((o) => o.label).join(" / ")}`,
    item.table && `Tabla: ${item.table.columns.map((c) => c.label).join(", ")} · ${item.table.rows.length} filas`,
    item.charts?.length && `${item.charts.length} gráfico(s)`,
    item.actions?.length && `Botones: ${item.actions.map((a) => a.label).join(" / ")}`,
    item.navigate && `Enlace a ${ROUTE_LABELS[item.navigate.route]}`,
    item.error && `Error: ${item.error}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return { role: "assistant", text: item.text, ...(detail ? { detail } : {}), ...(flagged ? { flagged } : {}) };
}

/** `initial`: se acaba de cargar porque se pidió abrir (botón, Ctrl+K o una pregunta desde otra pantalla). */
export function Copiloto({ initial }: { initial?: { message?: string } } = {}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [pendingClarify, setPendingClarify] = useState<ClarifyEvent | null>(null);
  const [functionsOpen, setFunctionsOpen] = useState(false);
  // Modo pruebas (0025): lo que se confirme no se guarda. Se lee al abrir el panel por primera vez.
  const [testMode, setTestMode] = useState(false);
  const testModeLoaded = useRef(false);
  /** Reporte abierto: sobre un mensaje (su índice) o sobre toda la conversación (null). */
  const [reportFor, setReportFor] = useState<{ index: number | null } | null>(null);
  const [reported, setReported] = useState<Set<string>>(new Set());
  const sessionId = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadSuggestions = useCallback(async () => {
    try {
      const res = await fetch("/api/copiloto/suggestions?limit=5");
      if (!res.ok) return setSuggestions([]);
      const data = (await res.json()) as { items: Suggestion[] };
      setSuggestions(data.items);
    } catch {
      setSuggestions([]);
    }
  }, []);

  const loadTestMode = useCallback(async () => {
    if (testModeLoaded.current) return;
    testModeLoaded.current = true;
    const supabase = createClient();
    const userId = (await supabase?.auth.getSession())?.data.session?.user.id;
    if (!supabase || !userId) return;
    const { data } = await supabase.from("memberships").select("assistant_test").eq("user_id", userId).limit(1).maybeSingle();
    setTestMode(data?.assistant_test === true);
  }, []);

  const toggle = useCallback(() => {
    setOpen((was) => {
      if (!was && suggestions === null) void loadSuggestions();
      if (!was) void loadTestMode();
      return !was;
    });
  }, [loadSuggestions, loadTestMode, suggestions]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        toggle();
      } else if (event.key === "Escape") {
        // Primero se cierra el menú de funciones; después, el panel.
        setFunctionsOpen((was) => {
          if (!was) setOpen(false);
          return false;
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [items]);

  function update(id: string, patch: (item: AssistantItem) => Partial<AssistantItem>) {
    setItems((prev) => prev.map((item) => (item.id === id && item.role === "assistant" ? { ...item, ...patch(item) } : item)));
  }

  /** `display`: lo que se enseña como mensaje del usuario (el menú de funciones manda un atajo). */
  async function send(message: string, clarification?: { clarifyId: string; optionId: string; freeText?: string; field?: string }, followUpId?: string, display?: string) {
    if (busy || !message.trim()) return;
    sessionId.current ??= newId();
    const assistantId = newId();
    setBusy(true);
    setPendingClarify(null);
    setItems((prev) => [...prev, { id: newId(), role: "user", text: display ?? message }, { id: assistantId, role: "assistant", text: "", pending: true }]);

    try {
      const res = await fetch("/api/copiloto/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId.current, message, page: currentRoute(pathname), ...(clarification ? { clarification } : {}), ...(followUpId ? { followUpId } : {}) }),
      });
      if (!res.ok || !res.body) {
        const error = (await res.json().catch(() => null)) as ErrorEvent | null;
        update(assistantId, () => ({ pending: false, error: error?.message ?? "El asistente no está disponible ahora." }));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut = buffer.indexOf("\n\n");
        while (cut >= 0) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          cut = buffer.indexOf("\n\n");
          const event = /^event: (.*)$/m.exec(block)?.[1];
          const raw = /^data: (.*)$/m.exec(block)?.[1];
          if (!event || !raw) continue;
          if (event === "done" || event === "error") finished = true;
          const data: unknown = JSON.parse(raw);
          if (event === "decision") update(assistantId, () => ({ decision: data as DecisionEvent }));
          else if (event === "text") {
            const t = data as { delta: string; reset?: boolean };
            update(assistantId, (item) => ({ text: (t.reset ? "" : item.text) + t.delta }));
          } else if (event === "navigate") {
            // El asistente nunca cambia de pantalla solo: deja un enlace.
            update(assistantId, () => ({ navigate: data as NavigateEvent }));
          } else if (event === "clarify") {
            setPendingClarify(data as ClarifyEvent);
            update(assistantId, () => ({ clarify: data as ClarifyEvent }));
          } else if (event === "draft") update(assistantId, () => ({ draft: data as Draft }));
          else if (event === "resolved") {
            const r = data as ResolvedEvent;
            setItems((prev) => prev.map((item) => (item.role === "assistant" && item.draft?.draftId === r.draftId ? { ...item, resolved: r } : item)));
          } else if (event === "chart") update(assistantId, (item) => ({ charts: [...(item.charts ?? []), data as ChartSpec] }));
          else if (event === "table") update(assistantId, () => ({ table: data as TableEvent }));
          else if (event === "actions") update(assistantId, () => ({ actions: (data as ActionsEvent).actions }));
          else if (event === "error") update(assistantId, () => ({ error: (data as ErrorEvent).message }));
          else if (event === "done") update(assistantId, () => ({ text: (data as DoneEvent).text, pending: false }));
        }
      }
      // La conexión se cerró sin respuesta final (despliegue, tiempo agotado…): mejor decirlo que dejar la burbuja vacía.
      if (!finished) update(assistantId, (item) => (item.text || item.draft || item.clarify ? {} : { error: "El asistente no ha terminado de responder. Inténtalo de nuevo." }));
    } catch {
      update(assistantId, () => ({ error: "Se ha perdido la conexión con el asistente." }));
    } finally {
      update(assistantId, () => ({ pending: false }));
      setBusy(false);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    // Texto libre como respuesta a una aclaración abierta.
    if (pendingClarify) void send(text, { clarifyId: pendingClarify.clarifyId, optionId: "otra", freeText: text, field: pendingClarify.field });
    else void send(text);
  }

  // Otras pantallas (p. ej. /informes) pueden abrir el asistente con una pregunta.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  useEffect(() => {
    function onAsk(event: Event) {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message;
      setOpen(true);
      void loadTestMode();
      if (message) void sendRef.current(message);
    }
    window.addEventListener("copiloto:ask", onAsk);
    return () => window.removeEventListener("copiloto:ask", onAsk);
  }, [loadTestMode]);

  // Cargado al pedir abrirlo: se abre ya (y envía la pregunta, si la había).
  const started = useRef(false);
  useEffect(() => {
    if (!initial || started.current) return;
    const id = window.setTimeout(() => {
      // La marca va aquí: en desarrollo React monta dos veces y la primera cancela este temporizador.
      started.current = true;
      setOpen(true);
      void loadSuggestions();
      void loadTestMode();
      if (initial.message) void sendRef.current(initial.message);
    }, 0);
    return () => window.clearTimeout(id);
  }, [initial, loadSuggestions, loadTestMode]);

  // Acceso y pantalla del almacén: sin asistente (la pantalla de un almacén no puede usarlo).
  if (pathname?.startsWith("/login") || pathname?.startsWith("/almacen")) return null;

  return (
    <>
      <button type="button" className="copiloto-launcher" onClick={toggle} aria-label="Abrir asistente (Ctrl+K)">
        <MessagesSquare size={18} />
        <span>Asistente</span>
        <kbd>Ctrl K</kbd>
      </button>

      {open && (
        <div className="copiloto-overlay" onClick={() => setOpen(false)}>
          <aside className="copiloto-panel" role="dialog" aria-label="Asistente de inventario" onClick={(event) => event.stopPropagation()}>
            <header className="copiloto-header">
              <div className="copiloto-title">
                <span className="copiloto-mark"><MessagesSquare size={15} /></span>
                <div>
                  <strong>Asistente</strong>
                  <small>Consulta tus datos y prepara operaciones</small>
                </div>
              </div>
              <div className="copiloto-header-actions">
                {items.length > 0 && (
                  <button type="button" className="copiloto-report-all" onClick={() => setReportFor({ index: null })} title="Reportar algo de toda la conversación">
                    <Flag size={14} /> Reportar
                  </button>
                )}
                <button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="Cerrar">
                  <X size={17} />
                </button>
              </div>
            </header>
            {testMode && (
              <p className="copiloto-testmode">
                <FlaskConical size={14} /> <span><b>Modo pruebas:</b> lo que confirmes aquí no se guarda. Si algo está mal o falta, pulsa «Reportar».</span>
              </p>
            )}

            <div className="copiloto-list" ref={listRef}>
              {items.length === 0 && (
                <div className="copiloto-empty">
                  <p className="copiloto-section">Ahora mismo</p>
                  {suggestions === null && <p className="copiloto-muted"><Loader2 size={14} className="copiloto-spin" /> Buscando qué revisar…</p>}
                  {suggestions?.length === 0 && <p className="copiloto-muted">Nada urgente que revisar.</p>}
                  {suggestions?.map((s) => (
                    <button
                      type="button"
                      key={s.id}
                      className={`copiloto-suggestion ${s.urgency}`}
                      onClick={() => s.action && window.location.assign(hrefFor(s.action))}
                    >
                      <i />
                      <span>{s.text}</span>
                      {s.action && <ArrowRight size={14} />}
                    </button>
                  ))}
                  <p className="copiloto-section">Prueba con</p>
                  <div className="copiloto-examples">
                    {EXAMPLES.map((example) => (
                      <button type="button" key={example} onClick={() => void send(example)}>{example}</button>
                    ))}
                  </div>
                </div>
              )}

              {items.map((item) =>
                item.role === "user" ? (
                  <div key={item.id} className="copiloto-msg user"><p>{item.text}</p></div>
                ) : (
                  <div key={item.id} className="copiloto-msg assistant">
                    {item.decision && <Understood decision={item.decision} asking={!!item.clarify} />}
                    {item.pending && !item.text && <p className="copiloto-muted"><Loader2 size={14} className="copiloto-spin" /> Pensando…</p>}
                    {/* Con borrador, la tarjeta ya lo dice todo: sin texto que la repita. */}
                    {item.text && !(item.draft && !item.error) && <AssistantText text={item.text} />}
                    {item.error && <p className="copiloto-error"><AlertTriangle size={14} /> {item.error}</p>}
                    {item.clarify && item.clarify.options.length > 0 && (
                      <div className="copiloto-options">
                        {item.clarify.options.map((option) => (
                          <button
                            type="button"
                            key={option.id}
                            disabled={busy || pendingClarify?.clarifyId !== item.clarify?.clarifyId}
                            onClick={() => item.clarify && void send(option.label, { clarifyId: item.clarify.clarifyId, optionId: option.id })}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {item.table && <TableCard table={item.table} />}
                    {item.charts?.map((chart) => <ChartCard key={chart.id} spec={chart} compact />)}
                    {item.draft && <DraftCard draft={item.draft} resolved={item.resolved} />}
                    {item.actions && item.actions.length > 0 && (
                      <div className="copiloto-actions">
                        {item.actions.map((a) => (
                          <button type="button" key={a.id} disabled={busy} onClick={() => void send(a.label, undefined, a.id)}>
                            {a.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {item.navigate && (
                      <a className="copiloto-link" href={hrefFor(item.navigate)}>
                        Ver en {ROUTE_LABELS[item.navigate.route]} <ArrowRight size={13} />
                      </a>
                    )}
                    {!item.pending && (
                      <button
                        type="button"
                        className={`copiloto-report-link${reported.has(item.id) ? " done" : ""}`}
                        onClick={() => setReportFor({ index: items.findIndex((i) => i.id === item.id) })}
                        title="¿Algo mal o mejorable en esta respuesta?"
                      >
                        {reported.has(item.id) ? <><Check size={12} /> Reportado</> : <><Flag size={12} /> Reportar</>}
                      </button>
                    )}
                  </div>
                ),
              )}
            </div>

            {functionsOpen && (
              <QuickActions
                disabled={busy}
                onClose={() => setFunctionsOpen(false)}
                onRun={(message, display) => {
                  setFunctionsOpen(false);
                  void send(message, undefined, undefined, display);
                }}
              />
            )}

            <form className="copiloto-input" onSubmit={submit}>
              <button
                type="button"
                className={`copiloto-functions-toggle${functionsOpen ? " active" : ""}`}
                onClick={() => setFunctionsOpen((was) => !was)}
                aria-expanded={functionsOpen}
                aria-label="Funciones"
                title="Funciones (o escribe /)"
              >
                <LayoutGrid size={16} />
              </button>
              <input
                ref={inputRef}
                value={input}
                onChange={(event) => {
                  // «/» en el campo vacío abre el menú de funciones.
                  if (event.target.value === "/" && !input) {
                    setFunctionsOpen(true);
                    return;
                  }
                  setInput(event.target.value);
                }}
                placeholder={pendingClarify ? "Responde o escribe otra cosa…" : "Pregunta o pide una operación…"}
                maxLength={1000}
              />
              <button type="submit" className="primary-button" disabled={busy || !input.trim()} aria-label="Enviar">
                {busy ? <Loader2 size={16} className="copiloto-spin" /> : <Send size={16} />}
              </button>
            </form>

            {reportFor && (
              <ReportForm
                items={items}
                index={reportFor.index}
                sessionId={sessionId.current}
                page={pathname}
                onClose={() => setReportFor(null)}
                onSent={() => {
                  const target = reportFor.index === null ? null : items[reportFor.index];
                  if (target) setReported((prev) => new Set(prev).add(target.id));
                }}
              />
            )}
          </aside>
        </div>
      )}
    </>
  );
}

function DraftCard({ draft, resolved }: { draft: Draft; resolved?: ResolvedEvent }) {
  const [edits, setEdits] = useState<Record<string, string | boolean>>({});
  const [key, setKey] = useState(() => newId());
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [result, setResult] = useState<ConfirmResponse | null>(null);
  const [invalid, setInvalid] = useState("");

  function edit(path: string, value: string | boolean) {
    setEdits((prev) => ({ ...prev, [path]: value }));
  }

  async function confirm() {
    const normalized: Record<string, string | boolean> = {};
    for (const [path, value] of Object.entries(edits)) {
      if (typeof value === "string" && NUMERIC_PATH.test(path)) {
        const clean = value.trim().replace(",", ".");
        if (!DECIMAL.test(clean)) {
          setInvalid("Revisa las cifras: usa números como 12,50.");
          return;
        }
        normalized[path] = clean;
      } else normalized[path] = typeof value === "string" ? value.trim() : value;
    }
    setInvalid("");
    setState("sending");
    try {
      const res = await fetch("/api/copiloto/actions/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: draft.draftId, idempotencyKey: key, edits: normalized }),
      });
      const data = (await res.json()) as ConfirmResponse;
      setResult(data);
      setState(data.ok ? "done" : "idle");
      // Tras un fallo, un nuevo clic es un intento nuevo.
      if (!data.ok) setKey(newId());
    } catch {
      setResult({ ok: false, code: "internal", message: "No se ha podido confirmar. Inténtalo de nuevo." });
      setState("idle");
      setKey(newId());
    }
  }

  const locked = state !== "idle" || !!resolved;
  const needsAck = draft.checks?.some((c) => c.status === "revisar") ?? false;
  const acknowledged = edits.acknowledged === true;

  return (
    <div className={`copiloto-draft${needsAck ? " needs-review" : ""}`}>
      <strong>{draft.title}</strong>
      {draft.checks && draft.checks.length > 0 && <Checks checks={draft.checks} />}
      {draft.warnings.map((warning) => (
        <p key={warning} className="copiloto-warning"><AlertTriangle size={13} /> {warning}</p>
      ))}

      {draft.kind === "precio" && (
        <>
          <p className="copiloto-detail">
            {draft.packName} · {draft.supplierName}
            <br />
            Antes: <b>{draft.oldPrice === null ? "—" : euros(draft.oldPrice)}</b> · coste unitario nuevo: {draft.unitCost}
          </p>
          <label className="copiloto-field">
            Precio nuevo por {draft.packName} (€)
            <input defaultValue={draft.newPrice.replace(".", ",")} disabled={locked} inputMode="decimal" onChange={(event) => edit("newPrice", event.target.value)} />
          </label>
        </>
      )}

      {draft.kind === "producto_nuevo" && (
        <>
          <label className="copiloto-field">
            Nombre
            <input defaultValue={draft.name} disabled={locked} maxLength={80} onChange={(event) => edit("name", event.target.value)} />
          </label>
          <div className="copiloto-row">
            <label className="copiloto-field">
              Cómo se mide
              <select defaultValue={draft.dimension} disabled={locked} onChange={(event) => edit("dimension", event.target.value)}>
                {(Object.keys(DIMENSION_LABEL) as Array<keyof typeof DIMENSION_LABEL>).map((d) => (
                  <option key={d} value={d}>{DIMENSION_LABEL[d]}</option>
                ))}
              </select>
            </label>
            {draft.price !== null && (
              <label className="copiloto-field">
                Precio (€)
                <input defaultValue={draft.price.replace(".", ",")} disabled={locked} inputMode="decimal" onChange={(event) => edit("price", event.target.value)} />
              </label>
            )}
          </div>
          <p className="copiloto-detail">
            Categoría: <b>{draft.categoryName ?? "sin categoría"}</b>
            {draft.packName && <> · Formato: <b>{draft.packName}</b></>}
            {draft.supplierName && <> · Proveedor: <b>{draft.supplierName}</b></>}
            {draft.locationNames.length > 0 && <> · Activo en: <b>{draft.locationNames.join(", ")}</b></>}
          </p>
        </>
      )}

      {draft.kind === "minimo" && (
        <label className="copiloto-field">
          {draft.field === "min_qty" ? "Mínimo" : "Objetivo"} en {draft.locationName} ({draft.input?.unit ?? draft.baseUnit}) · antes:{" "}
          {draft.oldValue === null ? "sin definir" : draft.input ? decimalText(new Decimal(draft.oldValue).div(new Decimal(draft.newValue).div(draft.input.amount)), 2) : draft.oldValue}
          <input
            defaultValue={draft.input ? decimalText(draft.input.amount, 4) : draft.newValue}
            disabled={locked}
            inputMode="decimal"
            onChange={(event) => edit("newValue", draft.input ? toBaseEdit(event.target.value, draft.newValue, draft.input.amount) : event.target.value)}
          />
        </label>
      )}

      {draft.kind === "pedido" &&
        draft.orders.map((order, o) => (
          <div className="copiloto-order" key={order.supplierName}>
            <p className="copiloto-order-supplier">{order.supplierName}</p>
            {order.lines.map((line, l) => (
              <label className="copiloto-order-line" key={`${line.productName}-${line.packName}`}>
                <span>
                  <b>{line.productName}</b>
                  <small>{line.packName}{line.packPrice ? ` · ${euros(line.packPrice)}` : ""} · {line.note}</small>
                </span>
                <input
                  defaultValue={line.packsQty}
                  disabled={locked}
                  inputMode="decimal"
                  aria-label={`Cantidad de ${line.productName}`}
                  onChange={(event) => edit(`orders.${o}.lines.${l}.packsQty`, event.target.value)}
                />
              </label>
            ))}
          </div>
        ))}
      {draft.kind === "pedido" && <p className="copiloto-detail">Se guardan como borrador en Pedidos (pon 0 para quitar una línea). Enviarlos al proveedor lo decides allí.</p>}

      {draft.kind === "conteo" && draft.operation === "anotar" && (
        <ul className="copiloto-lines">
          {draft.lines.map((line) => (
            <li key={line.productName}>{line.productName}: {line.text}</li>
          ))}
        </ul>
      )}

      {draft.kind === "documento" && (
        <>
          <p className="copiloto-detail">{draft.summary}</p>
          {draft.lines.length > 0 && (
            <ul className="copiloto-lines">
              {draft.lines.map((line, i) => (
                <li key={`${line.label}-${i}`}>{line.label}: {line.qty}</li>
              ))}
            </ul>
          )}
        </>
      )}

      {draft.kind === "archivar" && (
        <p className="copiloto-detail">Dejará de aparecer en recepciones, traspasos, mermas e inventarios. Conserva su historial y puedes restaurarlo desde su ficha.</p>
      )}

      {draft.kind === "merma" && draft.editable.includes("qtyBase") && (
        <label className="copiloto-field">
          Cantidad ({draft.input.unit})
          <input
            defaultValue={decimalText(draft.input.amount, 4)}
            disabled={locked}
            inputMode="decimal"
            onChange={(event) => edit("qtyBase", toBaseEdit(event.target.value, draft.qtyBase, draft.input.amount))}
          />
        </label>
      )}

      {draft.kind === "traspaso" && (
        <>
          <ul className="copiloto-lines">
            {draft.lines.map((line) => (
              <li key={line.productName}>{line.productName}: {inputText(line.input)}</li>
            ))}
          </ul>
          {draft.send && (
            <label className="copiloto-check">
              <input type="checkbox" defaultChecked disabled={locked} onChange={(event) => edit("send", event.target.checked)} /> Enviar ahora (si no, queda en borrador)
            </label>
          )}
        </>
      )}

      {draft.kind === "recepcion" &&
        draft.lines.map((line, index) => (
          <label key={`${line.packName}-${line.productName}`} className="copiloto-field">
            {line.packsQty} × {line.packName} · precio por formato (€)
            <input
              defaultValue={line.packPrice ?? ""}
              placeholder="Precio"
              disabled={locked}
              inputMode="decimal"
              onChange={(event) => edit(`lines.${index}.packPrice`, event.target.value)}
            />
          </label>
        ))}

      {draft.kind === "cierre_inventario" && (
        <>
          <ul className="copiloto-lines">
            {draft.preview.adjustments.map((a) => (
              <li key={a.productName}>
                {a.productName}: {a.expectedText ?? `${a.expected} ${a.baseUnit}`} → {a.countedText ?? `${a.counted} ${a.baseUnit}`} ({euros(a.diffValue)})
              </li>
            ))}
          </ul>
          <label className="copiloto-check">
            <input type="checkbox" disabled={locked} onChange={(event) => edit("zeroUncounted", event.target.checked)} /> Poner a cero lo no contado
          </label>
          <label className="copiloto-check">
            <input type="checkbox" defaultChecked={draft.asConsumption} disabled={locked} onChange={(event) => edit("asConsumption", event.target.checked)} /> Lo que falta es consumo (no un ajuste)
          </label>
        </>
      )}

      {needsAck && state !== "done" && (
        <label className="copiloto-check copiloto-ack">
          <input type="checkbox" checked={acknowledged} disabled={locked} onChange={(event) => edit("acknowledged", event.target.checked)} /> He revisado los avisos marcados
        </label>
      )}

      <div className="copiloto-draft-actions">
        <span />
        {resolved ? (
          <span className={resolved.status === "confirmado" ? "copiloto-ok" : "copiloto-muted"}>
            {resolved.status === "confirmado" ? <><Check size={14} /> Confirmado desde el chat</> : "Descartado"}
          </span>
        ) : state === "done" ? (
          <span className="copiloto-ok"><Check size={14} /> Hecho</span>
        ) : (
          <button type="button" className="primary-button" disabled={!draft.canConfirm || locked || (needsAck && !acknowledged)} onClick={() => void confirm()}>
            {state === "sending" ? <Loader2 size={14} className="copiloto-spin" /> : <Check size={14} />}
            {draft.canConfirm ? "Confirmar" : "Requiere encargado"}
          </button>
        )}
      </div>
      {invalid && <p className="copiloto-error">{invalid}</p>}
      {result && (
        <p className={result.ok ? "copiloto-ok" : "copiloto-error"}>
          {result.message}{" "}
          {result.ok && result.navigate && <a href={hrefFor(result.navigate)}>Ver en {ROUTE_LABELS[result.navigate.route]}</a>}
        </p>
      )}
    </div>
  );
}

const CHECK_ICON = { ok: CircleCheck, aviso: CircleAlert, revisar: ShieldAlert } as const;

/** Comprobaciones del borrador: qué ha verificado el asistente y con qué resultado. */
function Checks({ checks }: { checks: DraftCheck[] }) {
  return (
    <ul className="copiloto-checks" aria-label="Comprobaciones">
      {checks.map((c) => {
        const Icon = CHECK_ICON[c.status];
        return (
          <li key={c.id} className={c.status}>
            <Icon size={14} />
            <span>
              <b>{c.label}:</b> {c.detail}
            </span>
            {c.probability !== null && <small title="Seguridad de Jev">{Math.round(c.probability * 100)} %</small>}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * «Entendido: …» solo cuando el asistente pregunta (así se ve qué entendió y qué falta). En el resto,
 * la respuesta ya lo dice: queda un «¿Por qué?» discreto con el detalle.
 */
function Understood({ decision, asking }: { decision: DecisionEvent; asking: boolean }) {
  const [open, setOpen] = useState(false);
  const parts = understood(decision);
  const quiet = decision.intent.value === "conversar" || decision.intent.value === "fuera_de_ambito" || decision.shortcut;
  if (quiet || parts.length === 0) return null;
  return (
    <div className={`copiloto-understood${asking ? "" : " compact"}`}>
      <p>
        {asking && (
          <>
            <span className="copiloto-understood-label">Entendido:</span>{" "}
            {parts.map((p, i) => (
              <span key={p.key}>
                {i > 0 && " · "}
                <span className={p.doubtful ? "dudoso" : undefined} title={p.doubtful ? "No estoy seguro: revísalo" : undefined}>{p.text}</span>
              </span>
            ))}
          </>
        )}
        {!decision.shortcut && (
          <button type="button" className="copiloto-why" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "Ocultar" : "¿Por qué?"}
          </button>
        )}
      </p>
      {open && (
        <div className="copiloto-chips">
          {[decision.intent, ...decision.decisions].map((d) => (
            <span key={d.id} className={`copiloto-chip ${d.gate}`} title={`${d.label}: ${d.valueLabel}`}>
              {d.label}: <b>{d.valueLabel}</b> {confidence(d)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function TableCard({ table }: { table: TableEvent }) {
  const flagged = new Set(table.flagged ?? []);
  // La fila se nombra por su primera columna con texto («#» es solo la posición en un ranking).
  const titleIndex = table.columns[0]?.label === "#" && table.columns.length > 1 ? 1 : 0;
  return (
    // Con más de 3 columnas, en el panel estrecho cada fila se ve como una ficha (CSS: container query).
    <div className={`copiloto-table${table.columns.length > 3 ? " cards" : ""}`}>
      <table>
        <thead>
          <tr>
            {table.columns.map((c) => (
              <th key={c.key} className={c.align === "right" ? "num" : undefined}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i} className={flagged.has(i) ? "flagged" : undefined}>
              {table.columns.map((c, j) => (
                <td key={c.key} className={[c.align === "right" ? "num" : "", j === titleIndex ? "title" : "", j < titleIndex ? "rank" : "", j !== titleIndex && (row[c.key] ?? "").length <= 14 ? "short" : ""].filter(Boolean).join(" ") || undefined} data-label={c.label}>
                  {row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.more ? <p className="copiloto-table-more">…y {table.more} más en la pantalla enlazada.</p> : null}
    </div>
  );
}

const CONTEXT_OPTIONS = [
  { value: "2", label: "Esta respuesta y lo que le pedí" },
  { value: "6", label: "Los últimos 3 intercambios" },
  { value: "all", label: "Toda la conversación" },
] as const;

/**
 * Reporte sobre una respuesta (o sobre toda la conversación): qué está mal o qué cambiaría y, si quiere,
 * qué esperaba. Se adjunta la conversación para entenderlo después sin tener que preguntar.
 */
function ReportForm({
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

/** Datos de ficha («Precio: …», «Stock: …»): se pintan como pares etiqueta–valor. */
const FACT = /^(Precio|Stock|Consumo(?: \d+ días)?|Formatos|Compra|Proveedor(?:es)?|Mínimo|Valor|Categoría):\s+(.+)$/;

/**
 * Texto del asistente con algo de estructura: las líneas «Etiqueta: valor» de una ficha como tabla de
 * datos (con la primera línea de título), los avisos «⚠ …» resaltados y las viñetas como lista.
 */
function AssistantText({ text }: { text: string }) {
  const lines = text.split("\n");
  if (!lines.some((l) => FACT.test(l) || l.startsWith("⚠ ") || l.startsWith("• "))) return <p className="copiloto-text">{text}</p>;
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]!;
    if (FACT.test(line)) {
      const facts: Array<[string, string]> = [];
      while (i < lines.length && FACT.test(lines[i]!)) {
        const m = FACT.exec(lines[i]!)!;
        facts.push([m[1]!, m[2]!]);
        i += 1;
      }
      blocks.push(
        <dl key={i} className="copiloto-facts">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>,
      );
    } else if (line.startsWith("• ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("• ")) {
        items.push(lines[i]!.slice(2));
        i += 1;
      }
      blocks.push(
        <ul key={i} className="copiloto-bullets">
          {items.map((item, k) => <li key={k}>{item}</li>)}
        </ul>,
      );
    } else {
      // La primera línea encima de una ficha es su título («Bombay Sapphire · Destilados › Ginebra»).
      const heading = i === 0 && FACT.test(lines[1] ?? "");
      blocks.push(
        <p key={i} className={line.startsWith("⚠ ") ? "copiloto-alert" : heading ? "copiloto-heading" : undefined}>
          {line}
        </p>,
      );
      i += 1;
    }
  }
  return <div className="copiloto-text structured">{blocks}</div>;
}
