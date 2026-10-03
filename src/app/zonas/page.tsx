"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, ArrowLeft, Check, MapPin, Pencil, Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { euros } from "@/lib/format";
import { managesTeam, type Role } from "@/lib/team";
import "../productos/productos.css";
import "./zonas.css";

// Zonas de cada local: de dónde sale el género (almacén) y a dónde va (barra, cocina…).
// Las crean y editan los encargados de ese local y la administración (RLS); el personal solo las ve.
// Una zona con stock no se archiva (lo impide la base de datos, migración 0022).

type Kind = "almacen" | "servicio";
type Zone = { id: string; locationId: string; locationName: string; name: string; kind: Kind; active: boolean; sortOrder: number; products: number; value: number };

const KIND_LABEL: Record<Kind, string> = { almacen: "Almacén", servicio: "Servicio" };
const KIND_HELP: Record<Kind, string> = { almacen: "Donde se guarda: de aquí salen las cosas", servicio: "Donde se usa: barra, cocina, terraza…" };

function friendly(error: { message?: string; code?: string } | null): string {
  if (!error) return "";
  if (error.message?.includes("area_has_stock")) return "Esa zona aún tiene stock: muévelo o cuéntalo a cero antes de archivarla.";
  if (error.code === "23505") return "Ya hay una zona con ese nombre en el local.";
  if (error.code === "42501") return "No tienes permiso para cambiar las zonas de ese local.";
  return "No se pudo guardar el cambio.";
}

