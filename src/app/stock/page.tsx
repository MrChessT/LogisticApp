"use client";

import { useEffect, useRef, useState } from "react";
import Decimal from "decimal.js";
import { ArrowLeft, ChevronDown, ChevronRight, Download, Filter, Search, Warehouse } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { usePermissions } from "@/lib/permissions";
import { daysAgo, euros, quantity } from "@/lib/format";
import { readLocation, saveLocation } from "@/lib/location-preference";
import { formatStock, type CountingPacks, type UnitDimension } from "@/lib/units";
import "../productos/productos.css";
import "./stock.css";

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
  status: Status;
};
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
type Summary = { rows: number; value: string; attention: number };
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

const STATUS_LABEL: Record<Status, string> = { ok: "Correcto", low: "Bajo mínimo", critical: "Urgente" };

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
  const [status, setStatus] = useState<"" | Status>("");
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
      const fromUrl = new URLSearchParams(window.location.search).get("local");
      setLocation(fromUrl ?? readLocation());
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
    window.history.replaceState(null, "", id ? `/stock?local=${id}` : "/stock");
    setLocation(id);
  }

  const locationLabel = locations.find((l) => l.id === location)?.name ?? (locations.length === 1 ? locations[0]!.name : "todos los locales");
  const allLocations = !location;

  return (
    <main className="stock-page">
      <header className="catalog-topbar">
        <Link href="/" className="back-link">
          <ArrowLeft size={16} /> Resumen
        </Link>
        <span className="catalog-title">Stock</span>
        <span />
      </header>
      <div className="catalog-content">
        <div className="catalog-heading">
          <div>
            <p className="eyebrow">Existencias · {allLocations && locations.length !== 1 ? "Todos los locales" : locationLabel}</p>
            <h1>Stock</h1>
            <p className="catalog-subtitle">Lo que tienes, lo que vale y lo que está por debajo del mínimo.</p>
          </div>
          <div className="stock-heading-actions">
            <div className="stock-location">
              <Warehouse size={16} />
              <select value={location ?? ""} onChange={(event) => changeLocation(event.target.value)} aria-label="Local">
                {/* Con un único local, «todos» es ese local: no se repite. */}
                <option value="">{locations.length === 1 ? locations[0]!.name : "Todos los locales"}</option>
                {locations.length > 1 && locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
              <ChevronDown size={14} />
            </div>
            <button className="export-button" disabled={total === 0 || exporting} onClick={() => void exportAll()}>
              <Download size={15} /> {exporting ? "Exportando..." : "Exportar"}
            </button>
          </div>
        </div>
        <div className="stock-summary">
          <div>
            <span>Valor total</span>
            <strong>{perms && !perms.seesCosts ? "Sin permiso" : summary ? euros(summary.value) : "..."}</strong>
            <small>a coste medio</small>
          </div>
          <div>
            <span>Productos con stock</span>
            <strong>{summary ? summary.rows : "..."}</strong>
            <small>en {locationLabel}</small>
          </div>
          <div>
            <span>Bajo mínimo</span>
            <strong className="red-text">{summary ? summary.attention : "..."}</strong>
            <small>requieren revisión</small>
          </div>
          <div>
            <span>Último inventario</span>
            <strong>{lastCount ? new Date(lastCount.at).toLocaleDateString("es-ES", { day: "numeric", month: "short" }) : "Ninguno"}</strong>
            <small>{lastCount ? `${daysAgo(lastCount.at)}${allLocations && lastCount.location ? ` · ${lastCount.location}` : ""}` : <Link href="/inventarios">Empezar un conteo</Link>}</small>
          </div>
        </div>
        <section className="catalog-panel stock-table-panel">
          <div className="catalog-toolbar">
            <div className="catalog-search">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto o categoría" />
            </div>
            <label className="filter-button">
              <Filter size={14} />
              <select className="stock-status-filter" value={status} onChange={(event) => setStatus(event.target.value as "" | Status)} aria-label="Estado">
                <option value="">Todos los estados</option>
                <option value="low">Bajo mínimo</option>
                <option value="critical">Urgente (sin stock)</option>
                <option value="ok">Correcto</option>
              </select>
            </label>
            <span className="table-result-count">{loading ? "..." : `${total} productos`}</span>
          </div>
          <div className="stock-table">
            <div className="stock-head">
              <span>Producto</span>
              <span>Existencias</span>
              <span>Valor</span>
              <span>Mínimo</span>
              <span>Estado</span>
              <span />
            </div>
            {!loading && !error && rows.map((row) => (
              <Link className="stock-data-row" key={`${row.id}-${row.locationId}`} href={`/productos?producto=${row.id}`} title="Abrir ficha del producto">
                <div className="stock-product">
                  <span className={`stock-thumb ${row.status}`} />
                  <span>
                    <strong>{row.name}</strong>
                    <small>{row.category}{allLocations && row.locationName ? ` · ${row.locationName}` : ""}</small>
                  </span>
                </div>
                <strong>{row.quantity}</strong>
                <span>{perms?.seesCosts ? row.value : "—"}</span>
                <span>{row.minimum}</span>
                <span className={`stock-status ${row.status}`}>{STATUS_LABEL[row.status]}</span>
                <span className="stock-open" aria-hidden="true"><ChevronRight size={17} /></span>
              </Link>
            ))}
            {!loading && !error && rows.length === 0 && (
              <div className="catalog-empty">
                <strong>No hay stock para mostrar</strong>
                <span>{summary && summary.rows > 0 ? "Prueba otro filtro o limpia la búsqueda." : "Registra una recepción o una apertura de stock para empezar."}</span>
              </div>
            )}
            {!loading && !error && rows.length < total && (
              <button className="stock-more" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? "Cargando..." : `Ver ${Math.min(PAGE, total - rows.length)} más (${rows.length} de ${total})`}
              </button>
            )}
            {loading && <div className="catalog-empty"><strong>Cargando stock...</strong></div>}
            {!loading && error && (
              <div className="catalog-empty">
                <strong>{error}</strong>
                <button className="filter-button" onClick={() => setReloadKey((k) => k + 1)}>Reintentar</button>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
