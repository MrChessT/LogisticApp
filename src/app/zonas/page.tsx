"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Check, ChevronRight, MapPin, Pencil, Plus, Search, Star, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { euros, normalizeText } from "@/lib/format";
import { countingPacks, type PackRow } from "@/lib/packs";
import { usePermissions } from "@/lib/permissions";
import { managesTeam, type Role } from "@/lib/team";
import { formatStock, type UnitDimension } from "@/lib/units";
import "../productos/productos.css";
import "../productos/product-editor.css";
import "./zonas.css";
import { LoadingRows } from "@/components/ui/loading-rows";

// Zonas de cada local: dónde se guarda el género (almacén) y dónde se usa (servicio: barra, cocina…).
//   · Pulsar una zona abre lo que hay dentro, con cantidades y (si se ven costes) su valor, y los
//     productos que tienen esa zona como habitual aunque ahora no haya stock.
//   · «Editar» por local: renombrar, cambiar el tipo, ordenar (el orden es el recorrido del inventario y
//     de las listas) y archivar. Una zona con stock no se archiva (lo impide la base de datos).
// Las crean y editan los encargados de ese local y la administración (RLS); el personal solo las ve.

type Kind = "almacen" | "servicio";
type Zone = { id: string; locationId: string; locationName: string; name: string; kind: Kind; active: boolean; sortOrder: number; products: number; value: number };
type Item = { productId: string; name: string; qty: number; amount: string; value: number; habitual: boolean };

const KIND_LABEL: Record<Kind, string> = { almacen: "Almacén", servicio: "Servicio" };
const KIND_PLURAL: Record<Kind, string> = { almacen: "Almacenes", servicio: "Servicio" };
const KIND_HELP: Record<Kind, string> = {
  almacen: "Donde se guarda el género: de aquí sale hacia las zonas de servicio.",
  servicio: "Donde se usa o se vende: barra, cocina, terraza…",
};

function friendly(error: { message?: string; code?: string } | null): string {
  if (!error) return "";
  if (error.message?.includes("area_has_stock")) return "Esa zona aún tiene stock: muévelo o cuéntalo a cero antes de archivarla.";
  if (error.code === "23505") return "Ya hay una zona con ese nombre en el local.";
  if (error.code === "42501") return "No tienes permiso para cambiar las zonas de ese local.";
  return "No se pudo guardar el cambio.";
}

type ProductEmbed = { name: string; dimension: UnitDimension; product_packs: PackRow[] | null } | null;

