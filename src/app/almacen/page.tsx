"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, ArrowRight, ClipboardCheck, CloudOff, Minus, Plus, RotateCcw, ScanLine, Search, Undo2, Warehouse, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  dequeue,
  describeQty,
  enqueue,
  flushQueue,
  isNetworkError,
  layoutOf,
  qtyFromInput,
  readQueue,
  warehouseError,
  type Area,
  type CatalogItem,
  type MoveKind,
  type MoveRow,
  type QueuedMove,
  type WarehouseContext,
} from "@/lib/warehouse";
import { MovesQueue, qtyLabel, type Decision } from "./moves-queue";
import { PinDialog } from "./pin-dialog";
import "./almacen.css";

// Pantalla del almacén. En la tablet de un almacén (cuenta de pantalla) o en el móvil de quien trabaja en
// el local. Se apunta lo que sale (o vuelve) y queda PENDIENTE; el stock solo se mueve cuando una persona
// autorizada lo valida (con su PIN en la pantalla, con su sesión en el móvil). Sin cobertura, lo apuntado
// se guarda en el dispositivo y se envía solo al volver la red, sin duplicarse.

type Toast = { text: string; moveId?: string; clientRef?: string; at: number; tone?: "ok" | "warn" };
const STALE_HOURS = 8;
const UNDO_MS = 2 * 60_000;

