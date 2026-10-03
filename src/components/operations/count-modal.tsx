"use client";

import { useEffect, useMemo, useState } from "react";
import Decimal from "decimal.js";
import { ArrowLeft, Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { readAll } from "@/lib/supabase/read-all";
import { loadCountCatalog } from "@/lib/count-catalog";
import { decimalText, euros, normalizeText, parseDecimal as parse, quantity } from "@/lib/format";
import { countLayout, countTotal, formatStock, type CountingPacks, type UnitDimension } from "@/lib/units";

const unitDimension = (baseUnit: string): UnitDimension => (baseUnit === "ml" ? "volume" : baseUnit === "g" ? "mass" : "count");

// Conteo de inventario en dos pasos:
//   1) contar como se hace en el almacén: cajas cerradas y sueltas aparte (refrescos: «3 cajas + 5 ud»;
//      destilados: «1 caja + 2,5 botellas»), agrupado por familia y con el surtido del local primero.
//      Las líneas se guardan y se van sumando (por zonas o entre varias personas);
//   2) revisar las diferencias con su valor y cerrar. Lo que falta puede registrarse como CONSUMO:
//      en un bar sin TPV es el consumo real del periodo y alimenta informes y reposición.

type Product = { id: string; name: string; base_unit: string; family?: string | null; packs?: CountingPacks };
type Entry = { boxes: string; loose: string };
type PreviewRow = { productId: string; name: string; unit: string; expected: Decimal; counted: Decimal; diff: Decimal; value: Decimal };
type Filter = "todos" | "pendientes" | "contados";

/** Orden de las familias en la hoja (el mismo que el catálogo). */
const FAMILIES = [
  "Destilados", "Champán", "Vinos", "Cervezas", "Refrescos y mixers", "Energéticas", "Aguas", "Zumos y siropes", "Café e infusiones",
  "Hielo", "Fruta y guarnición", "Snacks y picoteo", "Comida", "Sala y menaje", "Consumibles",
];
const familyRank = (f: string | null | undefined) => {
  const i = f ? FAMILIES.indexOf(f) : -1;
  return i === -1 ? FAMILIES.length : i;
};

export function CountModal({
  count,
  onClose,
  onChanged,
}: {
  count: { id: string; locationId: string };
  onClose: () => void;
  onChanged: () => void;
}) {
  // La hoja necesita todo el catálogo: se pide al abrir el conteo (y se reutiliza unos minutos).
  const [products, setProducts] = useState<Product[]>([]);
  const [catalogState, setCatalogState] = useState<"loading" | "ready" | "error">("loading");
  const [counted, setCounted] = useState<Map<string, Decimal>>(new Map());
  const [assortment, setAssortment] = useState<Set<string> | null>(null);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("todos");
  const [showOthers, setShowOthers] = useState(false);
  const [step, setStep] = useState<"count" | "review">("count");
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [zeroUncounted, setZeroUncounted] = useState(false);
  const [asConsumption, setAsConsumption] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadCounted() {
    const supabase = createClient();
    if (!supabase) return;
    const { data } = await readAll((from, to) => supabase.from("count_lines").select("product_id, qty").eq("count_id", count.id).order("id").range(from, to));
    const sums = new Map<string, Decimal>();
    for (const line of data ?? []) sums.set(line.product_id, (sums.get(line.product_id) ?? new Decimal(0)).plus(String(line.qty)));
    setCounted(sums);
  }

  useEffect(() => {
    async function start() {
      await Promise.resolve();
      const supabase = createClient();
      if (!supabase) return;
      // Surtido del local: lo que se cuenta aquí sale primero; el resto, bajo «Otros productos».
      const [{ data: rows }, catalog] = await Promise.all([
        readAll((from, to) => supabase.from("location_products").select("product_id").eq("location_id", count.locationId).eq("active", true).order("product_id").range(from, to)),
        loadCountCatalog().catch(() => null),
        loadCounted(),
      ]);
      setAssortment(new Set((rows ?? []).map((r) => r.product_id)));
      if (catalog) setProducts(catalog);
      setCatalogState(catalog ? "ready" : "error");
    }
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se carga una vez por inventario
  }, [count.id]);

  const layouts = useMemo(() => new Map(products.map((p) => [p.id, countLayout(p.packs ?? { dimension: unitDimension(p.base_unit) })])), [products]);
  const layoutOf = (productId: string) => layouts.get(productId)!;
  const entryOf = (productId: string): Entry => entries[productId] ?? { boxes: "", loose: "" };
  const typedOf = (productId: string): Decimal | null | "invalid" => {
    const e = entryOf(productId);
    if (!e.boxes.trim() && !e.loose.trim()) return null;
    const boxes = e.boxes.trim() ? parse(e.boxes) : null;
    const loose = e.loose.trim() ? parse(e.loose) : null;
    if ((e.boxes.trim() && boxes === null) || (e.loose.trim() && loose === null)) return "invalid";
    return countTotal(layoutOf(productId), boxes, loose) ?? "invalid";
  };
  // Como se cuenta en barra (botellas, cajas + ud…) si se conocen los formatos; si no, en unidad base.
  const show = (q: Decimal, productId: string, unit: string) => {
    const packs = products.find((p) => p.id === productId)?.packs;
    return packs ? formatStock(q, packs) : quantity(q, unit);
  };

  const groups = useMemo(() => {
    const matches = products.filter((p) => !search || normalizeText(`${p.name} ${p.family ?? ""}`).includes(normalizeText(search)));
    const isDone = (id: string) => counted.has(id) || !!entries[id]?.boxes.trim() || !!entries[id]?.loose.trim();
    const shown = matches.filter((p) => filter === "todos" || (filter === "contados") === isDone(p.id));
    // Con búsqueda se ve todo; sin ella, primero el surtido del local.
    const inLocation = (id: string) => !assortment || assortment.size === 0 || assortment.has(id) || !!search;
    const sorted = [...shown].sort((a, b) => familyRank(a.family) - familyRank(b.family) || (a.family ?? "").localeCompare(b.family ?? "") || a.name.localeCompare(b.name));
    const main = sorted.filter((p) => inLocation(p.id));
    const others = sorted.filter((p) => !inLocation(p.id));
    const byFamily = new Map<string, Product[]>();
    for (const p of main) byFamily.set(p.family ?? "Sin familia", [...(byFamily.get(p.family ?? "Sin familia") ?? []), p]);
    return { families: [...byFamily.entries()], others };
  }, [products, search, filter, entries, counted, assortment]);

  const pending = Object.keys(entries).filter((id) => typedOf(id) !== null);
  const totalProducts = assortment && assortment.size > 0 ? assortment.size : products.length;
  const countedInLocation = [...counted.keys()].filter((id) => !assortment || assortment.size === 0 || assortment.has(id)).length;

  /** Guarda lo tecleado como líneas de conteo (en unidad base). Devuelve false si hay algo mal. */
  async function saveLines(): Promise<boolean> {
    if (pending.length === 0) return true;
    const invalid = pending.find((id) => typedOf(id) === "invalid");
    if (invalid) {
      const layout = layoutOf(invalid);
      setError(
        `Revisa ${products.find((p) => p.id === invalid)?.name ?? "un producto"}: las cajas van en números enteros${layout.unit.decimals ? "" : " y las sueltas también"} (usa 2 o 1,5).`,
      );
      return false;
    }
    const supabase = createClient();
    if (!supabase) return false;
    const rows = pending.map((productId) => {
      const e = entryOf(productId);
      const layout = layoutOf(productId);
      const plain = (t: string) => (t.trim() ? parse(t)!.toString() : "0");
      return {
        count_id: count.id,
        product_id: productId,
        qty: (typedOf(productId) as Decimal).toNumber(),
        // Lo que se tecleó, para poder revisar el conteo: «3 cajas (Caja 24) + 5 ud».
        input: layout.box
          ? { boxes: plain(e.boxes), box: layout.box.name, loose: plain(e.loose), unit: layout.unit.name }
          : { amount: plain(e.loose), unit: layout.unit.name },
        client_ref: crypto.randomUUID(),
      };
    });
    const { error: err } = await supabase.from("count_lines").insert(rows);
    if (err) {
      setError("No se pudieron guardar las líneas contadas. ¿Sigue abierto el inventario?");
      return false;
    }
    setEntries({});
    await loadCounted();
    return true;
  }

  async function save() {
    setSaving(true);
    setError("");
    setNotice("");
    if (pending.length === 0) setError("Introduce al menos una cantidad.");
    else if (await saveLines()) {
      setNotice(`${pending.length} ${pending.length === 1 ? "producto guardado" : "productos guardados"}. Puedes seguir contando o revisar y cerrar.`);
      onChanged();
    }
    setSaving(false);
  }

  async function loadPreview(zero: boolean) {
    const supabase = createClient();
    if (!supabase) return;
    const { data, error: err } = await supabase.rpc("count_preview", { p_count: count.id, p_zero_uncounted: zero });
    if (err) {
      setError(err.code === "PGRST202" ? "Falta aplicar la migración 0011_consumo_por_inventario.sql en Supabase." : "No se pudo calcular la revisión.");
      setPreview(null);
      return;
    }
    setPreview(
      (data ?? []).map((r) => ({
        productId: r.product_id,
        name: r.product_name,
        unit: r.base_unit,
        expected: new Decimal(String(r.expected)),
        counted: new Decimal(String(r.counted)),
        diff: new Decimal(String(r.diff)),
        value: new Decimal(String(r.diff_value)),
      })),
    );
  }

  async function review() {
    setSaving(true);
    setError("");
    setNotice("");
    if (await saveLines()) {
      await loadPreview(zeroUncounted);
      setStep("review");
    }
    setSaving(false);
  }

  async function close() {
    const supabase = createClient();
    if (!supabase) return;
    setSaving(true);
    setError("");
    const { error: err } = await supabase.rpc("close_count", { p_count: count.id, p_zero_uncounted: zeroUncounted, p_as_consumption: asConsumption });
    setSaving(false);
    if (err) {
      setError(err.message?.includes("forbidden") ? "Solo un encargado puede cerrar el inventario. Guarda el conteo y avísale." : err.message?.includes("invalid_status") ? "Este inventario ya está cerrado." : "No se pudo cerrar el inventario.");
      return;
    }
    onChanged();
    onClose();
  }

  function renderRow(product: Product) {
    const layout = layoutOf(product.id);
    const entry = entryOf(product.id);
    const already = counted.get(product.id);
    const typed = typedOf(product.id);
    const set = (patch: Partial<Entry>) => setEntries({ ...entries, [product.id]: { ...entry, ...patch } });
    return (
      <div className={`count-line${typed === "invalid" ? " invalid" : ""}`} key={product.id}>
        <span className="count-line-name">
          {product.name}
          <small>
            {already ? `Contado: ${show(already, product.id, product.base_unit)}` : "Sin contar"}
            {typed instanceof Decimal && <b> · {already ? "se suman" : "ahora"} {show(typed, product.id, product.base_unit)}</b>}
          </small>
        </span>
        {layout.box ? (
          <label className="count-field">
            <input inputMode="numeric" placeholder="0" value={entry.boxes} onChange={(event) => set({ boxes: event.target.value })} aria-label={`Cajas de ${product.name}`} />
            <small>{layout.box.name.split(/\s+/)[0]?.toLowerCase() === "bandeja" ? "bandejas" : "cajas"} de {decimalText(layout.box.units, 0)}</small>
          </label>
        ) : (
          <span className="count-field empty" aria-hidden="true" />
        )}
        <label className="count-field">
          <input inputMode="decimal" placeholder="0" value={entry.loose} onChange={(event) => set({ loose: event.target.value })} aria-label={`${layout.box ? "Sueltas" : "Cantidad"} de ${product.name}`} />
          <small>{layout.box ? `${layout.unit.plural} sueltas` : layout.unit.plural}</small>
        </label>
      </div>
    );
  }

  const missing = (preview ?? []).filter((r) => r.diff.lt(0)).reduce((acc, r) => acc.plus(r.value.abs()), new Decimal(0));
  const extra = (preview ?? []).filter((r) => r.diff.gt(0)).reduce((acc, r) => acc.plus(r.value), new Decimal(0));
  const changes = (preview ?? []).filter((r) => !r.diff.isZero());

  return (
    <div className="op-modal-layer" onClick={() => !saving && onClose()}>
      <section className="op-modal count-modal" onClick={(event) => event.stopPropagation()}>
        <div className="op-modal-heading">
          <div>
            <p className="operation-eyebrow">Inventario · {step === "count" ? "paso 1 de 2" : "paso 2 de 2"}</p>
            <h2>{step === "count" ? "Contar productos" : "Revisar y cerrar"}</h2>
          </div>
          <button className="op-modal-close" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </div>

        {step === "count" && (
          <>
            <div className="count-toolbar">
              <div className="count-search">
                <Search size={15} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar producto o familia" autoFocus />
              </div>
              <div className="count-filters" role="group" aria-label="Filtrar">
                {(["todos", "pendientes", "contados"] as const).map((f) => (
                  <button type="button" key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
                    {f === "todos" ? "Todos" : f === "pendientes" ? "Sin contar" : "Contados"}
                  </button>
                ))}
              </div>
            </div>
            <p className="count-progress">
              <b>{countedInLocation}</b> de {totalProducts} productos contados
              <span style={{ width: `${Math.min(100, (countedInLocation / Math.max(totalProducts, 1)) * 100)}%` }} />
            </p>
            <div className="op-modal-count-list count-sheet">
              {groups.families.map(([family, list]) => (
                <section key={family}>
                  <h3 className="count-family">{family}</h3>
                  {list.map((product) => renderRow(product))}
                </section>
              ))}
              {groups.others.length > 0 && (
                <section>
                  <button type="button" className="count-others" onClick={() => setShowOthers(!showOthers)}>
                    {showOthers ? "Ocultar" : "Ver"} otros productos ({groups.others.length}) · no están en el surtido de este local
                  </button>
                  {showOthers && groups.others.map((product) => renderRow(product))}
                </section>
              )}
              {catalogState === "loading" && <p className="count-empty">Cargando la hoja de inventario…</p>}
              {catalogState === "error" && <p className="count-empty">No se pudo cargar el catálogo. Cierra y vuelve a abrir el inventario.</p>}
              {catalogState === "ready" && groups.families.length === 0 && groups.others.length === 0 && <p className="count-empty">Ningún producto coincide.</p>}
            </div>
            <p className="count-hint">Cuenta las cajas cerradas y lo suelto aparte; se suman solas. Lo que guardes se añade a lo ya contado: podéis contar por zonas o entre varias personas.</p>
            {notice && <p className="count-notice">{notice}</p>}
            {error && <p className="op-modal-error">{error}</p>}
            <div className="op-modal-actions">
              <button className="op-modal-submit op-modal-secondary" onClick={() => void save()} disabled={saving || pending.length === 0}>{saving ? "Guardando..." : `Guardar conteo${pending.length ? ` (${pending.length})` : ""}`}</button>
              <button className="op-modal-submit" onClick={() => void review()} disabled={saving || (pending.length === 0 && counted.size === 0)}>{saving ? "..." : "Revisar y cerrar"}</button>
            </div>
          </>
        )}

        {step === "review" && (
          <>
            <div className="count-totals">
              <div><span>Falta</span><strong className="negative">{euros(missing)}</strong></div>
              <div><span>Sobra</span><strong>{euros(extra)}</strong></div>
              <div><span>Productos con diferencia</span><strong>{changes.length}</strong></div>
            </div>
            <div className="op-modal-count-list count-review">
              {changes.length === 0 && <p className="count-empty">Todo cuadra: no hay diferencias con el stock esperado.</p>}
              {changes.map((r) => (
                <div className="count-review-row" key={r.productId}>
                  <span><b>{r.name}</b><small>esperado {show(r.expected, r.productId, r.unit)} · contado {show(r.counted, r.productId, r.unit)}</small></span>
                  <span className={r.diff.lt(0) ? "negative" : "positive"}>{r.diff.gt(0) ? "+" : ""}{show(r.diff, r.productId, r.unit)}</span>
                  <span className={r.value.lt(0) ? "negative" : "positive"}>{euros(r.value)}</span>
                </div>
              ))}
            </div>
            <label className="count-option">
              <input type="checkbox" checked={asConsumption} onChange={(event) => setAsConsumption(event.target.checked)} />
              <span><b>Lo que falta es consumo</b><small>Recomendado si no registráis cada venta: cuenta como consumo real en informes y en la reposición. Desmárcalo si la diferencia es un error o una pérdida.</small></span>
            </label>
            <label className="count-option">
              <input
                type="checkbox"
                checked={zeroUncounted}
                onChange={(event) => {
                  setZeroUncounted(event.target.checked);
                  void loadPreview(event.target.checked);
                }}
              />
              <span><b>Poner a cero lo no contado</b><small>Los productos activos del local que no se han contado pasan a 0. Úsalo solo en un inventario completo.</small></span>
            </label>
            {error && <p className="op-modal-error">{error}</p>}
            <div className="op-modal-actions">
              <button className="op-modal-submit op-modal-secondary" onClick={() => setStep("count")} disabled={saving}><ArrowLeft size={14} /> Seguir contando</button>
              <button className="op-modal-submit" onClick={() => void close()} disabled={saving || preview === null}>{saving ? "Cerrando..." : "Cerrar inventario"}</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
