"use client";

import { useEffect, useRef, useState } from "react";
import Decimal from "decimal.js";
import { ChevronRight, Download, Search } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { usePermissions } from "@/lib/permissions";
import { daysAgo, euros, quantity } from "@/lib/format";
import { readLocation, saveLocation } from "@/lib/location-preference";
import { formatStock, type CountingPacks, type UnitDimension } from "@/lib/units";
import "./stock.css";
import { LoadingRows } from "@/components/ui/loading-rows";
import { LocationTabs } from "@/components/ui/location-tabs";
import { LevelBar } from "@/components/ui/level-bar";
import "@/components/ui/kpi-strip.css";

// Existencias por local: filtro por local, estado y texto; exportación CSV; último inventario cerrado.
// Filtros, orden y páginas se resuelven en el servidor (stock_search, migración 0020): la pantalla
// descarga solo la página que enseña y los totales ya calculados, no todo el stock de todos los locales.

const PAGE = 100;

type Status = "ok" | "low" | "critical";
type StockRow = {
  id: string;
  locationId: string;
  locationName: string;
  name: string;
  category: string;
  quantity: string;
  value: string;
  valueNumber: string;
  minimum: string;
  qty: number;
  min: number | null;
  status: Status;
};
/** Filtro de estado: «attention» es bajo mínimo + sin stock (migración 0038). */
type StatusFilter = "" | "attention" | "critical" | "ok";
const STATUS_TABS: Array<{ id: StatusFilter; label: string }> = [
  { id: "", label: "Todos" },
  { id: "attention", label: "Bajo mínimo" },
  { id: "critical", label: "Sin stock" },
  { id: "ok", label: "Correcto" },
];
type Location = { id: string; name: string };

type ValuationRow = {
  location_id: string;
  location_name: string | null;
  product_id: string;
  product_name: string;
  category_name: string | null;
  base_unit: string;
  qty: string;
  stock_value: string | null;
  min_qty: string | null;
  family_name: string | null;
  dimension: UnitDimension | null;
  count_pack_name: string | null;
  count_pack_qty: string | null;
  purchase_pack_name: string | null;
  purchase_pack_qty: string | null;
  status: Status;
};
type Summary = { rows: number; value: string; attention: number; critical?: number };
type SearchResult = { total: number; summary: Summary; items: ValuationRow[] };

function toRow(row: ValuationRow): StockRow {
  const packs = countingPacks(row);
  return {
    id: row.product_id,
    locationId: row.location_id,
    locationName: row.location_name ?? "",
    name: row.product_name,
    category: row.family_name && row.category_name ? `${row.family_name} · ${row.category_name}` : row.category_name ?? "Sin categoría",
    quantity: row.dimension ? formatStock(row.qty, packs) : quantity(row.qty, row.base_unit),
    value: euros(row.stock_value ?? "0"),
    valueNumber: new Decimal(row.stock_value ?? "0").toFixed(2),
    minimum: row.min_qty && new Decimal(row.min_qty).gt(0) ? (row.dimension ? formatStock(row.min_qty, packs) : quantity(row.min_qty, row.base_unit)) : "—",
    qty: Number(row.qty),
    min: row.min_qty === null ? null : Number(row.min_qty),
    status: row.status,
  };
}

async function searchStock(location: string, search: string, status: string, offset: number, limit = PAGE): Promise<SearchResult> {
  const supabase = createClient();
  if (!supabase) throw new Error("Configura las variables de Supabase para cargar el stock.");
  const { data, error } = await supabase.rpc("stock_search", {
    p_location: location || null,
    p_search: search.trim() || null,
    p_status: status || null,
    p_limit: limit,
    p_offset: offset,
  });
  if (error || !data) throw new Error("No se pudo cargar el stock del local seleccionado.");
  return data as unknown as SearchResult;
}

function countingPacks(row: ValuationRow): CountingPacks {
  return {
    dimension: row.dimension ?? "count",
    countPack: row.count_pack_name && row.count_pack_qty ? { name: row.count_pack_name, qtyBase: row.count_pack_qty } : null,
    purchasePack: row.purchase_pack_name && row.purchase_pack_qty ? { name: row.purchase_pack_name, qtyBase: row.purchase_pack_qty } : null,
  };
}

const STATUS_LABEL: Record<Status, string> = { ok: "Correcto", low: "Bajo mínimo", critical: "Sin stock" };