export default function ZonesPage() {
  const [zones, setZones] = useState<Zone[] | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [adding, setAdding] = useState<{ locationId: string; name: string; kind: Kind } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);

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
    if (!editing?.name.trim()) return;
    if (await write((s) => s.from("storage_areas").update({ name: editing.name.trim() }).eq("id", editing.id))) setEditing(null);
  }

  const locations = [...new Map((zones ?? []).map((z) => [z.locationId, z.locationName])).entries()];
  const archivedCount = (zones ?? []).filter((z) => !z.active).length;

  return (
    <main className="catalog-page">
      <header className="catalog-topbar">
        <Link href="/" className="back-link"><ArrowLeft size={16} /> Resumen</Link>
        <span className="catalog-title">Zonas</span>
        <span />
      </header>
      <div className="catalog-content">
        <div className="catalog-heading">
          <div>
            <p className="eyebrow">Gestión · Locales</p>
            <h1>Zonas</h1>
            <p className="catalog-subtitle">Dónde se guarda el género en cada local y a dónde va. La pantalla del almacén saca de un almacén hacia una zona de servicio.</p>
          </div>
          {archivedCount > 0 && (
            <button className="filter-button" onClick={() => setShowArchived((v) => !v)}>
              <Archive size={14} /> {showArchived ? "Ocultar archivadas" : `Ver archivadas (${archivedCount})`}
            </button>
          )}
        </div>
        {error && <p className="editor-message error zones-message">{error}</p>}
        {!zones && !error && <div className="catalog-empty"><strong>Cargando zonas...</strong></div>}

        <div className="zones-grid">
          {locations.map(([locationId, locationName]) => {
            const list = (zones ?? []).filter((z) => z.locationId === locationId && (z.active || showArchived));
            return (
              <section key={locationId} className="catalog-panel zones-card">
                <header className="zones-card-head">
                  <MapPin size={16} />
                  <h2>{locationName}</h2>
                  <span>{list.filter((z) => z.active).length} zonas</span>
                </header>
                {(["almacen", "servicio"] as Kind[]).map((kind) => (
                  <div key={kind} className="zones-group">
                    <p className="facet-title" title={KIND_HELP[kind]}>{kind === "almacen" ? "Almacenes" : "Servicio"}</p>
                    {list.filter((z) => z.kind === kind).map((z) => (
                      <div key={z.id} className={`zones-row ${z.active ? "" : "archived"}`}>
                        {editing?.id === z.id ? (
                          <form className="zones-rename" onSubmit={(event) => { event.preventDefault(); void rename(); }}>
                            <input autoFocus value={editing.name} maxLength={60} onChange={(event) => setEditing({ id: z.id, name: event.target.value })} aria-label="Nombre de la zona" />
                            <button type="submit" disabled={busy} aria-label="Guardar"><Check size={14} /></button>
                            <button type="button" onClick={() => setEditing(null)} aria-label="Cancelar"><X size={14} /></button>
                          </form>
                        ) : (
                          <span className="zones-name">
                            <b>{z.name}</b>
                            <small>{z.products > 0 ? `${z.products} productos · ${euros(z.value)}` : "Vacía"}{z.active ? "" : " · archivada"}</small>
                          </span>
                        )}
                        {canEdit && editing?.id !== z.id && (
                          <span className="zones-actions">
                            {z.active && <button onClick={() => setEditing({ id: z.id, name: z.name })} aria-label={`Renombrar ${z.name}`} title="Renombrar"><Pencil size={13} /></button>}
                            {z.active && (
                              <button
                                onClick={() => void write((s) => s.from("storage_areas").update({ kind: z.kind === "almacen" ? "servicio" : "almacen" }).eq("id", z.id))}
                                disabled={busy}
                                title={`Pasar a ${KIND_LABEL[z.kind === "almacen" ? "servicio" : "almacen"].toLowerCase()}`}
                              >
                                {z.kind === "almacen" ? "→ Servicio" : "→ Almacén"}
                              </button>
                            )}
                            <button
                              onClick={() => void write((s) => s.from("storage_areas").update({ active: !z.active }).eq("id", z.id))}
                              disabled={busy || (z.active && z.products > 0)}
                              aria-label={z.active ? `Archivar ${z.name}` : `Restaurar ${z.name}`}
                              title={z.active ? (z.products > 0 ? "Tiene stock: no se puede archivar" : "Archivar") : "Restaurar"}
                            >
                              {z.active ? <Archive size={13} /> : <ArchiveRestore size={13} />}
                            </button>
                          </span>
                        )}
                      </div>
                    ))}
                    {list.filter((z) => z.kind === kind).length === 0 && <p className="zones-empty">Ninguna</p>}
                  </div>
                ))}
                {canEdit &&
                  (adding?.locationId === locationId ? (
                    <form className="zones-add-form" onSubmit={(event) => { event.preventDefault(); void add(); }}>
                      <input autoFocus value={adding.name} maxLength={60} placeholder="Ej. Cocina, Cámara, Terraza" onChange={(event) => setAdding({ ...adding, name: event.target.value })} aria-label="Nombre de la nueva zona" />
                      <div className="zones-kind" role="radiogroup" aria-label="Tipo de zona">
                        {(["almacen", "servicio"] as Kind[]).map((k) => (
                          <button key={k} type="button" role="radio" aria-checked={adding.kind === k} className={adding.kind === k ? "active" : ""} onClick={() => setAdding({ ...adding, kind: k })} title={KIND_HELP[k]}>
                            {KIND_LABEL[k]}
                          </button>
                        ))}
                      </div>
                      <div className="zones-add-actions">
                        <button type="button" className="ghost-button" onClick={() => setAdding(null)}>Cancelar</button>
                        <button type="submit" className="catalog-primary" disabled={busy || !adding.name.trim()}>Añadir</button>
                      </div>
                    </form>
                  ) : (
                    <button className="zones-add" onClick={() => setAdding({ locationId, name: "", kind: "servicio" })}><Plus size={14} /> Añadir zona</button>
                  ))}
              </section>
            );
          })}
        </div>
        {!canEdit && zones && <p className="team-footnote zones-footnote">Las zonas las crean y editan los encargados y la administración.</p>}
      </div>
    </main>
  );
}