export default function ZonesPage() {
  const [zones, setZones] = useState<Zone[] | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [error, setError] = useState("");
  const [editingLocation, setEditingLocation] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [adding, setAdding] = useState<{ locationId: string; name: string; kind: Kind } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openZone, setOpenZone] = useState<Zone | null>(null);
  const perms = usePermissions();

  async function reload() {
    const supabase = createClient();
    if (!supabase) return setError("Configura las variables de Supabase.");
    const userId = (await supabase.auth.getSession()).data.session?.user.id;
    const [{ data: me }, { data, error: err }] = await Promise.all([
      supabase.from("memberships").select("role").eq("user_id", userId ?? "").limit(1).maybeSingle(),
      supabase.from("v_storage_areas").select("*").order("location_name").order("sort_order").order("name"),
    ]);
    if (err) return setError("No se pudieron cargar las zonas.");
    setRole((me?.role ?? null) as Role | null);
    setZones(
      (data ?? []).map((z) => ({
        id: z.id,
        locationId: z.location_id,
        locationName: z.location_name,
        name: z.name,
        kind: z.kind,
        active: z.active,
        sortOrder: z.sort_order,
        products: Number(z.products),
        value: Number(z.stock_value),
      })),
    );
    setError("");
  }

  useEffect(() => {
    async function start() {
      await Promise.resolve();
      await reload();
    }
    void start();
  }, []);

  // Encargados y administración: los locales que ven son los que llevan (RLS).
  const canEdit = managesTeam(role);
  const showMoney = perms?.seesCosts ?? false;

  async function write(run: (s: NonNullable<ReturnType<typeof createClient>>) => PromiseLike<{ error: { message?: string; code?: string } | null }>) {
    const supabase = createClient();
    if (!supabase) return false;
    setBusy(true);
    const { error: err } = await run(supabase);
    setBusy(false);
    if (err) {
      setError(friendly(err));
      return false;
    }
    setError("");
    await reload();
    return true;
  }

  async function add() {
    if (!adding?.name.trim()) return;
    const max = Math.max(0, ...(zones ?? []).filter((z) => z.locationId === adding.locationId).map((z) => z.sortOrder));
    if (await write((s) => s.from("storage_areas").insert({ location_id: adding.locationId, name: adding.name.trim(), kind: adding.kind, sort_order: max + 1 }))) setAdding(null);
  }

  async function rename() {
    if (!renaming?.name.trim()) return;
    if (await write((s) => s.from("storage_areas").update({ name: renaming.name.trim() }).eq("id", renaming.id))) setRenaming(null);
  }

  /** Sube o baja una zona dentro de su grupo: se renumera el local entero (1, 2, 3…) para que no haya empates. */
  async function move(zone: Zone, direction: -1 | 1) {
    const ordered = (zones ?? []).filter((z) => z.locationId === zone.locationId).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    const group = ordered.filter((z) => z.kind === zone.kind && z.active);
    const i = group.findIndex((z) => z.id === zone.id);
    const other = group[i + direction];
    if (!other) return;
    const next = ordered.map((z) => (z.id === zone.id ? other : z.id === other.id ? zone : z));
    await write(async (s) => {
      for (const [index, z] of next.entries()) {
        if (z.sortOrder === index + 1) continue;
        const { error: err } = await s.from("storage_areas").update({ sort_order: index + 1 }).eq("id", z.id);
        if (err) return { error: err };
      }
      return { error: null };
    });
  }

  const locations = [...new Map((zones ?? []).map((z) => [z.locationId, z.locationName])).entries()];
  const archivedCount = (zones ?? []).filter((z) => !z.active).length;

  return (
    <main className="catalog-page">
      <div className="catalog-content">
        <div className="catalog-heading">
          <div>
            <p className="eyebrow">Gestión · Locales</p>
            <h1>Zonas</h1>
            <p className="catalog-subtitle">Dónde se guarda el género en cada local y dónde se usa. Pulsa una zona para ver qué hay dentro. El orden es el del recorrido al contar.</p>
          </div>
          {archivedCount > 0 && (
            <button className="filter-button" onClick={() => setShowArchived((v) => !v)}>
              <Archive size={14} /> {showArchived ? "Ocultar archivadas" : `Ver archivadas (${archivedCount})`}
            </button>
          )}
        </div>
        {error && <p className="editor-message error zones-message">{error}</p>}
        {!zones && !error && <LoadingRows label="Cargando zonas" />}

        <div className="zones-grid">
          {locations.map(([locationId, locationName]) => {
            const all = (zones ?? []).filter((z) => z.locationId === locationId);
            const list = all.filter((z) => z.active || showArchived).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
            const editing = editingLocation === locationId;
            const active = all.filter((z) => z.active);
            const totalValue = active.reduce((n, z) => n + z.value, 0);
            return (
              <section key={locationId} className={`catalog-panel zones-card ${editing ? "editing" : ""}`}>
                <header className="zones-card-head">
                  <MapPin size={16} />
                  <div>
                    <h2>{locationName}</h2>
                    <span>{active.length} {active.length === 1 ? "zona" : "zonas"}{showMoney && totalValue > 0 ? ` · ${euros(totalValue)}` : ""}</span>
                  </div>
                  {canEdit && (
                    <button className={`zones-edit-toggle ${editing ? "active" : ""}`} onClick={() => { setEditingLocation(editing ? null : locationId); setRenaming(null); setAdding(null); }}>
                      {editing ? <><Check size={13} /> Hecho</> : <><Pencil size={13} /> Editar</>}
                    </button>
                  )}
                </header>
                {(["almacen", "servicio"] as Kind[]).map((kind) => {
                  const group = list.filter((z) => z.kind === kind);
                  const activeGroup = group.filter((z) => z.active);
                  return (
                    <div key={kind} className="zones-group">
                      <p className="facet-title" title={KIND_HELP[kind]}>{KIND_PLURAL[kind]}</p>
                      {group.map((z) => {
                        const pos = activeGroup.findIndex((x) => x.id === z.id);
                        const summary = z.products > 0 ? `${z.products} ${z.products === 1 ? "producto" : "productos"}${showMoney ? ` · ${euros(z.value)}` : ""}` : "Vacía";
                        if (!editing) {
                          return (
                            <button key={z.id} className={`zones-row zones-open ${z.active ? "" : "archived"}`} onClick={() => setOpenZone(z)}>
                              <span className="zones-name"><b>{z.name}</b><small>{summary}{z.active ? "" : " · archivada"}</small></span>
                              <ChevronRight size={16} />
                            </button>
                          );
                        }
                        return (
                          <div key={z.id} className={`zones-row ${z.active ? "" : "archived"}`}>
                            {renaming?.id === z.id ? (
                              <form className="zones-rename" onSubmit={(event) => { event.preventDefault(); void rename(); }}>
                                <input autoFocus value={renaming.name} maxLength={60} onChange={(event) => setRenaming({ id: z.id, name: event.target.value })} aria-label="Nombre de la zona" />
                                <button type="submit" disabled={busy} aria-label="Guardar"><Check size={14} /></button>
                                <button type="button" onClick={() => setRenaming(null)} aria-label="Cancelar"><X size={14} /></button>
                              </form>
                            ) : (
                              <span className="zones-name"><b>{z.name}</b><small>{summary}{z.active ? "" : " · archivada"}</small></span>
                            )}
                            {renaming?.id !== z.id && (
                              <span className="zones-actions">
                                {z.active && (
                                  <>
                                    <button onClick={() => void move(z, -1)} disabled={busy || pos <= 0} aria-label={`Subir ${z.name}`} title="Subir"><ArrowUp size={13} /></button>
                                    <button onClick={() => void move(z, 1)} disabled={busy || pos < 0 || pos >= activeGroup.length - 1} aria-label={`Bajar ${z.name}`} title="Bajar"><ArrowDown size={13} /></button>
                                    <button onClick={() => setRenaming({ id: z.id, name: z.name })} aria-label={`Renombrar ${z.name}`} title="Renombrar"><Pencil size={13} /></button>
                                    <button
                                      onClick={() => void write((s) => s.from("storage_areas").update({ kind: z.kind === "almacen" ? "servicio" : "almacen" }).eq("id", z.id))}
                                      disabled={busy}
                                      title={KIND_HELP[z.kind === "almacen" ? "servicio" : "almacen"]}
                                    >
                                      Pasar a {KIND_LABEL[z.kind === "almacen" ? "servicio" : "almacen"].toLowerCase()}
                                    </button>
                                  </>
                                )}
                                <button
                                  onClick={() => void write((s) => s.from("storage_areas").update({ active: !z.active }).eq("id", z.id))}
                                  disabled={busy || (z.active && z.products > 0)}
                                  aria-label={z.active ? `Archivar ${z.name}` : `Restaurar ${z.name}`}
                                  title={z.active ? (z.products > 0 ? "Tiene stock: muévelo o cuéntalo a cero antes de archivarla" : "Archivar") : "Restaurar"}
                                >
                                  {z.active ? <Archive size={13} /> : <ArchiveRestore size={13} />}
                                </button>
                              </span>
                            )}
                          </div>
                        );
                      })}
                      {group.length === 0 && <p className="zones-empty">{kind === "almacen" ? "Ningún almacén: añade al menos uno." : "Ninguna zona de servicio."}</p>}
                    </div>
                  );
                })}
                {editing &&
                  (adding?.locationId === locationId ? (
                    <form className="zones-add-form" onSubmit={(event) => { event.preventDefault(); void add(); }}>
                      <input autoFocus value={adding.name} maxLength={60} placeholder="Ej. Cámara, Bodega, Terraza" onChange={(event) => setAdding({ ...adding, name: event.target.value })} aria-label="Nombre de la nueva zona" />
                      <div className="zones-kind" role="radiogroup" aria-label="Tipo de zona">
                        {(["almacen", "servicio"] as Kind[]).map((k) => (
                          <button key={k} type="button" role="radio" aria-checked={adding.kind === k} className={adding.kind === k ? "active" : ""} onClick={() => setAdding({ ...adding, kind: k })} title={KIND_HELP[k]}>
                            {KIND_LABEL[k]}
                          </button>
                        ))}
                      </div>
                      <p className="section-hint">{KIND_HELP[adding.kind]}</p>
                      <div className="zones-add-actions">
                        <button type="button" className="ghost-button" onClick={() => setAdding(null)}>Cancelar</button>
                        <button type="submit" className="catalog-primary" disabled={busy || !adding.name.trim()}>Añadir</button>
                      </div>
                    </form>
                  ) : (
                    <button className="zones-add" onClick={() => setAdding({ locationId, name: "", kind: "almacen" })}><Plus size={14} /> Añadir zona</button>
                  ))}
              </section>
            );
          })}
        </div>
        {!canEdit && zones && <p className="team-footnote zones-footnote">Las zonas las crean y editan los encargados y la administración.</p>}
      </div>
      {openZone && (
        <ZoneDetail
          zone={openZone}
          zones={(zones ?? []).filter((z) => z.locationId === openZone.locationId && z.active)}
          canEdit={canEdit}
          showMoney={showMoney}
          onClose={() => setOpenZone(null)}
          onChanged={() => void reload()}
        />
      )}
    </main>
  );
}