export default function AlmacenPage() {
  const [ctx, setCtx] = useState<WarehouseContext | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<MoveKind>("salida");
  const [store, setStore] = useState<string>("");
  const [service, setService] = useState<string>("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [sheet, setSheet] = useState<{ item: CatalogItem; boxes: string; loose: string } | null>(null);
  const [pending, setPending] = useState<MoveRow[]>([]);
  const [decided, setDecided] = useState<MoveRow[]>([]);
  const [panel, setPanel] = useState<"cola" | "hoy" | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [queued, setQueued] = useState<QueuedMove[]>([]);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pinFor, setPinFor] = useState<{ decisions: Decision[]; summary: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const searchRef = useRef<HTMLInputElement>(null);

  const areas = useMemo(() => ctx?.areas ?? [], [ctx]);
  const stores = areas.filter((a) => a.kind === "almacen");
  const services = areas.filter((a) => a.kind === "servicio");
  const areaName = (id: string) => areas.find((a) => a.id === id)?.name ?? "";
  // Salida: almacén → servicio. Devolución: servicio → almacén.
  const from = mode === "salida" ? store : service;
  const to = mode === "salida" ? service : store;

  // Contexto: local, zonas, si puede validar y cuántas hay pendientes.
  const loadContext = useCallback(async (loc: string | null) => {
    const supabase = createClient();
    if (!supabase) return setError("Configura las variables de Supabase.");
    const { data, error: err } = await supabase.rpc("warehouse_context", { p_location: loc });
    if (err || !data) {
      setError(isNetworkError(err) ? "Sin conexión. Lo que apuntes se guardará en este dispositivo." : "No tienes acceso al almacén de ningún local.");
      return;
    }
    const next = data as unknown as WarehouseContext;
    if (!next.location_id) {
      // Sin local: una pantalla que se ha quitado o alguien sin locales asignados.
      setCtx(null);
      setItems([]);
      setError("Este dispositivo no tiene acceso al almacén de ningún local. Si es la pantalla del almacén, pide a tu encargado un enlace nuevo.");
      return;
    }
    setCtx(next);
    setError("");
    setLocationId(next.location_id);
    const pick = (list: Area[], preferred: string) => list.find((a) => a.name.toLowerCase() === preferred)?.id ?? list[0]?.id ?? "";
    setStore((s) => (next.areas.some((a) => a.id === s && a.kind === "almacen") ? s : pick(next.areas.filter((a) => a.kind === "almacen"), "almacén")));
    setService((s) => (next.areas.some((a) => a.id === s && a.kind === "servicio") ? s : pick(next.areas.filter((a) => a.kind === "servicio"), "barra")));
  }, []);

  const loadQueue = useCallback(async (loc: string | null) => {
    if (!loc) return;
    const supabase = createClient();
    if (!supabase) return;
    const [p, d] = await Promise.all([
      supabase.rpc("area_moves_list", { p_location: loc, p_status: "pending" }),
      supabase.rpc("area_moves_list", { p_location: loc, p_status: "decided", p_limit: 50 }),
    ]);
    if (!p.error) setPending((p.data ?? []) as unknown as MoveRow[]);
    if (!d.error) setDecided((d.data ?? []) as unknown as MoveRow[]);
  }, []);

  const flush = useCallback(async () => {
    const supabase = createClient();
    if (!supabase || readQueue().length === 0) return setQueued(readQueue());
    const result = await flushQueue(async (m) => {
      const { error: err } = await supabase.rpc("area_move_submit", {
        p_location: m.locationId,
        p_from_area: m.fromArea,
        p_to_area: m.toArea,
        p_product: m.productId,
        p_qty: Number(m.qty),
        p_input: m.input,
        p_kind: m.kind,
        p_client_ref: m.clientRef,
      });
      return err ?? null;
    });
    setQueued(readQueue());
    setOffline(result.left > 0);
    if (result.sent > 0) {
      setToast({ text: result.sent === 1 ? "Enviada 1 salida guardada sin conexión." : `Enviadas ${result.sent} salidas guardadas sin conexión.`, at: Date.now() });
      void loadQueue(locationId);
    }
    if (result.failed.length) setError(`No se pudo enviar «${result.failed[0]!.move.label}»: ${result.failed[0]!.message}`);
  }, [locationId, loadQueue]);

  useEffect(() => {
    async function start() {
      await Promise.resolve();
      const fromUrl = new URLSearchParams(window.location.search).get("local");
      await loadContext(fromUrl);
      setQueued(readQueue());
    }
    void start();
  }, [loadContext]);

  // Cola y reloj: cada 30 s; lo guardado sin conexión, al volver la red y cada 20 s.
  useEffect(() => {
    if (!locationId) return;
    const first = window.setTimeout(() => void loadQueue(locationId), 0);
    const timer = window.setInterval(() => {
      void loadQueue(locationId);
      setNow(Date.now());
    }, 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [locationId, loadQueue]);

  useEffect(() => {
    const retry = () => void flush();
    const goOffline = () => setOffline(true);
    window.addEventListener("online", retry);
    window.addEventListener("offline", goOffline);
    const timer = window.setInterval(retry, 20_000);
    const first = window.setTimeout(retry, 0);
    return () => {
      window.removeEventListener("online", retry);
      window.removeEventListener("offline", goOffline);
      window.clearInterval(timer);
      window.clearTimeout(first);
    };
  }, [flush]);

  // Catálogo: lo habitual de este local; al escribir, búsqueda (también por código de barras).
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search), search ? 180 : 0);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!locationId) return;
    let cancelled = false;
    async function load() {
      const { data, error: err } = (await createClient()?.rpc("warehouse_catalog", { p_location: locationId!, p_search: query || null, p_limit: 48 })) ?? { data: null, error: null };
      if (cancelled) return;
      if (err) {
        if (!isNetworkError(err)) setError("No se pudo cargar el catálogo.");
        return;
      }
      setItems((data ?? []) as unknown as CatalogItem[]);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [locationId, query]);

  // El aviso de deshacer desaparece a los 2 minutos.
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.moveId ? UNDO_MS : 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function openItem(item: CatalogItem, scanned?: string) {
    const layout = layoutOf(item.dimension, item.packs);
    const pack = scanned ? item.packs.find((k) => k.barcode === scanned) : undefined;
    // Escanear una caja apunta «1 caja»; escanear una botella, «1 suelta».
    const boxScan = !!pack && !!layout.box && Number(pack.qty) === layout.box.qty.toNumber();
    setSheet({ item, boxes: boxScan ? "1" : "", loose: pack && !boxScan ? "1" : "" });
  }

  function onSearchKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    const raw = search.trim();
    const hit = items?.find((i) => i.packs.some((k) => k.barcode && k.barcode === raw));
    if (hit) {
      openItem(hit, raw);
      setSearch("");
    } else if (items?.length === 1) {
      openItem(items[0]!);
    }
  }

  async function submit() {
    if (!sheet || !locationId) return;
    const qty = qtyFromInput(sheet.item.dimension, sheet.item.packs, sheet.boxes, sheet.loose);
    if (!qty) return setError("Indica cuántas cajas o sueltas.");
    if (!from || !to) return setError(mode === "salida" ? "Elige a dónde va." : "Elige de dónde vuelve.");
    const move: QueuedMove = {
      clientRef: crypto.randomUUID(),
      locationId,
      fromArea: from,
      toArea: to,
      productId: sheet.item.id,
      qty: qty.toString(),
      input: { boxes: sheet.boxes.trim() || undefined, loose: sheet.loose.trim() || undefined },
      kind: mode,
      label: `${sheet.item.name} · ${qtyLabel({ qty: qty.toString(), input: { boxes: sheet.boxes, loose: sheet.loose }, dimension: sheet.item.dimension, packs: sheet.item.packs })}`,
      queuedAt: new Date().toISOString(),
    };
    setBusy(true);
    setError("");
    const supabase = createClient();
    const { data, error: err } = (await supabase?.rpc("area_move_submit", {
      p_location: move.locationId,
      p_from_area: move.fromArea,
      p_to_area: move.toArea,
      p_product: move.productId,
      p_qty: Number(move.qty),
      p_input: move.input,
      p_kind: move.kind,
      p_client_ref: move.clientRef,
    })) ?? { data: null, error: { message: "Failed to fetch" } };
    setBusy(false);
    const text = `${move.label} → ${areaName(move.toArea)}`;
    if (err && isNetworkError(err)) {
      setQueued(enqueue(move));
      setOffline(true);
      setToast({ text: `Guardada sin conexión: ${text}. Se enviará sola.`, clientRef: move.clientRef, at: Date.now(), tone: "warn" });
    } else if (err) {
      return setError(warehouseError(err));
    } else {
      setToast({ text: `Apuntado: ${text}`, moveId: data as string, at: Date.now() });
      void loadQueue(locationId);
    }
    setSheet(null);
    setSearch("");
    searchRef.current?.focus();
  }

  async function undo(t: Toast) {
    if (t.clientRef && !t.moveId) {
      setQueued(dequeue(t.clientRef));
      setToast({ text: "Quitada.", at: Date.now() });
      return;
    }
    if (!t.moveId) return;
    const { error: err } = (await createClient()?.rpc("area_move_cancel", { p_id: t.moveId })) ?? { error: null };
    if (err) return setError(warehouseError(err));
    setToast({ text: "Deshecho.", at: Date.now() });
    void loadQueue(locationId);
  }

  async function decide(decisions: Decision[], validator?: string, pin?: string) {
    setBusy(true);
    const { data, error: err } = (await createClient()?.rpc("area_moves_decide", {
      p_decisions: decisions,
      p_validator: validator ?? null,
      p_pin: pin ?? null,
    })) ?? { data: null, error: null };
    setBusy(false);
    if (err) {
      setError(warehouseError(err, "No se pudo validar."));
      return { ok: false, error: "other" };
    }
    const result = data as { ok: boolean; error?: string; validated?: number; rejected?: number; attempts_left?: number; locked_until?: string };
    if (result.ok) {
      setPinFor(null);
      // En la tablet, la siguiente persona se encuentra la pantalla de apuntar, no la cola.
      if (kiosk) setPanel(null);
      setToast({ text: `Validado: ${result.validated ?? 0} al stock${result.rejected ? `, ${result.rejected} rechazadas` : ""}.`, at: Date.now() });
      void loadQueue(locationId);
      void loadContext(locationId);
    }
    return result;
  }

  const kiosk = ctx?.kiosk ?? false;
  const canDecide = kiosk || (ctx?.can_validate ?? false);
  const location = ctx?.locations.find((l) => l.id === locationId);
  const stale = ctx?.oldest_pending && now - new Date(ctx.oldest_pending).getTime() > STALE_HOURS * 3_600_000;
  const layout = sheet ? layoutOf(sheet.item.dimension, sheet.item.packs) : null;
  const sheetQty = sheet ? qtyFromInput(sheet.item.dimension, sheet.item.packs, sheet.boxes, sheet.loose) : null;
  const step = (field: "boxes" | "loose", delta: number) =>
    setSheet((s) => (s ? { ...s, [field]: String(Math.max(0, (Number(s[field].replace(",", ".")) || 0) + delta)).replace(".", ",") } : s));

  return (
    <main className={`wh-page ${kiosk ? "kiosk" : ""}`}>
      <header className="wh-top">
        {kiosk ? (
          <span className="wh-brand"><Warehouse size={20} /> Almacén · {location?.name ?? "…"}</span>
        ) : (
          <Link href="/" className="wh-back"><ArrowLeft size={18} /> Panel</Link>
        )}
        {!kiosk && (ctx?.locations.length ?? 0) > 1 && (
          <select className="wh-select" value={locationId ?? ""} onChange={(e) => void loadContext(e.target.value)} aria-label="Local">
            {ctx?.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
        {!kiosk && (ctx?.locations.length ?? 0) === 1 && <span className="wh-brand"><Warehouse size={20} /> {location?.name}</span>}
        <div className="wh-top-actions">
          {(offline || queued.length > 0) && (
            <span className="wh-offline" title="Se envían solas al volver la conexión"><CloudOff size={16} /> {queued.length ? `${queued.length} sin enviar` : "Sin conexión"}</span>
          )}
          <button className={`wh-pending-button ${pending.length ? "has" : ""}`} onClick={() => { setNow(Date.now()); setPanel(panel === "cola" ? null : "cola"); }}>
            <ClipboardCheck size={18} /> Pendientes <b>{pending.length}</b>
          </button>
        </div>
      </header>

      {stale && (
        <p className="wh-banner"><AlertTriangle size={16} /> Hay salidas sin validar desde hace más de {STALE_HOURS} horas. El stock no se mueve hasta que alguien las valide.</p>
      )}
      {error && <p className="wh-error wh-error-bar">{error} <button onClick={() => setError("")} aria-label="Cerrar aviso"><X size={14} /></button></p>}

      <section className="wh-controls">
        <div className="wh-mode" role="tablist" aria-label="Qué haces">
          <button role="tab" aria-selected={mode === "salida"} className={mode === "salida" ? "active" : ""} onClick={() => setMode("salida")}>Sacar del almacén</button>
          <button role="tab" aria-selected={mode === "devolucion"} className={mode === "devolucion" ? "active" : ""} onClick={() => setMode("devolucion")}><RotateCcw size={15} /> Devolver</button>
        </div>
        <div className="wh-route">
          <div className="wh-route-part">
            <span className="wh-label">{mode === "salida" ? "Sale de" : "Vuelve de"}</span>
            {(mode === "salida" ? stores : services).length > 1 ? (
              <div className="wh-chips">
                {(mode === "salida" ? stores : services).map((a) => (
                  <button key={a.id} className={from === a.id ? "active" : ""} onClick={() => (mode === "salida" ? setStore(a.id) : setService(a.id))}>{a.name}</button>
                ))}
              </div>
            ) : (
              <b>{areaName(from) || "—"}</b>
            )}
          </div>
          <ArrowRight className="wh-route-arrow" size={22} />
          <div className="wh-route-part">
            <span className="wh-label">{mode === "salida" ? "Va a" : "Vuelve a"}</span>
            <div className="wh-chips">
              {(mode === "salida" ? services : stores).map((a) => (
                <button key={a.id} className={to === a.id ? "active" : ""} onClick={() => (mode === "salida" ? setService(a.id) : setStore(a.id))}>{a.name}</button>
              ))}
              {(mode === "salida" ? services : stores).length === 0 && <span className="wh-muted">Crea una zona en Gestión → Zonas</span>}
            </div>
          </div>
        </div>
        <label className="wh-search">
          <Search size={20} />
          <input
            ref={searchRef}
            autoFocus={kiosk}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder="Busca o escanea el código de la caja"
            aria-label="Buscar o escanear producto"
            enterKeyHint="search"
            autoComplete="off"
          />
          <ScanLine size={20} className="wh-scan-icon" />
        </label>
      </section>

      <section className="wh-grid" aria-label="Productos">
        {items === null && <p className="wh-muted">Cargando…</p>}
        {items?.length === 0 && (
          <p className="wh-muted">{query ? "Ningún producto coincide." : "Busca un producto: aquí aparecerán los que más salen de este almacén."}</p>
        )}
        {items?.map((item) => (
          <button key={item.id} className="wh-tile" onClick={() => openItem(item)}>
            <strong>{item.name}</strong>
            <small>{item.family ?? "Sin familia"}</small>
            <span className={`wh-tile-stock ${Number(item.stock) < 0 ? "neg" : ""}`}>{Number(item.stock) !== 0 ? `${describeQty(item.stock, item.dimension, item.packs)} en almacén` : "Sin stock en almacén"}</span>
            {item.uses > 0 && !query && <em>Habitual</em>}
          </button>
        ))}
      </section>

      {sheet && layout && (
        <div className="wh-modal-layer" onClick={() => !busy && setSheet(null)}>
          <section className="wh-modal wh-sheet" role="dialog" aria-modal="true" aria-label={`Cantidad de ${sheet.item.name}`} onClick={(e) => e.stopPropagation()}>
            <header>
              <div>
                <p className="wh-eyebrow">{mode === "salida" ? `${areaName(from)} → ${areaName(to)}` : `Devolución: ${areaName(from)} → ${areaName(to)}`}</p>
                <h2>{sheet.item.name}</h2>
                <p className="wh-muted">{Number(sheet.item.stock) !== 0 ? `${describeQty(sheet.item.stock, sheet.item.dimension, sheet.item.packs)} en almacén` : "Sin stock en almacén según el sistema"}</p>
              </div>
              <button className="wh-icon-button" onClick={() => setSheet(null)} aria-label="Cerrar"><X size={20} /></button>
            </header>
            <div className="wh-steppers">
              {layout.box && (
                <div className="wh-stepper">
                  <span>{layout.box.name}<small>{layout.box.units.toString()} {layout.unit.plural}</small></span>
                  <div>
                    <button onClick={() => step("boxes", -1)} aria-label="Una caja menos"><Minus size={22} /></button>
                    <input inputMode="numeric" value={sheet.boxes} onChange={(e) => setSheet({ ...sheet, boxes: e.target.value })} placeholder="0" aria-label="Cajas" />
                    <button onClick={() => step("boxes", 1)} aria-label="Una caja más"><Plus size={22} /></button>
                  </div>
                </div>
              )}
              <div className="wh-stepper">
                <span>{layout.box ? "Sueltas" : "Cantidad"}<small>{layout.unit.plural}</small></span>
                <div>
                  <button onClick={() => step("loose", -1)} aria-label="Una menos"><Minus size={22} /></button>
                  <input inputMode="decimal" value={sheet.loose} onChange={(e) => setSheet({ ...sheet, loose: e.target.value })} placeholder="0" aria-label="Sueltas"
                    onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} />
                  <button onClick={() => step("loose", 1)} aria-label="Una más"><Plus size={22} /></button>
                </div>
              </div>
            </div>
            <button className="wh-primary wh-submit" disabled={busy || !sheetQty || !to} onClick={() => void submit()}>
              {busy ? "Guardando…" : sheetQty ? `${mode === "salida" ? "Apuntar salida" : "Apuntar devolución"} · ${qtyLabel({ qty: sheetQty.toString(), input: { boxes: sheet.boxes, loose: sheet.loose }, dimension: sheet.item.dimension, packs: sheet.item.packs })}` : "Indica la cantidad"}
            </button>
            <p className="wh-muted wh-center">Queda pendiente hasta que alguien con permiso la valide.</p>
          </section>
        </div>
      )}

      {panel && (
        <div className="wh-modal-layer" onClick={() => setPanel(null)}>
          <section className="wh-modal wh-panel" role="dialog" aria-modal="true" aria-label="Salidas" onClick={(e) => e.stopPropagation()}>
            <header>
              <div className="wh-tabs">
                <button className={panel === "cola" ? "active" : ""} onClick={() => setPanel("cola")}>Pendientes <b>{pending.length}</b></button>
                <button className={panel === "hoy" ? "active" : ""} onClick={() => setPanel("hoy")}>Últimas 24 h</button>
              </div>
              <button className="wh-icon-button" onClick={() => setPanel(null)} aria-label="Cerrar"><X size={20} /></button>
            </header>
            {panel === "cola" ? (
              <>
                {!canDecide && pending.length > 0 && <p className="wh-muted">Las valida un encargado o alguien autorizado.</p>}
                <MovesQueue
                  rows={pending}
                  now={now}
                  canDecide={canDecide}
                  busy={busy}
                  onUndo={(row) => void undo({ text: "", moveId: row.id, at: Date.now() })}
                  onDecide={(decisions, summary) => (kiosk ? setPinFor({ decisions, summary }) : void decide(decisions))}
                />
              </>
            ) : (
              <div className="wh-queue">
                {decided.length === 0 && <p className="wh-muted">Nada validado en las últimas 24 horas.</p>}
                {decided.map((r) => (
                  <article key={r.id} className={`wh-move done ${r.status}`}>
                    <div className="wh-move-main">
                      <strong>{r.product_name}</strong>
                      <span className="wh-move-qty">{describeQty(r.qty, r.dimension, r.packs)}{r.original?.qty ? ` (apuntado: ${describeQty(r.original.qty, r.dimension, r.packs)})` : ""}</span>
                      <span className="wh-move-route">{r.from_area} <ArrowRight size={13} /> {r.to_area}</span>
                      <small>
                        {r.status === "validated" ? "Validada" : "Rechazada"} por {r.decided_by_name ?? "—"}
                        {r.decision_note ? ` · «${r.decision_note}»` : ""}
                      </small>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {pinFor && (
        <PinDialog
          summary={pinFor.summary}
          onClose={() => setPinFor(null)}
          onConfirm={async (validator, pin) => (await decide(pinFor.decisions, validator, pin)) as { ok: boolean; error?: string; attempts_left?: number; locked_until?: string }}
        />
      )}

      {toast && (
        <div className={`wh-toast ${toast.tone ?? "ok"}`} role="status">
          <span>{toast.text}</span>
          {(toast.moveId || toast.clientRef) && now - toast.at < UNDO_MS && (
            <button onClick={() => { const t = toast; setToast(null); void undo(t); }}><Undo2 size={16} /> Deshacer</button>
          )}
        </div>
      )}
    </main>
  );
}
