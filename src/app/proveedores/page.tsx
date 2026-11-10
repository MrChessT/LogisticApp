"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, CirclePlus, Search, Trash2, Truck, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { euros, normalizeText } from "@/lib/format";
import { describeTerms, nextDelivery, formatDayLong, shortDays, WEEKDAYS } from "@/lib/supplier-terms";
import Decimal from "decimal.js";
import "../productos/productos.css";
import "../productos/product-editor.css";
import { EntityHistory } from "../productos/product-history";
import "./proveedores.css";
import { LoadingRows } from "@/components/ui/loading-rows";

// Proveedores: alta, edición, archivar y eliminar, con los últimos precios que tiene cada uno.
// Los permisos los decide RLS (encargado o superior para escribir).

type Price = { price: number | null; at: string | null; pack: string; product: string; productId: string };
type Supplier = {
  id: string;
  name: string;
  taxId: string;
  email: string;
  phone: string;
  notes: string;
  code: string;
  contactName: string;
  /** Condiciones de pedido: días (1 lunes … 7 domingo), hora límite, plazo, mínimo, pago y locales. */
  orderDays: number[];
  orderCutoff: string;
  leadTimeHours: string;
  minOrder: string;
  paymentTerms: string;
  locationIds: string[];
  active: boolean;
  /** Resumen (v_supplier_summary): los precios en sí se cargan al abrir el proveedor. */
  productCount: number;
  priceCount: number;
  lastPriceAt: string | null;
};
type Form = Omit<Supplier, "id" | "active" | "productCount" | "priceCount" | "lastPriceAt">;

type Venue = { id: string; name: string };

const EMPTY_FORM: Form = {
  name: "", taxId: "", email: "", phone: "", notes: "", code: "", contactName: "",
  orderDays: [], orderCutoff: "", leadTimeHours: "", minOrder: "", paymentTerms: "", locationIds: [],
};

/** Condiciones tal como las usa el cálculo de entrega y mínimo. */
function termsOf(s: Pick<Form, "orderDays" | "orderCutoff" | "leadTimeHours" | "minOrder">) {
  return {
    orderDays: s.orderDays.length ? s.orderDays : null,
    orderCutoff: s.orderCutoff || null,
    leadTimeHours: s.leadTimeHours === "" ? null : Number(s.leadTimeHours),
    minOrder: s.minOrder === "" ? null : s.minOrder,
  };
}

const money = (v: Decimal) => euros(v.toNumber());

function friendly(error: { code?: string } | null, fallback: string) {
  if (error?.code === "23505") return "Ya existe un proveedor con ese nombre o ese código.";
  if (error?.code === "23514") return "Revisa las condiciones: algún valor no es válido.";
  if (error?.code === "42501") return "No tienes permisos para hacer este cambio.";
  return fallback;
}

async function loadVenues(): Promise<Venue[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data } = await supabase.from("locations").select("id, name").eq("active", true).order("name");
  return (data ?? []) as Venue[];
}

async function loadSuppliers(): Promise<Supplier[]> {
  const supabase = createClient();
  if (!supabase) throw new Error("Configura las variables de Supabase.");
  // Datos de cada proveedor y su resumen de precios (cuántos y el último), sin bajar todos los precios.
  const [{ data, error }, { data: summary }] = await Promise.all([
    supabase
      .from("suppliers")
      .select("id, name, tax_id, email, phone, notes, active, code, contact_name, order_days, order_cutoff, lead_time_hours, min_order, payment_terms, location_ids")
      .order("name"),
    supabase.from("v_supplier_summary").select("supplier_id, prices, products, last_price_at"),
  ]);
  if (error) throw new Error("No se pudieron cargar los proveedores.");
  const bySupplier = new Map((summary ?? []).map((r) => [r.supplier_id, r]));
  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    taxId: r.tax_id ?? "",
    email: r.email ?? "",
    phone: r.phone ?? "",
    notes: r.notes ?? "",
    code: r.code ?? "",
    contactName: r.contact_name ?? "",
    orderDays: (r.order_days as number[] | null) ?? [],
    orderCutoff: r.order_cutoff ? String(r.order_cutoff).slice(0, 5) : "",
    leadTimeHours: r.lead_time_hours === null || r.lead_time_hours === undefined ? "" : String(r.lead_time_hours),
    minOrder: r.min_order === null || r.min_order === undefined ? "" : String(Number(r.min_order)),
    paymentTerms: r.payment_terms ?? "",
    locationIds: (r.location_ids as string[] | null) ?? [],
    active: r.active,
    productCount: Number(bySupplier.get(r.id)?.products ?? 0),
    priceCount: Number(bySupplier.get(r.id)?.prices ?? 0),
    lastPriceAt: bySupplier.get(r.id)?.last_price_at ?? null,
  }));
}

