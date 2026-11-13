"use client";

// Panel del asistente: conversación, envío de mensajes (texto, comandos, fotos, voz) y respuestas en
// streaming. Las piezas viven al lado: chat-model (mensajes), assistant-home (inicio y comandos),
// message-parts (texto, tablas), draft-card (borradores), report-form (reportes), quick-actions (funciones).
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Camera, Check, Flag, FlaskConical, ImageUp, LayoutGrid, Loader2, Mic, MicOff, MessagesSquare, RotateCcw, Send, X } from "lucide-react";
import { ChartCard } from "@/components/charts/charts";
import { createClient } from "@/lib/supabase/client";
import { setPendingFile } from "@/lib/pending-file";
import type { ActionsEvent, ChartSpec, ClarifyEvent, DecisionEvent, DoneEvent, Draft, ErrorEvent, FormEvent as AssistantForm, NavigateEvent, ResolvedEvent, TableEvent } from "@/copiloto/contract";
import type { Suggestion } from "@/copiloto/suggestions/engine";
import { QuickActions } from "./quick-actions";
import { CommandPalette, HelpCard, localCommandOf, matchCommands, Welcome, type Command, type LocalCommand } from "./assistant-home";
import { streamEvents } from "./chat-stream";
import { currentRoute, hrefFor, newId, ROUTE_LABELS, type AssistantItem, type Item } from "./chat-model";
import { DraftCard } from "./draft-card";
import { AssistantText, TableCard, Understood } from "./message-parts";
import { summarizeAlbaranPhoto } from "./photo";
import { ReportForm } from "./report-form";
import { fileKind, otherFileReply, useFileDrop } from "./use-file-drop";
import { FormCard, type FormValues } from "./form-card";
import { useVoice } from "./use-voice";
import "./copiloto.css";

