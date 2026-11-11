"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link2, Loader2, Search, Trash2, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { euros, normalizeText } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import { readXlsx } from "@/lib/xlsx";
import { guessLocation, parseSalesBook, type ParsedSales } from "@/lib/sales-import";
import { MenuMatrix } from "./menu-matrix";
import { LocationTabs, type LocationOption } from "@/components/ui/location-tabs";
import { LoadingRows } from "@/components/ui/loading-rows";
import { SalesLinkEditor, type LinkTarget, type SalesItemRow } from "./sales-link-editor";
import "@/components/ui/kpi-strip.css";
import "../productos/productos.css";
import "../productos/product-editor.css";
import "../escandallos/escandallos.css";
import "./ventas.css";

// Ventas del TPV: se sube cada día la exportación «Ventas» del BDP, cada artículo se enlaza una vez con su
// plato (escandallo) o su producto, y sale el coste teórico y el food cost de lo vendido. Por ahora no
// descuenta stock. Solo dirección con «ve costes».

type Preview = {
  replaced: boolean; lines: number; total: number; linked_recipes: number; linked_products: number; ignored: number;
  theoretical_cost: number | null; costed_amount: number | null;
  unlinked: Array<{ code: string; name: string; qty: number; amount: number }>; no_cost: Array<{ code: string; name: string }>;
};
type Upload = { file: string; parsed: ParsedSales; location: string; preview: Preview | null; busy: boolean };
type DayRow = { id: string; date: string; location: string; total: number; file: string | null };
type Filter = "todos" | "sin_enlazar" | "sin_coste" | "carta";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthRange = (ref: Date) => ({ from: iso(new Date(ref.getFullYear(), ref.getMonth(), 1)), to: iso(new Date(ref.getFullYear(), ref.getMonth() + 1, 0)) });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const dateText = (d: string) => cap(new Date(`${d}T00:00:00`).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" }));
const monthText = (d: string) => cap(new Date(`${d}T00:00:00`).toLocaleDateString("es-ES", { month: "long", year: "numeric" }));
const pct = (v: number | null) => (v === null || !Number.isFinite(v) ? "—" : `${v.toLocaleString("es-ES", { maximumFractionDigits: 1 })} %`);
const qtyText = (v: number) => v.toLocaleString("es-ES", { maximumFractionDigits: 2 });

export default function SalesPage() {
  const perms = usePermissions();
  const allowed = perms ? ["owner", "admin", "manager"].includes(perms.role) && perms.seesCosts : null;
  const [orgId, setOrgId] = useState("");
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [location, setLocation] = useState("");
  const [range, setRange] = useState(() => monthRange(new Date()));
  const [items, setItems] = useState<SalesItemRow[] | null>(null);
  const [days, setDays] = useState<DayRow[]>([]);
  const [targets, setTargets] = useState<LinkTarget[]>([]);
  const [filter, setFilter] = useState<Filter>("todos");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [upload, setUpload] = useState<Upload | null>(null);
  const [editing, setEditing] = useState<SalesItemRow | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async (org: string, from: string, to: string, loc: string) => {
    const supabase = createClient();
    if (!supabase) return;
    const [rep, ds] = await Promise.all([
      supabase.rpc("sales_report", { p_org: org, p_from: from, p_to: to, p_location: loc || null }),
      supabase.from("sales_days").select("id, sale_date, location_id, total_amount, file_name").eq("org_id", org).gte("sale_date", from).lte("sale_date", to).order("sale_date", { ascending: false }),
    ]);
    if (rep.error || ds.error) return setError("No se pudieron cargar las ventas.");
    setItems((rep.data ?? []).map((r) => ({
      id: r.item_id, code: r.code, name: r.name, link: r.link, linkName: r.link_name, qtyPerSale: Number(r.qty_per_sale),
      qty: Number(r.qty), amount: Number(r.amount), unitCost: r.unit_cost === null ? null : Number(r.unit_cost),
      cost: r.cost === null ? null : Number(r.cost), foodCost: r.food_cost_pct === null ? null : Number(r.food_cost_pct),
    })));
    setDays((ds.data ?? []).filter((d) => !loc || d.location_id === loc).map((d) => ({ id: d.id, date: d.sale_date, location: d.location_id, total: Number(d.total_amount), file: d.file_name })));
    setError("");
  }, []);

  // Arranque: organización, locales, a qué enlazar y el último mes con ventas.
  useEffect(() => {
    if (!allowed) return;
    async function start() {
      const supabase = createClient();
      if (!supabase) return setError("Configura las variables de Supabase.");
      const { data: m } = await supabase.from("memberships").select("org_id").limit(1).maybeSingle();
      const org = m?.org_id ?? "";
      setOrgId(org);
      if (!org) return setItems([]);
      const [locs, last, recs, prods] = await Promise.all([
        supabase.from("locations").select("id, name").eq("org_id", org).eq("active", true).order("name"),
        supabase.from("sales_days").select("sale_date").eq("org_id", org).order("sale_date", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("recipes").select("id, name, kind, yield_unit").eq("org_id", org).eq("active", true).order("name").range(0, 4999),
        supabase.from("products").select("id, name, dimension").eq("org_id", org).eq("active", true).order("name").range(0, 4999),
      ]);
      setLocations((locs.data ?? []).map((l) => ({ id: l.id, name: l.name })));
      setTargets([
        ...(recs.data ?? []).map((r) => ({ kind: "receta" as const, id: r.id, name: r.name, detail: r.kind === "plato" ? "Plato" : "Elaboración", unit: r.yield_unit })),
        ...(prods.data ?? []).map((p) => ({ kind: "producto" as const, id: p.id, name: p.name, detail: "Producto", unit: p.dimension })),
      ]);
      const r = last.data?.sale_date ? monthRange(new Date(`${last.data.sale_date}T00:00:00`)) : monthRange(new Date());
      setRange(r);
      await load(org, r.from, r.to, "");
    }
    void start();
  }, [allowed, load]);

  function changeRange(next: { from: string; to: string }) {
    setRange(next);
    setItems(null);
    void load(orgId, next.from, next.to, location);
  }
  function changeLocation(id: string) {
    setLocation(id);
    setItems(null);
    void load(orgId, range.from, range.to, id);
  }
  function shiftMonth(delta: number) {
    const d = new Date(`${range.from}T00:00:00`);
    changeRange(monthRange(new Date(d.getFullYear(), d.getMonth() + delta, 1)));
  }

  async function preview(next: Upload) {
    const supabase = createClient();
    if (!supabase || !next.parsed.date) return;
    setUpload({ ...next, busy: true, preview: null });
    const { data, error: err } = await supabase.rpc("import_sales", {
      p_org: orgId, p_location: next.location, p_date: next.parsed.date, p_lines: next.parsed.lines, p_source: "tpv", p_file: next.file, p_apply: false,
    });
    if (err) {
      setUpload({ ...next, busy: false });
      return setError("No se pudo comprobar el fichero.");
    }
    setUpload({ ...next, busy: false, preview: data as unknown as Preview });
  }

  async function onFile(list: FileList | null) {
    setError("");
    const f = list?.[0];
    if (input.current) input.current.value = "";
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) return setError("Sube la exportación de ventas en Excel (.xlsx).");
    try {
      const sheets = await readXlsx(await f.arrayBuffer());
      const parsed = Object.values(sheets).map(parseSalesBook).find((p) => p && p.lines.length > 0) ?? null;
      if (!parsed) return setError(`«${f.name}» no parece una exportación de ventas (falta la tabla con Descripción, Código, Cantidad e Importe).`);
      if (!parsed.date) return setError("El fichero no dice de qué día son las ventas («Fecha venta»).");
      const loc = guessLocation(parsed.costCentre, locations)?.id ?? location ?? "";
      const next: Upload = { file: f.name, parsed, location: loc, preview: null, busy: false };
      setUpload(next);
      if (loc) await preview(next);
    } catch {
      setError("No se pudo leer el fichero.");
    }
  }

  async function save() {
    if (!upload?.parsed.date || !upload.location) return;
    const supabase = createClient();
    if (!supabase) return;
    setUpload({ ...upload, busy: true });
    const { error: err } = await supabase.rpc("import_sales", {
      p_org: orgId, p_location: upload.location, p_date: upload.parsed.date, p_lines: upload.parsed.lines, p_source: "tpv", p_file: upload.file, p_apply: true,
    });
    if (err) {
      setUpload({ ...upload, busy: false });
      return setError("No se pudo guardar el día.");
    }
    const r = monthRange(new Date(`${upload.parsed.date}T00:00:00`));
    setUpload(null);
    setRange(r);
    await load(orgId, r.from, r.to, location);
  }

  async function removeDay(d: DayRow) {
    if (!window.confirm(`¿Borrar las ventas del ${dateText(d.date)}? Se pueden volver a importar.`)) return;
    const supabase = createClient();
    if (!supabase) return;
    const { error: err } = await supabase.from("sales_days").delete().eq("id", d.id);
    if (err) return setError("No se pudo borrar el día.");
    await load(orgId, range.from, range.to, location);
  }

  const all = useMemo(() => items ?? [], [items]);
  const totals = useMemo(() => {
    const amount = all.reduce((s, i) => s + i.amount, 0);
    const costed = all.filter((i) => i.cost !== null);
    const cost = costed.reduce((s, i) => s + (i.cost ?? 0), 0);
    const costedAmount = costed.reduce((s, i) => s + i.amount, 0);
    const unlinked = all.filter((i) => i.link === "sin_enlazar");
    const noCost = all.filter((i) => (i.link === "receta" || i.link === "producto") && i.cost === null);
    return { amount, cost, costedAmount, unlinked, noCost, foodCost: costedAmount > 0 ? (cost / costedAmount) * 100 : null };
  }, [all]);
  const visible = all
    .filter((i) => (filter === "sin_enlazar" ? i.link === "sin_enlazar" : filter === "sin_coste" ? (i.link === "receta" || i.link === "producto") && i.cost === null : true))
    .filter((i) => !query || normalizeText(`${i.name} ${i.code} ${i.linkName ?? ""}`).includes(normalizeText(query)));
  const locName = (id: string) => locations.find((l) => l.id === id)?.name ?? "";
  const covered = totals.amount > 0 ? (totals.costedAmount / totals.amount) * 100 : 0;

  return (
    <main className="catalog-page">
      <div className="catalog-content">
        <div className="catalog-heading">
          <div>
            <p className="eyebrow">Gestión · Ventas</p>
            <h1>Ventas</h1>
            <p className="catalog-subtitle">Lo vendido en el TPV, su coste teórico según los escandallos y el food cost.</p>
          </div>
          {allowed && (
            <label className="catalog-primary sales-upload">
              <Upload size={17} /> Importar día del TPV
              <input ref={input} type="file" accept=".xlsx" hidden onChange={(e) => void onFile(e.target.files)} />
            </label>
          )}
        </div>

        {allowed === false ? (
          <section className="catalog-panel"><div className="catalog-empty"><strong>Sin acceso a ventas</strong><span>Las ventas las ve la dirección con el permiso «ve costes».</span></div></section>
        ) : (
          <>
            {error && <p className="import-error" role="alert">{error}</p>}

            {upload && (
              <section className="catalog-panel sales-preview">
                <div className="sales-preview-head">
                  <div>
                    <h2>{upload.file}</h2>
                    <p>Ventas del {upload.parsed.date ? dateText(upload.parsed.date) : "—"} · {upload.parsed.source ?? "TPV"}{upload.parsed.costCentre ? ` · ${upload.parsed.costCentre}` : ""}</p>
                  </div>
                  <label className="sales-loc">
                    <span>Local</span>
                    <select value={upload.location} onChange={(e) => void preview({ ...upload, location: e.target.value })}>
                      <option value="" disabled>Elige el local</option>
                      {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </label>
                </div>
                {upload.busy && <p className="sales-note"><Loader2 size={14} className="spin" /> Comprobando…</p>}
                {!upload.location && <p className="sales-note">Elige el local de estas ventas.</p>}
                {upload.preview && !upload.busy && (
                  <>
                    <div className="sales-preview-figures">
                      <div><span>Venta sin IVA</span><strong>{euros(upload.preview.total)}</strong><small>{upload.preview.lines} líneas</small></div>
                      <div><span>Enlazadas</span><strong>{upload.preview.linked_recipes + upload.preview.linked_products}</strong><small>{upload.preview.linked_recipes} a platos · {upload.preview.linked_products} a productos</small></div>
                      <div className={upload.preview.unlinked.length ? "warn" : ""}><span>Sin enlazar</span><strong>{upload.preview.unlinked.length}</strong><small>{euros(upload.preview.unlinked.reduce((s, u) => s + Number(u.amount), 0))} sin coste</small></div>
                      <div><span>Coste teórico</span><strong>{upload.preview.theoretical_cost === null ? "—" : euros(upload.preview.theoretical_cost)}</strong><small>{upload.preview.costed_amount ? `food cost ${pct((Number(upload.preview.theoretical_cost) / Number(upload.preview.costed_amount)) * 100)} de lo enlazado` : "nada enlazado aún"}</small></div>
                    </div>
                    {upload.preview.replaced && <p className="sales-note warn">Ya había ventas de ese día en este local: se sustituyen por las del fichero.</p>}
                    {upload.preview.unlinked.length > 0 && (
                      <p className="sales-note">Sin enlazar (se enlazan una vez, después de guardar): {upload.preview.unlinked.slice(0, 12).map((u) => u.name).join(" · ")}{upload.preview.unlinked.length > 12 ? ` y ${upload.preview.unlinked.length - 12} más` : ""}.</p>
                    )}
                    {upload.parsed.issues.length > 0 && <p className="sales-note warn">{upload.parsed.issues.join(" ")}</p>}
                  </>
                )}
                <div className="sales-preview-actions">
                  <button className="ghost-button" onClick={() => setUpload(null)} disabled={upload.busy}>Cancelar</button>
                  <button className="catalog-primary" onClick={() => void save()} disabled={upload.busy || !upload.preview}>Guardar día</button>
                </div>
              </section>
            )}

            <div className="sales-bar">
              <div className="sales-month">
                <button className="ghost-button" onClick={() => shiftMonth(-1)} aria-label="Mes anterior">‹</button>
                <strong>{monthText(range.from)}</strong>
                <button className="ghost-button" onClick={() => shiftMonth(1)} aria-label="Mes siguiente">›</button>
              </div>
              <LocationTabs locations={locations} value={location} onChange={changeLocation} />
            </div>

            <section className="kpi-strip" aria-label="Cifras">
              <div className="kpi">
                <span className="kpi-label">Venta sin IVA</span>
                <strong className="kpi-value">{items ? euros(totals.amount) : "…"}</strong>
                <span className="kpi-note">{days.length} {days.length === 1 ? "día importado" : "días importados"}</span>
              </div>
              <div className="kpi">
                <span className="kpi-label">Coste teórico</span>
                <strong className="kpi-value">{items ? euros(totals.cost) : "…"}</strong>
                <span className="kpi-note">{items ? `de ${euros(totals.costedAmount)} de venta con coste conocido` : " "}</span>
              </div>
              <div className="kpi">
                <span className="kpi-label">Food cost</span>
                <strong className="kpi-value">{items ? pct(totals.foodCost) : "…"}</strong>
                <span className="kpi-note">{items ? `cubre el ${covered.toLocaleString("es-ES", { maximumFractionDigits: 0 })} % de la venta` : " "}</span>
              </div>
              <button className="kpi sales-kpi-button" onClick={() => setFilter("sin_enlazar")}>
                <span className="kpi-label">Sin enlazar</span>
                <strong className={`kpi-value${totals.unlinked.length ? " alert" : ""}`}>{items ? totals.unlinked.length : "…"}<small>artículos</small></strong>
                <span className="kpi-note">{items ? `${euros(totals.unlinked.reduce((s, i) => s + i.amount, 0))} sin coste` : " "}</span>
              </button>
            </section>

            <div className="catalog-tabs">
              {([["todos", "Todos", all.length], ["sin_enlazar", "Sin enlazar", totals.unlinked.length], ["sin_coste", "Sin precio", totals.noCost.length]] as Array<[Filter, string, number]>).map(([f, label, n]) => (
                <button key={f} className={filter === f ? "active" : undefined} onClick={() => setFilter(f)}>{label} <b>{n}</b></button>
              ))}
              <button className={filter === "carta" ? "active" : undefined} onClick={() => setFilter("carta")}>Ingeniería de menú</button>
            </div>
            {filter === "carta" ? (
              <section className="catalog-panel">
                {items ? <MenuMatrix items={all} days={days.length} /> : <LoadingRows label="Cargando ventas" />}
              </section>
            ) : (
            <section className="catalog-panel">
              <div className="catalog-toolbar">
                <div className="catalog-search">
                  <Search size={16} />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar artículo" aria-label="Buscar artículo" />
                </div>
              </div>
              <div className="sales-table">
                <div className="sales-row sales-head"><span>Artículo</span><span>Vendido</span><span>Importe</span><span>Coste</span><span>Food cost</span></div>
                {!items && !error && <LoadingRows label="Cargando ventas" />}
                {items && visible.map((i) => (
                  <button key={i.id} className={`sales-row ${i.link === "sin_enlazar" ? "unlinked" : ""}`} onClick={() => setEditing(i)}>
                    <span className="sales-name">
                      <strong>{i.name}</strong>
                      <small>
                        {i.link === "sin_enlazar" ? <span className="sales-tag warn"><Link2 size={11} /> Enlazar</span>
                          : i.link === "ignorado" ? <span className="sales-tag">Sin coste (no es comida ni bebida)</span>
                          : <>{i.link === "receta" ? "Plato" : "Producto"}: {i.linkName}</>}
                        <span className="sales-code"> · cód. {i.code}</span>
                      </small>
                    </span>
                    <span>{qtyText(i.qty)}</span>
                    <span><b>{euros(i.amount)}</b></span>
                    <span>{i.cost === null ? <small>{i.link === "receta" || i.link === "producto" ? "falta algún precio" : "—"}</small> : <><b>{euros(i.cost)}</b><small>{euros(i.unitCost)} / ud</small></>}</span>
                    <span className={i.foodCost !== null && i.foodCost > 40 ? "sales-high" : undefined}>{pct(i.foodCost)}</span>
                  </button>
                ))}
                {items && visible.length === 0 && (
                  <div className="catalog-empty">
                    <strong>{all.length === 0 ? "No hay ventas en este periodo" : "Nada aquí"}</strong>
                    <span>{all.length === 0 ? "Importa la exportación diaria del TPV con «Importar día del TPV»." : "Prueba otro filtro o búsqueda."}</span>
                  </div>
                )}
              </div>
            </section>
            )}

            {days.length > 0 && (
              <section className="sales-days">
                <h2>Días importados</h2>
                {days.map((d) => (
                  <div key={d.id} className="sales-day">
                    <span><strong>{dateText(d.date)}</strong><small>{locName(d.location)}{d.file ? ` · ${d.file}` : ""}</small></span>
                    <b>{euros(d.total)}</b>
                    <button className="ghost-button" onClick={() => void removeDay(d)} aria-label={`Borrar ventas del ${dateText(d.date)}`}><Trash2 size={15} /></button>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </div>
      {editing && (
        <SalesLinkEditor
          item={editing}
          targets={targets}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(orgId, range.from, range.to, location); }}
        />
      )}
    </main>
  );
}