/** Precios de un proveedor: solo cuando se abre su ficha. */
async function loadSupplierPrices(supplierId: string): Promise<Price[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("supplier_prices")
    .select("last_price, last_price_at, pack:product_packs(name, product:products(id, name))")
    .eq("supplier_id", supplierId);
  if (error) throw new Error("No se pudieron cargar los precios.");
  type Row = { last_price: number | null; last_price_at: string | null; pack: { name: string; product: { id: string; name: string } | null } | null };
  return ((data ?? []) as unknown as Row[])
    .map((p) => ({ price: p.last_price, at: p.last_price_at, pack: p.pack?.name ?? "Formato", product: p.pack?.product?.name ?? "Producto", productId: p.pack?.product?.id ?? "" }))
    .sort((a, b) => a.product.localeCompare(b.product));
}

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);

  async function reload() {
    try {
      setSuppliers(await loadSuppliers());
      setLoadError("");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "No se pudieron cargar los proveedores.");
    }
  }

  useEffect(() => {
    async function start() {
      await Promise.resolve();
      void loadVenues().then(setVenues);
      await reload();
    }
    void start();
  }, []);

  const counts = useMemo(
    () => ({ active: suppliers?.filter((s) => s.active).length ?? 0, archived: suppliers?.filter((s) => !s.active).length ?? 0 }),
    [suppliers],
  );
  const visible = (suppliers ?? []).filter(
    (s) => (status === "active" ? s.active : !s.active) && (!query || normalizeText(`${s.name} ${s.code} ${s.taxId} ${s.email}`).includes(normalizeText(query))),
  );

  return (
    <main className="catalog-page">
      <div className="catalog-content">
        <div className="catalog-heading">
          <div>
            <p className="eyebrow">Gestión · Compras</p>
            <h1>Proveedores</h1>
            <p className="catalog-subtitle">A quién compras y a qué precio. Los precios se actualizan solos con cada recepción.</p>
          </div>
          <button className="catalog-primary" onClick={() => setEditing("new")}><CirclePlus size={17} /> Nuevo proveedor</button>
        </div>
        <div className="catalog-tabs">
          <button className={status === "active" ? "active" : undefined} onClick={() => setStatus("active")}>Activos <b>{counts.active}</b></button>
          <button className={status === "archived" ? "active" : undefined} onClick={() => setStatus("archived")}>Archivados <b>{counts.archived}</b></button>
        </div>
        <section className="catalog-panel">
          <div className="catalog-toolbar">
            <div className="catalog-search">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre, código, CIF o email" />
            </div>
          </div>
          <div className="suppliers-table">
            <div className="suppliers-head"><span>Proveedor</span><span>Contacto</span><span>Pedidos</span><span>Productos con precio</span><span>Último precio</span></div>
            {!suppliers && !loadError && <LoadingRows label="Cargando proveedores" />}
            {loadError && (
              <div className="catalog-empty">
                <strong>{loadError}</strong>
                <button className="filter-button" onClick={() => void reload()}>Reintentar</button>
              </div>
            )}
            {visible.map((s) => {
              const last = s.lastPriceAt;
              return (
                <div
                  key={s.id}
                  className="suppliers-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => setEditing(s)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setEditing(s);
                    }
                  }}
                >
                  <span className="catalog-product">
                    <span className="catalog-product-icon"><Truck size={16} /></span>
                    <span><strong>{s.name}</strong><small>{[s.code, s.taxId || "Sin CIF"].filter(Boolean).join(" · ")}</small></span>
                  </span>
                  <span className="cell-ellipsis">{[s.contactName, s.email, s.phone].filter(Boolean).join(" · ") || <em className="muted">Sin contacto</em>}</span>
                  <span className="supplier-terms-cell">
                    {s.orderDays.length || s.orderCutoff || s.minOrder ? (
                      <>
                        <strong>{shortDays(s.orderDays.length ? s.orderDays : null)}{s.orderCutoff ? ` · ${s.orderCutoff}` : ""}</strong>
                        <small>{s.minOrder ? `mín. ${euros(Number(s.minOrder))}` : "sin mínimo"}</small>
                      </>
                    ) : (
                      <em className="muted">Sin condiciones</em>
                    )}
                  </span>
                  <span>{s.productCount}</span>
                  <span>{last ? new Date(last).toLocaleDateString("es-ES") : <em className="muted">—</em>}</span>
                </div>
              );
            })}
            {suppliers && visible.length === 0 && (
              <div className="catalog-empty">
                <strong>{query ? "No hay resultados" : status === "active" ? "Todavía no hay proveedores" : "No hay proveedores archivados"}</strong>
                {status === "active" && !query && <span>Crea el primero con «Nuevo proveedor».</span>}
              </div>
            )}
          </div>
        </section>
      </div>
      {editing && (
        <SupplierEditor
          supplier={editing === "new" ? null : editing}
          venues={venues}
          onClose={() => setEditing(null)}
          onChanged={() => void reload()}
        />
      )}
    </main>
  );
}