/** `initial`: se acaba de cargar porque se pidió abrir (botón, Ctrl+K o una pregunta desde otra pantalla). */
export function Copiloto({ initial }: { initial?: { message?: string } } = {}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const photoInput = useRef<HTMLInputElement>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [pendingClarify, setPendingClarify] = useState<ClarifyEvent | null>(null);
  const [functionsOpen, setFunctionsOpen] = useState(false);
  // Modo pruebas (0025): lo que se confirme no se guarda. Se lee al abrir el panel por primera vez.
  const [testMode, setTestMode] = useState(false);
  const testModeLoaded = useRef(false);
  /** Reporte abierto: sobre un mensaje (su índice) o sobre toda la conversación (null). */
  const [reportFor, setReportFor] = useState<{ index: number | null; sessionId: string | null } | null>(null);
  const [reported, setReported] = useState<Set<string>>(new Set());
  const sessionId = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Comandos «/»: el resaltado de la lista (se mueve con ↑ ↓). Historial de lo escrito (↑ en el campo vacío).
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [paletteClosed, setPaletteClosed] = useState(false);
  const history = useRef<string[]>([]);
  const historyAt = useRef<number | null>(null);
  // Dictado por voz (si el navegador lo tiene): lo dicho se escribe en el campo para revisarlo y enviarlo.
  const voice = useVoice(setInput, () => inputRef.current?.focus());
  const listening = voice.listening;

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

  /**
   * Foto desde el chat: se lee aquí (en el navegador, sin subirla) y se resume. Registrar la recepción se
   * hace en Nueva recepción, con las mismas comprobaciones que a mano: nada se guarda sin revisar.
   */
  async function sendPhoto(file: File) {
    if (busy) return;
    const assistantId = newId();
    setBusy(true);
    setItems((prev) => [...prev, { id: newId(), role: "user", text: `Foto: ${file.name || "albarán"}` }, { id: assistantId, role: "assistant", text: "", pending: true }]);
    update(assistantId, () => ({ text: "Leyendo la foto… (la primera vez tarda un poco más)" }));
    try {
      const summary = await summarizeAlbaranPhoto(file);
      update(assistantId, () => ({ pending: false, text: summary.text, photo: { file, read: summary.read } }));
    } catch (err) {
      // Los fallos del navegador al abrir la imagen llegan en inglés («could not be decoded»): se dice en claro.
      const decode = err instanceof Error && /decod|load|image|canvas/i.test(err.message);
      const message = decode ? "No he podido abrir la imagen (¿está dañada o en un formato raro?). Prueba con otra foto o una captura en JPG o PNG." : "No se pudo leer la foto.";
      update(assistantId, () => ({ pending: false, error: message, photo: { file, read: false } }));
    } finally {
      setBusy(false);
    }
  }

  /** Archivo arrastrado, pegado o elegido: las fotos se leen; del resto se dice dónde va. */
  function handleFile(file: File) {
    const kind = fileKind(file);
    if (kind === "imagen") return void sendPhoto(file);
    setItems((prev) => [...prev, { id: newId(), role: "user", text: `Archivo: ${file.name}` }, { id: newId(), role: "assistant", text: otherFileReply(file, kind), pending: false, ...(kind === "pdf" ? { invoiceFile: file } : {}) }]);
  }
  const drop = useFileDrop(handleFile, !busy);

  /** El panel se cierra para dejar a la vista la pantalla (la conversación sigue al volver a abrirlo). */
  function openFileIn(target: "recepcion" | "factura", file: File) {
    setOpen(false);
    setPendingFile(target, file);
    const route = target === "recepcion" ? "/recepciones" : "/facturas";
    if (currentRoute(pathname) !== route) router.push(route);
  }

  /** `display`: lo que se enseña como mensaje del usuario (el menú de funciones manda un atajo). */
  async function send(message: string, clarification?: { clarifyId: string; optionId: string; freeText?: string; field?: string }, followUpId?: string, display?: string, form?: { accion: AssistantForm["accion"]; values: FormValues }) {
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
        body: JSON.stringify({ sessionId: sessionId.current, message, page: currentRoute(pathname), ...(clarification ? { clarification } : {}), ...(followUpId ? { followUpId } : {}), ...(form ? { form } : {}) }),
      });
      if (!res.ok || !res.body) {
        const error = (await res.json().catch(() => null)) as ErrorEvent | null;
        update(assistantId, () => ({ pending: false, error: error?.message ?? "El asistente no está disponible ahora." }));
        return;
      }
      let finished = false;
      for await (const { event, data } of streamEvents(res.body)) {
        if (event === "done" || event === "error") finished = true;
        if (event === "decision") update(assistantId, () => ({ decision: data as DecisionEvent }));
        else if (event === "text") {
          const t = data as { delta: string; reset?: boolean };
          update(assistantId, (item) => ({ text: (t.reset ? "" : item.text) + t.delta }));
        } else if (event === "navigate") {
          // Deja el enlace; si se pidió ir («llévame a…»), además abre la pantalla (el panel sigue abierto).
          const nav = data as NavigateEvent;
          update(assistantId, () => ({ navigate: nav }));
          if (nav.auto) router.push(hrefFor(nav));
        } else if (event === "form") {
          update(assistantId, () => ({ form: data as AssistantForm }));
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
      // La conexión se cerró sin respuesta final (despliegue, tiempo agotado…): mejor decirlo que dejar la burbuja vacía.
      if (!finished) update(assistantId, (item) => (item.text || item.draft || item.clarify ? {} : { error: "El asistente no ha terminado de responder. Inténtalo de nuevo." }));
    } catch {
      update(assistantId, () => ({ error: "Se ha perdido la conexión con el asistente." }));
    } finally {
      update(assistantId, () => ({ pending: false }));
      setBusy(false);
    }
  }

  /** Comandos que resuelve el panel sin ir al servidor. */
  function runLocal(command: LocalCommand) {
    setInput("");
    if (command === "nueva") {
      sessionId.current = null;
      setItems([]);
      setPendingClarify(null);
      void loadSuggestions();
      return;
    }
    if (command === "foto") return photoInput.current?.click();
    if (command === "funciones") return setFunctionsOpen(true);
    const said = command === "ayuda" ? "/ayuda" : "/avisos";
    if (command === "ayuda") {
      setItems((prev) => [...prev, { id: newId(), role: "user", text: said }, { id: newId(), role: "assistant", text: "Esto es lo que sé hacer. Toca un ejemplo para probarlo.", pending: false, help: true }]);
      return;
    }
    const list = suggestions ?? [];
    setItems((prev) => [
      ...prev,
      { id: newId(), role: "user", text: said },
      { id: newId(), role: "assistant", text: list.length ? `${list.length === 1 ? "Esto conviene revisarlo" : "Esto conviene revisarlo"} ahora:` : "Nada urgente que revisar ahora mismo.", pending: false, alerts: list },
    ]);
    if (suggestions === null) void loadSuggestions();
  }

  /** Enviar lo escrito, o lo de un ejemplo: los comandos del panel se resuelven aquí. */
  function ask(text: string) {
    const local = localCommandOf(text);
    if (local) return runLocal(local);
    void send(text);
  }

  function pickCommand(c: Command) {
    setPaletteIndex(0);
    if (c.local) return runLocal(c.local);
    if (c.arg) {
      // Se deja escrito para completarlo («/ficha » + producto).
      setInput(`/${c.name} `);
      setPaletteClosed(true);
      inputRef.current?.focus();
      return;
    }
    setInput("");
    void send(`/${c.name}`, undefined, undefined, c.label);
  }

  function fill(text: string) {
    setInput(text);
    inputRef.current?.focus();
  }

  const palette = paletteClosed ? [] : matchCommands(input);

  function onInputKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (palette.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setPaletteIndex((i) => (i + step + palette.length) % palette.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pickCommand(palette[Math.min(paletteIndex, palette.length - 1)]!);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setPaletteClosed(true);
        return;
      }
    }
    // ↑ / ↓ con el campo vacío o recorriendo el historial: lo último que se escribió.
    if ((event.key === "ArrowUp" || event.key === "ArrowDown") && (input === "" || historyAt.current !== null) && history.current.length > 0) {
      event.preventDefault();
      const last = history.current.length - 1;
      const at = historyAt.current === null ? (event.key === "ArrowUp" ? last : null) : historyAt.current + (event.key === "ArrowUp" ? -1 : 1);
      if (at === null || at > last) {
        historyAt.current = null;
        setInput("");
      } else {
        historyAt.current = Math.max(0, at);
        setInput(history.current[historyAt.current]!);
      }
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;
    history.current = [...history.current.filter((h) => h !== text), text].slice(-20);
    historyAt.current = null;
    const local = localCommandOf(text);
    if (local) return runLocal(local);
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
          <aside className={`copiloto-panel${drop.dragging ? " dropping" : ""}`} role="dialog" aria-label="Asistente de inventario" onClick={(event) => event.stopPropagation()} {...drop.dropHandlers}>
            {drop.dragging && (
              <div className="copiloto-drop" aria-hidden="true">
                <ImageUp size={28} />
                <strong>Suelta aquí la foto del albarán</strong>
                <span>La leo en tu dispositivo y te digo qué llega</span>
              </div>
            )}
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
                  <button type="button" className="icon-button" onClick={() => runLocal("nueva")} aria-label="Nueva conversación" title="Nueva conversación (/nueva)">
                    <RotateCcw size={15} />
                  </button>
                )}
                {items.length > 0 && (
                  <button type="button" className="copiloto-report-all" onClick={() => setReportFor({ index: null, sessionId: sessionId.current })} title="Reportar algo de toda la conversación">
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
              {items.length === 0 && <Welcome route={currentRoute(pathname)} alerts={suggestions === null ? null : suggestions.length} onAsk={ask} onFill={fill} />}

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
                    {item.help && <HelpCard onAsk={ask} />}
                    {item.alerts && item.alerts.length > 0 && (
                      <div className="copiloto-alerts">
                        {item.alerts.map((s) => (
                          <button type="button" key={s.id} className={`copiloto-suggestion ${s.urgency}`} onClick={() => s.action && window.location.assign(hrefFor(s.action))}>
                            <i />
                            <span>{s.text}</span>
                            {s.action && <ArrowRight size={14} />}
                          </button>
                        ))}
                      </div>
                    )}
                    {item.table && <TableCard table={item.table} />}
                    {item.charts?.map((chart) => <ChartCard key={chart.id} spec={chart} compact />)}
                    {item.form && (
                      <FormCard
                        form={item.form}
                        disabled={busy}
                        sent={!!item.formSent}
                        onSubmit={(values) => {
                          const form = item.form!;
                          setItems((prev) => prev.map((x) => (x.id === item.id && x.role === "assistant" ? { ...x, formSent: true } : x)));
                          const summary = form.fields.map((f) => values[f.key]).filter(Boolean).join(" · ");
                          void send(form.title, undefined, undefined, `${form.title}: ${summary}`, { accion: form.accion, values });
                        }}
                      />
                    )}
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
                    {item.photo && (
                      <div className="copiloto-actions">
                        <button type="button" onClick={() => item.photo && openFileIn("recepcion", item.photo.file)}>
                          {item.photo.read ? "Revisar y registrar la recepción" : "Registrar en Recepciones"}
                        </button>
                      </div>
                    )}
                    {item.invoiceFile && (
                      <div className="copiloto-actions">
                        <button type="button" onClick={() => item.invoiceFile && openFileIn("factura", item.invoiceFile)}>
                          Registrar la factura con este PDF
                        </button>
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
                        onClick={() => setReportFor({ index: items.findIndex((i) => i.id === item.id), sessionId: sessionId.current })}
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
              <CommandPalette commands={palette} active={Math.min(paletteIndex, Math.max(0, palette.length - 1))} onPick={pickCommand} onHover={setPaletteIndex} />
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
              <button
                type="button"
                className="copiloto-functions-toggle"
                onClick={() => photoInput.current?.click()}
                disabled={busy}
                aria-label="Enviar una foto"
                title="Foto de un albarán (o arrástrala aquí)"
              >
                <Camera size={16} />
              </button>
              <input
                ref={photoInput}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) handleFile(file);
                }}
              />
              <input
                ref={inputRef}
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
                  setPaletteIndex(0);
                  setPaletteClosed(false);
                  historyAt.current = null;
                }}
                onKeyDown={onInputKey}
                onPaste={drop.onPaste}
                placeholder={listening ? "Te escucho…" : pendingClarify ? "Responde o escribe otra cosa…" : "Pregunta, pide una operación o escribe /"}
                maxLength={1000}
              />
              {voice.available && (
                <button type="button" className={`copiloto-functions-toggle copiloto-mic${listening ? " active listening" : ""}`} onClick={voice.toggle} disabled={busy} aria-label={listening ? "Parar el dictado" : "Dictar"} title={listening ? "Parar" : "Dictar por voz"}>
                  {listening ? <MicOff size={16} /> : <Mic size={16} />}
                </button>
              )}
              <button type="submit" className="primary-button" disabled={busy || !input.trim()} aria-label="Enviar">
                {busy ? <Loader2 size={16} className="copiloto-spin" /> : <Send size={16} />}
              </button>
            </form>

            {reportFor && (
              <ReportForm
                items={items}
                index={reportFor.index}
                sessionId={reportFor.sessionId}
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
