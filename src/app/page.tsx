"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Decimal from "decimal.js";
import { ChevronRight, ClipboardList, PackageCheck, Truck, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { usePermissions } from "@/lib/permissions";
import { euros, localDay, quantity } from "@/lib/format";
import { formatStock, type UnitDimension } from "@/lib/units";
import { readLocation, saveLocation } from "@/lib/location-preference";
import { loadIdentity, type Identity } from "@/lib/identity";
import { LocationTabs } from "@/components/ui/location-tabs";
import { LevelBar } from "@/components/ui/level-bar";
import "@/components/ui/kpi-strip.css";
import "./home.css";

// Resumen de inicio: lo que hay que hacer hoy y cómo va el inventario. Todo sale de la base de datos
// (con RLS) y se filtra por local.

type MovementType = "opening" | "purchase" | "consumption" | "waste" | "transfer_out" | "transfer_in" | "count_adjustment" | "manual_adjustment" | "internal_move";

const MOVEMENT_LABEL: Record<MovementType, string> = {
  purchase: "Recepción",
  transfer_in: "Traspaso recibido",
  transfer_out: "Traspaso enviado",
  waste: "Merma",
  count_adjustment: "Ajuste de inventario",
  manual_adjustment: "Ajuste manual",
  opening: "Apertura",
  consumption: "Consumo",
  internal_move: "Movimiento entre zonas",
};

/** Color del punto de cada movimiento: entradas en verde, salidas en gris, mermas y ajustes en ámbar. */
const MOVEMENT_TONE: Record<MovementType, "in" | "out" | "adjust"> = {
  purchase: "in",
  transfer_in: "in",
  opening: "in",
  consumption: "out",
  transfer_out: "out",
  internal_move: "out",
  waste: "adjust",
  count_adjustment: "adjust",
  manual_adjustment: "adjust",
};

type LowRow = { key: string; name: string; where: string; stock: string; minimum: string; qty: number; min: number | null; status: "low" | "critical" };
type Activity = { id: number; type: MovementType; product: string; location: string; when: string; qty: string };
type Pending = { label: string; count: number; detail?: string; href: string; tone?: "warn" };

type HomeData = {
  stockValue: string;
  attention: number;
  critical: number;
  weekOut: string | null;
  weekChange: number | null;
  bars: number[];
  openOrders: number;
  lateOrders: number;
  low: LowRow[];
  pending: Pending[];
  activity: Activity[];
};

type BrowserClient = NonNullable<ReturnType<typeof createClient>>;

type ValuationRow = {
  location_id: string;
  location_name: string | null;
  product_id: string;
  product_name: string;
  category_name: string | null;
  base_unit: string;
  qty: number;
  min_qty: number | null;
  dimension: UnitDimension | null;
  count_pack_name: string | null;
  count_pack_qty: number | null;
  purchase_pack_name: string | null;
  purchase_pack_qty: number | null;
};

function amount(row: ValuationRow, value: number) {
  if (!row.dimension) return quantity(value, row.base_unit);
  return formatStock(value, {
    dimension: row.dimension,
    countPack: row.count_pack_name && row.count_pack_qty ? { name: row.count_pack_name, qtyBase: String(row.count_pack_qty) } : null,
    purchasePack: row.purchase_pack_name && row.purchase_pack_qty ? { name: row.purchase_pack_name, qtyBase: String(row.purchase_pack_qty) } : null,
  });
}

function shortTime(iso: string) {
  const when = new Date(iso);
  const time = when.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (localDay(when) === localDay(new Date())) return `Hoy ${time}`;
  if (localDay(when) === localDay(yesterday)) return `Ayer ${time}`;
  return `${when.toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", "")} ${time}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

async function loadHome(supabase: BrowserClient, locationId: string): Promise<HomeData | null> {
  // Dos semanas completas hasta ayer: hoy aún no ha terminado y compararlo con un día entero engaña.
  const days: string[] = [];
  for (let i = 14; i >= 1; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(localDay(d));
  }
  const today = localDay(new Date());
  const byLocation = <T extends { eq: (column: string, value: string) => T }>(q: T, column = "location_id") => (locationId ? q.eq(column, locationId) : q);

  const [summary, usage, low, movements, transfers, moves, orders] = await Promise.all([
    supabase.rpc("stock_summary", { p_location: locationId || null }),
    supabase.rpc("usage_by_business_day", { p_since: days[0]!, p_location: locationId || null }),
    // Bajo mínimo, primero lo que está a cero.
    byLocation(
      supabase
        .from("v_stock_valuation")
        .select("location_id, location_name, product_id, product_name, category_name, base_unit, qty, min_qty, dimension, count_pack_name, count_pack_qty, purchase_pack_name, purchase_pack_qty")
        .eq("below_min", true),
    )
      .order("qty", { ascending: true })
      .order("product_name")
      .limit(8),
    byLocation(supabase.from("stock_movements").select("id, type, qty, occurred_at, products(name, base_unit, dimension, product_packs(name, qty_base, is_count_default, is_purchase_default)), locations(name)")).order("occurred_at", { ascending: false }).limit(8),
    locationId
      ? supabase.from("transfers").select("id", { count: "exact", head: true }).in("status", ["draft", "in_transit"]).or(`from_location_id.eq.${locationId},to_location_id.eq.${locationId}`)
      : supabase.from("transfers").select("id", { count: "exact", head: true }).in("status", ["draft", "in_transit"]),
    byLocation(supabase.from("area_moves").select("id", { count: "exact", head: true }).eq("status", "pending")),
    byLocation(supabase.from("purchase_orders").select("status, expected_date").in("status", ["draft", "sent", "partial"])).limit(1000),
  ]);
  const totals = summary.data?.[0];
  if (summary.error || !totals || usage.error || low.error) return null;

  const byDay = new Map<string, number>();
  for (const row of (usage.data ?? []) as Array<{ business_day: string; value: number | null }>) byDay.set(row.business_day, (byDay.get(row.business_day) ?? 0) + Math.abs(row.value ?? 0));
  const lastWeek = days.slice(7).map((d) => byDay.get(d) ?? 0);
  const previousWeek = days.slice(0, 7).map((d) => byDay.get(d) ?? 0);
  const lastTotal = lastWeek.reduce((a, b) => a + b, 0);
  const previousTotal = previousWeek.reduce((a, b) => a + b, 0);

  const orderRows = (orders.data ?? []) as Array<{ status: string; expected_date: string | null }>;
  const open = orderRows.filter((o) => o.status !== "draft");
  const late = open.filter((o) => o.expected_date && o.expected_date < today).length;
  const drafts = orderRows.length - open.length;

  const pending: Pending[] = [
    { label: "Pedidos que llegan tarde", count: late, href: "/pedidos", tone: "warn" as const },
    { label: "Salidas de almacén por validar", count: moves.count ?? 0, href: locationId ? `/almacen?local=${locationId}` : "/almacen" },
    { label: "Traspasos sin cerrar", count: transfers.count ?? 0, href: "/traspasos" },
    { label: "Pedidos en borrador", count: drafts, detail: "sin enviar al proveedor", href: "/pedidos?estado=draft" },
  ].filter((p) => p.count > 0);

  type MovementProduct = { name: string; base_unit: string; dimension: UnitDimension | null; product_packs: Array<{ name: string; qty_base: number; is_count_default: boolean; is_purchase_default: boolean }> | null };
  const movementRows = (movements.data ?? []) as unknown as Array<{ id: number; type: MovementType; qty: number; occurred_at: string; products: MovementProduct | null; locations: { name: string } | null }>;
  /** «+6 botellas», «−1 ud»: la cantidad del movimiento en el formato del producto. */
  const movedQty = (qty: number, p: MovementProduct | null) => {
    const sign = qty > 0 ? "+" : qty < 0 ? "−" : "";
    const abs = Math.abs(Number(qty));
    if (!p) return `${sign}${abs}`;
    const packs = p.product_packs ?? [];
    const count = packs.find((k) => k.is_count_default);
    const purchase = packs.find((k) => k.is_purchase_default);
    const text = p.dimension
      ? formatStock(abs, {
          dimension: p.dimension,
          countPack: count ? { name: count.name, qtyBase: String(count.qty_base) } : null,
          purchasePack: purchase ? { name: purchase.name, qtyBase: String(purchase.qty_base) } : null,
        })
      : quantity(abs, p.base_unit);
    return `${sign}${text}`;
  };

  return {
    stockValue: euros(new Decimal(String(totals.total_value ?? 0))),
    attention: Number(totals.below_min_count),
    critical: Number(totals.critical_count),
    weekOut: lastTotal > 0 || previousTotal > 0 ? euros(lastTotal.toFixed(2)) : null,
    weekChange: previousTotal > 0 ? ((lastTotal - previousTotal) / previousTotal) * 100 : null,
    bars: lastWeek,
    openOrders: open.length,
    lateOrders: late,
    low: ((low.data ?? []) as unknown as ValuationRow[]).map((row) => {
      const qty = Number(row.qty ?? 0);
      const min = row.min_qty === null ? null : Number(row.min_qty);
      return {
        key: `${row.location_id}-${row.product_id}`,
        name: row.product_name,
        where: locationId ? row.category_name ?? "Sin categoría" : row.location_name ?? "",
        stock: amount(row, qty),
        minimum: min ? amount(row, min) : "—",
        qty,
        min,
        status: qty <= 0 ? "critical" : "low",
      };
    }),
    pending,
    activity: movementRows.map((m) => ({ id: m.id, type: m.type, product: m.products?.name ?? "Producto", location: m.locations?.name ?? "", when: shortTime(m.occurred_at), qty: movedQty(m.qty, m.products) })),
  };
}

export default function Home() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  // Sin «ve costes» no se enseñan importes (la base de datos ya no da precios de compra).
  const perms = usePermissions();
  const seesCosts = !perms || perms.seesCosts;
  const [location, setLocation] = useState("");
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [today, setToday] = useState("");
  const requestId = useRef(0);

  // Identidad y locales una sola vez; el local elegido se recuerda en este navegador.
  useEffect(() => {
    async function start() {
      await Promise.resolve();
      const label = new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
      setToday(label.charAt(0).toUpperCase() + label.slice(1));
      if (!createClient()) {
        setError("Configura las variables de Supabase para cargar el resumen.");
        setLoading(false);
        return;
      }
      const loaded = await loadIdentity();
      if (!loaded) {
        setError("Tu usuario aún no tiene acceso a ninguna organización. Pide a un administrador que te dé acceso.");
        setLoading(false);
        return;
      }
      setIdentity(loaded);
      const stored = readLocation();
      // Con un solo local no hay «todos»: se abre directamente el suyo.
      setLocation(loaded.locations.length === 1 ? loaded.locations[0]!.id : loaded.locations.some((l) => l.id === stored) ? stored : "");
    }
    void start();
  }, []);

  useEffect(() => {
    if (!identity) return;
    const id = ++requestId.current;
    async function run() {
      await Promise.resolve();
      setLoading(true);
      const supabase = createClient();
      const result = supabase ? await loadHome(supabase, location) : null;
      if (id !== requestId.current) return;
      setData(result);
      setError(result ? "" : "No se pudo cargar el resumen. Revisa la conexión e inténtalo de nuevo.");
      setLoading(false);
    }
    void run();
  }, [identity, location]);

  function changeLocation(id: string) {
    saveLocation(id);
    setLocation(id);
  }

  const locationName = identity?.locations.find((l) => l.id === location)?.name;
  const withLocal = (path: string) => (location ? `${path}${path.includes("?") ? "&" : "?"}local=${location}` : path);
  const show = (text: string | null | undefined) => (loading && !data ? "—" : text ?? "Sin datos");
  const maxBar = Math.max(...(data?.bars ?? [0]), 0.01);
  const allLabel = identity && ["owner", "admin"].includes(identity.roleKey) ? "Todos" : "Mis locales";

  return (
    <main className="home">
      <header className="home-head">
        <div>
          <h1>Panel</h1>
          <p className="home-meta">
            {today}
            {identity ? ` · ${locationName ?? (identity.locations.length === 1 ? identity.locations[0]!.name : allLabel === "Todos" ? "Todos los locales" : "Tus locales")}` : ""}
          </p>
        </div>
        <nav className="home-actions" aria-label="Registrar">
          <Link href="/recepciones"><PackageCheck size={16} aria-hidden="true" />Recepción</Link>
          <Link href="/traspasos"><Truck size={16} aria-hidden="true" />Traspaso</Link>
          <Link href="/mermas"><XCircle size={16} aria-hidden="true" />Merma</Link>
          <Link href="/inventarios"><ClipboardList size={16} aria-hidden="true" />Inventario</Link>
        </nav>
      </header>

      {identity && <div className="home-locations"><LocationTabs locations={identity.locations} value={location} onChange={changeLocation} allLabel={allLabel} /></div>}

      {error && <p className="home-error" role="alert">{error}</p>}

      <section className="kpi-strip" aria-label="Cifras">
        <div className="kpi">
          <span className="kpi-label">Valor del stock</span>
          <strong className="kpi-value">{seesCosts ? show(data?.stockValue) : "Sin permiso"}</strong>
          <span className="kpi-note">a coste medio</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Salidas · últimos 7 días</span>
          <strong className="kpi-value">{seesCosts ? show(data ? data.weekOut : undefined) : "Sin permiso"}</strong>
          <span className="kpi-note">
            {data?.weekChange != null ? (
              <><span className={data.weekChange > 0 ? "up" : "down"}>{data.weekChange > 0 ? "+" : "−"}{Math.abs(data.weekChange).toFixed(0)} %</span> frente a la semana anterior</>
            ) : (
              "consumo, mermas y ajustes"
            )}
          </span>
          {/* Con menos de 3 días con salidas la minigráfica no dice nada (una barra suelta): fuera. */}
          {seesCosts && data && data.weekOut && data.bars.filter((v) => v > 0).length >= 3 && (
            <span className="kpi-spark" aria-hidden="true">
              {data.bars.map((v, i) => <i key={i} style={{ height: `${Math.max((v / maxBar) * 100, 6)}%` }} />)}
            </span>
          )}
        </div>
        <Link className="kpi" href={withLocal("/stock?estado=atencion")}>
          <span className="kpi-label">Bajo mínimo</span>
          <strong className={`kpi-value${data && data.attention > 0 ? " alert" : ""}`}>{show(data ? String(data.attention) : undefined)}<small>productos</small></strong>
          <span className="kpi-note">{data ? (data.critical > 0 ? <span className="warn">{plural(data.critical, "sin stock", "sin stock")}</span> : "ninguno a cero") : " "}</span>
        </Link>
        <Link className="kpi" href="/pedidos">
          <span className="kpi-label">Pedidos por recibir</span>
          <strong className="kpi-value">{show(data ? String(data.openOrders) : undefined)}</strong>
          <span className="kpi-note">{data ? (data.lateOrders > 0 ? <span className="warn">{plural(data.lateOrders, "llega tarde", "llegan tarde")}</span> : data.openOrders > 0 ? "todos en plazo" : "nada pendiente") : " "}</span>
        </Link>
      </section>

      <div className="home-grid">
        <section className="home-panel">
          <div className="home-panel-head">
            <h2>Bajo mínimo{data && data.attention > 0 ? <span className="count">{data.attention}</span> : null}</h2>
            <div className="home-panel-actions">
              <Link href={withLocal("/stock?estado=atencion")} className="link">Ver todo</Link>
              {data && data.attention > 0 && <Link href={withLocal("/pedidos?sugerir=1")} className="button">Preparar pedido</Link>}
            </div>
          </div>
          <div className="low-table" role="table" aria-label="Productos bajo mínimo">
            <div className="low-row low-headrow" role="row">
              <span role="columnheader">Producto</span>
              <span role="columnheader">Hay</span>
              <span role="columnheader">Mínimo</span>
              <span role="columnheader">Nivel</span>
            </div>
            {data?.low.map((row) => (
              <div className="low-row" role="row" key={row.key}>
                <span role="cell" className="low-name"><b>{row.name}</b><small>{row.where}</small></span>
                <span role="cell" className={row.status === "critical" ? "zero" : undefined}>{row.status === "critical" ? "Sin stock" : row.stock}</span>
                <span role="cell" className="muted">{row.minimum}</span>
                <span role="cell"><LevelBar qty={row.qty} min={row.min} status={row.status} /></span>
              </div>
            ))}
            {data && data.low.length === 0 && <p className="home-empty">Todo está por encima del mínimo{locationName ? ` en ${locationName}` : ""}.</p>}
            {!data && loading && <p className="home-empty">Cargando…</p>}
          </div>
        </section>

        <div className="home-side">
          <section className="home-panel home-pending">
            <div className="home-panel-head"><h2>Pendiente</h2></div>
            {data && data.pending.length === 0 && <p className="home-empty">Nada pendiente.</p>}
            {!data && loading && <p className="home-empty">Cargando…</p>}
            {data && data.pending.length > 0 && (
              <ul className="pending-list">
                {data.pending.map((p) => (
                  <li key={p.label}>
                    <Link href={p.href}>
                      <span className={`pending-count${p.tone === "warn" ? " warn" : ""}`}>{p.count}</span>
                      <span className="pending-copy">{p.label}{p.detail && <small>{p.detail}</small>}</span>
                      <ChevronRight size={15} aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="home-panel">
            <div className="home-panel-head">
              <h2>Últimos movimientos</h2>
              <div className="home-panel-actions"><Link href={withLocal("/informes?vista=consumo")} className="link">Informes</Link></div>
            </div>
            {data && data.activity.length === 0 && <p className="home-empty">Todavía no hay movimientos.</p>}
            {!data && loading && <p className="home-empty">Cargando…</p>}
            {data && data.activity.length > 0 && (
              <ul className="activity">
                {data.activity.map((a) => (
                  <li key={a.id}>
                    <span className={`dot ${MOVEMENT_TONE[a.type]}`} aria-hidden="true" />
                    <span className="activity-text">
                      <b>{a.product}</b>
                      <small>{MOVEMENT_LABEL[a.type]}{!location && a.location ? ` · ${a.location}` : ""}</small>
                    </span>
                    <span className="activity-side">
                      <span className={`activity-qty ${MOVEMENT_TONE[a.type]}`}>{a.qty}</span>
                      <time>{a.when}</time>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