function SupplierEditor({ supplier, venues, onClose, onChanged }: { supplier: Supplier | null; venues: Venue[]; onClose: () => void; onChanged: () => void }) {
  const initial: Form = supplier
    ? {
        name: supplier.name, taxId: supplier.taxId, email: supplier.email, phone: supplier.phone, notes: supplier.notes,
        code: supplier.code, contactName: supplier.contactName, orderDays: supplier.orderDays, orderCutoff: supplier.orderCutoff,
        leadTimeHours: supplier.leadTimeHours, minOrder: supplier.minOrder, paymentTerms: supplier.paymentTerms, locationIds: supplier.locationIds,
      }
    : EMPTY_FORM;
  const [form, setForm] = useState<Form>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [prices, setPrices] = useState<Price[] | null>(null);
  const [pricesError, setPricesError] = useState("");

  useEffect(() => {
    if (!supplier) return;
    let cancelled = false;
    loadSupplierPrices(supplier.id)
      .then((list) => !cancelled && setPrices(list))
      .catch((err: Error) => !cancelled && setPricesError(err.message));
    return () => {
      cancelled = true;
    };
  }, [supplier]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  function close() {
    if (saving) return;
    if (dirty && !window.confirm("Hay cambios sin guardar. ¿Cerrar igualmente?")) return;
    onClose();
  }

  const set = (key: keyof Form) => (event: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: event.target.value }));
  const values = () => ({
    name: form.name.trim(),
    tax_id: form.taxId.trim() || null,
    email: form.email.trim() || null,
    phone: form.phone.trim() || null,
    notes: form.notes.trim() || null,
    code: form.code.trim() || null,
    contact_name: form.contactName.trim() || null,
    order_days: form.orderDays.length ? [...form.orderDays].sort((a, b) => a - b) : null,
    order_cutoff: form.orderCutoff || null,
    lead_time_hours: form.leadTimeHours === "" ? null : Number(form.leadTimeHours),
    min_order: form.minOrder === "" ? null : Number(form.minOrder),
    payment_terms: form.paymentTerms.trim() || null,
    location_ids: form.locationIds.length ? form.locationIds : null,
  });
  const toggleDay = (day: number) =>
    setForm((f) => ({ ...f, orderDays: f.orderDays.includes(day) ? f.orderDays.filter((d) => d !== day) : [...f.orderDays, day] }));
  const toggleVenue = (id: string) =>
    setForm((f) => ({ ...f, locationIds: f.locationIds.includes(id) ? f.locationIds.filter((v) => v !== id) : [...f.locationIds, id] }));
  const plan = nextDelivery(termsOf(form), new Date());
  const summary = describeTerms(termsOf(form), money);

  async function save() {
    if (!form.name.trim()) return setError("El proveedor necesita un nombre.");
    if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) return setError("Revisa el email.");
    if (form.leadTimeHours !== "" && !(Number.isInteger(Number(form.leadTimeHours)) && Number(form.leadTimeHours) >= 0 && Number(form.leadTimeHours) <= 720)) {
      return setError("El plazo de entrega va en horas, de 0 a 720.");
    }
    if (form.minOrder !== "" && !(Number(form.minOrder) >= 0)) return setError("El pedido mínimo no puede ser negativo.");
    const supabase = createClient();
    if (!supabase) return setError("Configura las variables de Supabase.");
    setSaving(true);
    setError("");
    if (supplier) {
      const { data, error: err } = await supabase.from("suppliers").update(values()).eq("id", supplier.id).select("id");
      setSaving(false);
      if (err) return setError(friendly(err, "No se pudo guardar."));
      if (!data?.length) return setError("No tienes permisos para editar proveedores.");
    } else {
      const { data: membership } = await supabase.from("memberships").select("org_id").limit(1).maybeSingle();
      if (!membership) {
        setSaving(false);
        return setError("No se encontró tu organización.");
      }
      const { error: err } = await supabase.from("suppliers").insert({ org_id: membership.org_id, ...values() });
      setSaving(false);
      if (err) return setError(friendly(err, "No se pudo crear el proveedor."));
    }
    onChanged();
    onClose();
  }

  async function toggleArchive() {
    if (!supplier) return;
    const supabase = createClient();
    if (!supabase) return;
    setSaving(true);
    const { data, error: err } = await supabase.from("suppliers").update({ active: !supplier.active }).eq("id", supplier.id).select("id");
    setSaving(false);
    if (err || !data?.length) return setError(friendly(err ?? { code: "42501" }, "No se pudo cambiar el estado."));
    onChanged();
    onClose();
  }

  async function remove() {
    if (!supplier) return;
    const supabase = createClient();
    if (!supabase) return;
    setSaving(true);
    const { data, error: err } = await supabase.from("suppliers").delete().eq("id", supplier.id).select("id");
    setSaving(false);
    setConfirmDelete(false);
    if (err?.code === "23503") return setError("Tiene recepciones registradas y no se puede borrar sin perder el historial. Archívalo.");
    if (err || !data?.length) return setError(friendly(err ?? { code: "42501" }, "No se pudo eliminar."));
    onChanged();
    onClose();
  }

  return (
    <div className="modal-layer editor-layer" onClick={close}>
      <section className="product-editor" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Ficha de proveedor">
        <header className="editor-header">
          <div>
            <p className="eyebrow">{supplier ? "Ficha de proveedor" : "Nuevo proveedor"}</p>
            <h2>{form.name || "Proveedor"}</h2>
            {supplier && !supplier.active && <span className="editor-badge">Archivado</span>}
          </div>
          <button className="modal-close" onClick={close} aria-label="Cerrar"><X size={18} /></button>
        </header>
        <div className="editor-body">
          <div className="editor-grid">
            <label className="span-2">Nombre<input autoFocus={!supplier} value={form.name} onChange={set("name")} placeholder="Ej. Makro" /></label>
            <label>CIF / NIF<input value={form.taxId} onChange={set("taxId")} placeholder="Opcional" /></label>
            <label>Teléfono<input value={form.phone} onChange={set("phone")} placeholder="Opcional" inputMode="tel" /></label>
            <label className="span-2">Email de pedidos<input value={form.email} onChange={set("email")} placeholder="Opcional" inputMode="email" /></label>
            <label>Código<input value={form.code} onChange={set("code")} placeholder="Ej. PRV-012" maxLength={20} /></label>
            <label>Contacto comercial<input value={form.contactName} onChange={set("contactName")} placeholder="Nombre del comercial" /></label>
            <label className="span-2">Notas<input value={form.notes} onChange={set("notes")} placeholder="Cualquier otra cosa: portes, rappel, cómo pedir…" /></label>
          </div>
          <div className="editor-section supplier-terms">
            <p className="facet-title">Condiciones de pedido</p>
            <div className="supplier-days" role="group" aria-label="Días de pedido">
              {WEEKDAYS.map((name, i) => (
                <button
                  key={name}
                  type="button"
                  className={form.orderDays.includes(i + 1) ? "active" : undefined}
                  aria-pressed={form.orderDays.includes(i + 1)}
                  onClick={() => toggleDay(i + 1)}
                >
                  {name.slice(0, 3)}
                </button>
              ))}
            </div>
            <p className="section-hint">{form.orderDays.length ? "Días en que admite pedidos." : "Sin días marcados: admite pedidos cualquier día."}</p>
            <div className="editor-grid">
              <label>Hora límite<input type="time" value={form.orderCutoff} onChange={set("orderCutoff")} /></label>
              <label>Plazo de entrega (horas)<input type="number" min="0" max="720" step="1" inputMode="numeric" value={form.leadTimeHours} onChange={set("leadTimeHours")} placeholder="Ej. 48" /></label>
              <label>Pedido mínimo (€)<input type="number" min="0" step="0.01" inputMode="decimal" value={form.minOrder} onChange={set("minOrder")} placeholder="Sin mínimo" /></label>
              <label>Condiciones de pago<input value={form.paymentTerms} onChange={set("paymentTerms")} placeholder="Ej. 30 días, transferencia" /></label>
            </div>
            {venues.length > 1 && (
              <>
                <p className="facet-title supplier-venues-title">Locales a los que sirve</p>
                <div className="supplier-days" role="group" aria-label="Locales a los que sirve">
                  {venues.map((v) => (
                    <button key={v.id} type="button" className={form.locationIds.includes(v.id) ? "active" : undefined} aria-pressed={form.locationIds.includes(v.id)} onClick={() => toggleVenue(v.id)}>
                      {v.name}
                    </button>
                  ))}
                </div>
                <p className="section-hint">{form.locationIds.length ? "Solo se le pedirá desde estos locales." : "Sin locales marcados: sirve a todos."}</p>
              </>
            )}
            {summary && (
              <p className="supplier-next">
                {summary}. {plan.orderToday ? "Si pides hoy" : `Próximo pedido el ${formatDayLong(plan.orderDate)}`}
                {plan.deliveryDate ? `, llegaría el ${formatDayLong(plan.deliveryDate)}.` : "."}
              </p>
            )}
          </div>
          {supplier && (
            <div className="editor-section supplier-prices">
              <p className="facet-title">Precios de este proveedor ({supplier.priceCount})</p>
              {pricesError ? (
                <p className="section-hint">{pricesError}</p>
              ) : !prices ? (
                <p className="section-hint">Cargando precios...</p>
              ) : prices.length === 0 ? (
                <p className="section-hint">Todavía no hay precios. Se añaden desde la ficha de cada producto o al registrar una recepción.</p>
              ) : (
                <div className="editor-table">
                  <div className="editor-head supplier-price-row"><span>Producto</span><span>Formato</span><span>Precio</span><span>Fecha</span></div>
                  {prices.map((p, i) => (
                    <div className="editor-row supplier-price-row" key={`${p.productId}-${p.pack}-${i}`}>
                      <Link href={`/productos?producto=${p.productId}`}>{p.product}</Link>
                      <span>{p.pack}</span>
                      <strong>{p.price === null ? "—" : euros(p.price)}</strong>
                      <span className="muted">{p.at ? new Date(p.at).toLocaleDateString("es-ES") : "—"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {supplier && (
            <details className="editor-section supplier-history">
              <summary className="facet-title">Historial de cambios</summary>
              <EntityHistory entityId={supplier.id} />
            </details>
          )}
        </div>
        {error && <p className="editor-message error">{error}</p>}
        <footer className="editor-footer">
          {supplier ? (
            confirmDelete ? (
              <div className="delete-confirm">
                <span>¿Eliminar «{supplier.name}»{supplier.priceCount ? ` y sus ${supplier.priceCount} precios` : ""}?</span>
                <button className="danger-button" disabled={saving} onClick={() => void remove()}>Sí, eliminar</button>
                <button className="ghost-button" onClick={() => setConfirmDelete(false)}>Cancelar</button>
              </div>
            ) : (
              <div className="footer-left">
                <button className="ghost-button danger" disabled={saving} onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> Eliminar</button>
                <button className="ghost-button" disabled={saving || dirty} onClick={() => void toggleArchive()}>
                  {supplier.active ? <><Archive size={14} /> Archivar</> : <><ArchiveRestore size={14} /> Restaurar</>}
                </button>
              </div>
            )
          ) : (
            <span />
          )}
          <div className="footer-right">
            <button className="catalog-primary" disabled={saving || (!!supplier && !dirty)} onClick={() => void save()}>
              {saving ? "Guardando..." : supplier ? "Guardar cambios" : "Crear proveedor"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