function exportCsv(rows: StockRow[], label: string) {
  const header = ["Producto", "Categoría", "Local", "Existencias", "Valor (€)", "Mínimo", "Estado"];
  const escape = (v: string) => (/[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  // Nombres escritos por usuarios: «=HYPERLINK(…)» se ejecutaría como fórmula al abrir el CSV en Excel.
  const text = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
  const lines = rows.map((r) => [text(r.name), text(r.category), text(r.locationName), r.quantity, r.valueNumber.replace(".", ","), r.minimum, STATUS_LABEL[r.status]].map(escape).join(";"));
  // BOM + ";" para que Excel en español lo abra con tildes y columnas correctas.
  const blob = new Blob([`﻿${[header.join(";"), ...lines].join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `stock-${label.toLowerCase().replace(/\s+/g, "-")}-${new Date().toLocaleDateString("sv-SE")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function StockPage() {
  const perms = usePermissions();
  const [location, setLocation] = useState<string | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [rows, setRows] = useState<StockRow[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [lastCount, setLastCount] = useState<{ at: string; location: string } | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const requestId = useRef(0);

  // Local inicial: ?local= (enlaces del resumen y del asistente) o el último elegido en el resumen.
  useEffect(() => {
    async function start() {
      await Promise.resolve();
      const params = new URLSearchParams(window.location.search);
      // ?estado=atencion: desde el Resumen y el menú («bajo mínimo»).
      const estado = params.get("estado");
      if (estado === "atencion" || estado === "low") setStatus("attention");
      else if (estado === "critical" || estado === "ok") setStatus(estado);
      setLocation(params.get("local") ?? readLocation());
      const supabase = createClient();
      const { data } = (await supabase?.from("locations").select("id, name").eq("active", true).order("name")) ?? { data: null };
      setLocations((data ?? []) as Location[]);
    }
    void start();
  }, []);

  // La búsqueda va al servidor cuando se deja de escribir un momento.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  // Último inventario cerrado: solo cambia con el local.
  useEffect(() => {
    if (location === null) return;
    const selected = location;
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      if (!supabase) return;
      let countQuery = supabase.from("inventory_counts").select("closed_at, locations(name)").eq("status", "closed").order("closed_at", { ascending: false }).limit(1);
      if (selected) countQuery = countQuery.eq("location_id", selected);
      const { data } = await countQuery;
      if (cancelled) return;
      const last = (data ?? [])[0] as { closed_at: string | null; locations: { name: string } | null } | undefined;
      setLastCount(last?.closed_at ? { at: last.closed_at, location: last.locations?.name ?? "" } : null);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [location, reloadKey]);

  // Primera página con los filtros actuales (cambiar un filtro vuelve a empezar).
  useEffect(() => {
    if (location === null) return;
    const id = ++requestId.current;
    async function run() {
      await Promise.resolve();
      setLoading(true);
      setError("");
      try {
        const result = await searchStock(location ?? "", search, status, 0);
        if (id !== requestId.current) return;
        setRows(result.items.map(toRow));
        setTotal(result.total);
        setSummary(result.summary);
      } catch (err) {
        if (id === requestId.current) setError(err instanceof Error ? err.message : "No se pudo cargar el stock.");
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }
    void run();
  }, [location, search, status, reloadKey]);

  async function loadMore() {
    const id = requestId.current;
    setLoadingMore(true);
    try {
      const result = await searchStock(location ?? "", search, status, rows.length);
      if (id !== requestId.current) return;
      setRows((current) => [...current, ...result.items.map(toRow)]);
      setTotal(result.total);
    } catch {
      setError("No se pudieron cargar más productos.");
    } finally {
      setLoadingMore(false);
    }
  }

  /** El CSV lleva todo lo filtrado, no solo lo que se ve: se pide por páginas grandes. */
  async function exportAll() {
    setExporting(true);
    try {
      const all: StockRow[] = [];
      for (let offset = 0; offset < Math.max(total, 1); offset += 500) {
        const result = await searchStock(location ?? "", search, status, offset, 500);
        all.push(...result.items.map(toRow));
        if (result.items.length < 500) break;
      }
      exportCsv(all, allLocations ? "todos" : locationLabel);
    } catch {
      setError("No se pudo exportar el stock.");
    } finally {
      setExporting(false);
    }
  }

  function changeLocation(id: string) {
    saveLocation(id);
    setLocation(id);
    syncUrl(id, status);
  }

  function changeStatus(next: StatusFilter) {
    setStatus(next);
    syncUrl(location ?? "", next);
  }

  /** La dirección refleja local y estado: se puede compartir o volver a ella. */
  function syncUrl(local: string, estado: StatusFilter) {
    const params = new URLSearchParams();
    if (local) params.set("local", local);
    if (estado) params.set("estado", estado === "attention" ? "atencion" : estado);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `/stock?${qs}` : "/stock");
  }

  const locationLabel = locations.find((l) => l.id === location)?.name ?? (locations.length === 1 ? locations[0]!.name : "todos los locales");
  const allLocations = !location;

  const seesCosts = !perms || perms.seesCosts;
  const multi = locations.length > 1;
  const showLocation = allLocations && multi;

  return (
    <main className="stock-page">
      <div className="stock-wrap">
        <header className="stock-head">
          <div>
            <h1>Stock</h1>
            <p className="stock-meta">Existencias, valor y nivel frente al mínimo · {allLocations && multi ? "todos los locales" : locationLabel}</p>
          </div>
          <button className="stock-export" disabled={total === 0 || exporting} onClick={() => void exportAll()}>
            <Download size={15} aria-hidden="true" /> {exporting ? "Exportando…" : "Exportar CSV"}
          </button>
        </header>

        {multi && <div className="stock-locations"><LocationTabs locations={locations} value={location ?? ""} onChange={changeLocation} /></div>}

        <section className="kpi-strip stock-kpis" aria-label="Totales">
          <div className="kpi">
            <span className="kpi-label">Valor total</span>
            <strong className="kpi-value">{!seesCosts ? "Sin permiso" : summary ? euros(summary.value) : "—"}</strong>
            <span className="kpi-note">a coste medio</span>
          </div>
          <div className="kpi">
            <span className="kpi-label">Productos con stock</span>
            <strong className="kpi-value">{summary ? summary.rows : "—"}</strong>
            <span className="kpi-note">{allLocations && multi ? "sumando todos los locales" : `en ${locationLabel}`}</span>
          </div>
          <button type="button" className="kpi" onClick={() => changeStatus("attention")}>
            <span className="kpi-label">Bajo mínimo</span>
            <strong className={`kpi-value${summary && summary.attention > 0 ? " alert" : ""}`}>{summary ? summary.attention : "—"}</strong>
            <span className="kpi-note">{summary?.critical ? <span className="warn">{summary.critical} sin stock</span> : "ver la lista"}</span>
          </button>
          <div className="kpi">
            <span className="kpi-label">Último inventario</span>
            <strong className="kpi-value">{lastCount ? new Date(lastCount.at).toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", "") : "Ninguno"}</strong>
            <span className="kpi-note">{lastCount ? `${daysAgo(lastCount.at)}${allLocations && lastCount.location ? ` · ${lastCount.location}` : ""}` : <Link href="/inventarios">Empezar un conteo</Link>}</span>
          </div>
        </section>

        <section className="stock-panel">
          <div className="stock-toolbar">
            <label className="stock-search">
              <Search size={16} aria-hidden="true" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto o categoría" aria-label="Buscar producto o categoría" />
            </label>
            <div className="stock-filter" role="tablist" aria-label="Estado">
              {STATUS_TABS.map((t) => (
                <button key={t.id || "all"} type="button" role="tab" aria-selected={status === t.id} className={status === t.id ? "on" : undefined} onClick={() => changeStatus(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
            <span className="stock-count">{loading ? "…" : `${total} ${total === 1 ? "producto" : "productos"}`}</span>
          </div>

          <div className={`stock-grid${showLocation ? " with-location" : ""}`}>
            <div className="stock-line stock-line-head">
              <span>Producto</span>
              {showLocation && <span>Local</span>}
              <span className="num">Existencias</span>
              <span className="num">Mínimo</span>
              <span>Nivel</span>
              <span className="num">Valor</span>
              <span />
            </div>
            {!loading && !error && rows.map((row) => (
              <Link className="stock-line" key={`${row.id}-${row.locationId}`} href={`/productos?producto=${row.id}`} title="Abrir ficha del producto">
                <span className="stock-name">
                  <b>{row.name}</b>
                  <small>{row.category}{showLocation && row.locationName ? <span className="stock-name-loc"> · {row.locationName}</span> : null}</small>
                </span>
                {showLocation && <span className="stock-loc">{row.locationName}</span>}
                <span className={`num strong${row.status === "critical" ? " zero" : ""}`}>{row.quantity}</span>
                <span className="num muted">{row.minimum}</span>
                <span className="stock-level">
                  <LevelBar qty={row.qty} min={row.min} status={row.status} />
                  {row.status !== "ok" && <small className={row.status}>{STATUS_LABEL[row.status]}</small>}
                </span>
                <span className="num muted">{seesCosts ? row.value : "—"}</span>
                <span className="stock-open" aria-hidden="true"><ChevronRight size={16} /></span>
              </Link>
            ))}
            {!loading && !error && rows.length === 0 && (
              <div className="stock-empty">
                <strong>{status || search ? "Nada coincide con el filtro" : "No hay stock para mostrar"}</strong>
                <span>{summary && summary.rows > 0 ? "Prueba otro filtro o limpia la búsqueda." : "Registra una recepción o una apertura de stock para empezar."}</span>
              </div>
            )}
            {!loading && !error && rows.length < total && (
              <button className="stock-more" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? "Cargando…" : `Ver ${Math.min(PAGE, total - rows.length)} más · ${rows.length} de ${total}`}
              </button>
            )}
            {loading && <LoadingRows label="Cargando stock" />}
            {!loading && error && (
              <div className="stock-empty">
                <strong>{error}</strong>
                <button className="stock-retry" onClick={() => setReloadKey((k) => k + 1)}>Reintentar</button>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