/** Lo que hay en una zona y los productos que la tienen como habitual. */
function ZoneDetail({ zone, zones, canEdit, showMoney, onClose, onChanged }: {
  zone: Zone; zones: Zone[]; canEdit: boolean; showMoney: boolean; onClose: () => void; onChanged: () => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  async function load() {
    const supabase = createClient();
    if (!supabase) return;
    const productCols = "name, dimension, product_packs(name, qty_base, is_count_default, is_purchase_default, active, is_serving)";
    const [stock, habitual] = await Promise.all([
      supabase.from("stock_area_balances").select(`product_id, qty, avg_cost, products(${productCols})`).eq("area_id", zone.id).neq("qty", 0).limit(2000),
      supabase.from("location_products").select(`product_id, products(${productCols})`).eq("location_id", zone.locationId).eq("default_area_id", zone.id).eq("active", true).limit(2000),
    ]);
    if (stock.error || habitual.error) return setError("No se pudo cargar lo que hay en la zona.");
    const habitualIds = new Set((habitual.data ?? []).map((r) => r.product_id as string));
    const toItem = (productId: string, p: ProductEmbed, qty: number, cost: number): Item => ({
      productId,
      name: p?.name ?? "Producto",
      qty,
      amount: p ? formatStock(qty, countingPacks(p.dimension, p.product_packs ?? [])) : String(qty),
      value: qty * cost,
      habitual: habitualIds.has(productId),
    });
    const inStock = (stock.data ?? []).map((r) => toItem(r.product_id as string, r.products as unknown as ProductEmbed, Number(r.qty), Number(r.avg_cost ?? 0)));
    const present = new Set(inStock.map((i) => i.productId));
    const empty = (habitual.data ?? []).filter((r) => !present.has(r.product_id as string)).map((r) => toItem(r.product_id as string, r.products as unknown as ProductEmbed, 0, 0));
    setItems([...inStock, ...empty].sort((a, b) => a.name.localeCompare(b.name, "es")));
    setError("");
  }

  useEffect(() => {
    async function start() {
      await Promise.resolve();
      await load();
    }
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** La zona habitual de un producto en el local: donde se guarda y por donde se cuenta. */
  async function setHabitual(item: Item, areaId: string | null) {
    const supabase = createClient();
    if (!supabase) return;
    setBusyId(item.productId);
    const { error: err } = await supabase.from("location_products").update({ default_area_id: areaId }).eq("location_id", zone.locationId).eq("product_id", item.productId);
    setBusyId("");
    if (err) return setError("No se pudo cambiar la zona habitual.");
    await load();
    onChanged();
  }

  const visible = useMemo(() => (items ?? []).filter((i) => !query || normalizeText(i.name).includes(normalizeText(query))), [items, query]);
  const withStock = (items ?? []).filter((i) => i.qty !== 0);
  const negatives = withStock.filter((i) => i.qty < 0).length;
  const total = withStock.reduce((n, i) => n + i.value, 0);

  return (
    <div className="editor-layer zones-layer" role="dialog" aria-modal="true" aria-label={`Zona ${zone.name}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="zones-drawer">
        <header className="zones-drawer-head">
          <div>
            <p className="eyebrow">{zone.locationName} · {KIND_LABEL[zone.kind]}</p>
            <h2>{zone.name}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </header>
        <div className="zones-drawer-stats">
          <div><span>Con stock</span><strong>{items ? withStock.length : "…"}</strong></div>
          <div><span>Valor</span><strong>{showMoney ? (items ? euros(total) : "…") : "Sin permiso"}</strong></div>
          <div><span>Habituales aquí</span><strong>{items ? items.filter((i) => i.habitual).length : "…"}</strong></div>
        </div>
        {negatives > 0 && <p className="editor-message error">{negatives} {negatives === 1 ? "producto tiene" : "productos tienen"} stock negativo en esta zona: se sacó más de lo que constaba. Conviene contarla.</p>}
        {error && <p className="editor-message error">{error}</p>}
        <div className="catalog-search zones-drawer-search">
          <Search size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar producto en esta zona" aria-label="Buscar producto en esta zona" />
        </div>
        <div className="zones-items">
          {!items && <p className="zones-empty">Cargando…</p>}
          {items && visible.length === 0 && <p className="zones-empty">{items.length === 0 ? "No hay nada en esta zona ni productos que la tengan como habitual." : "Ningún producto coincide."}</p>}
          {visible.map((i) => (
            <div key={i.productId} className={`zones-item ${i.qty < 0 ? "negative" : ""} ${i.qty === 0 ? "empty" : ""}`}>
              <Link href={`/productos?producto=${i.productId}`} className="zones-item-name" title="Abrir ficha del producto">
                <b>{i.name}</b>
                <small>{i.habitual ? <><Star size={11} /> Zona habitual</> : "Está aquí, pero su zona habitual es otra"}</small>
              </Link>
              <span className="zones-item-qty">
                <b>{i.qty === 0 ? "Sin stock" : i.amount}</b>
                {showMoney && i.qty !== 0 && <small>{euros(i.value)}</small>}
              </span>
              {canEdit && (
                i.habitual ? (
                  zones.length > 1 && (
                    <select
                      className="zones-item-move"
                      value={zone.id}
                      disabled={busyId === i.productId}
                      onChange={(e) => void setHabitual(i, e.target.value)}
                      aria-label={`Zona habitual de ${i.name}`}
                      title="Cambiar su zona habitual"
                    >
                      {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                    </select>
                  )
                ) : (
                  <button className="ghost-button" disabled={busyId === i.productId} onClick={() => void setHabitual(i, zone.id)} title="Que esta sea su zona habitual en el local">
                    <Star size={13} /> Habitual aquí
                  </button>
                )
              )}
            </div>
          ))}
        </div>
        <p className="section-hint zones-drawer-foot">
          La zona habitual es donde se guarda el producto: ahí entra lo que se recibe sin indicar zona. Lo que se consume sale de donde haya (primero de las zonas de servicio). Para subir género de un almacén a la barra usa <Link href="/almacen">Almacén</Link>.
        </p>
      </aside>
    </div>
  );
}
