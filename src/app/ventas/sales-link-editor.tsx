"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { normalizeText, parseDecimal } from "@/lib/format";

// Enlaza un artículo del TPV con lo que se gasta al venderlo: un plato (sus raciones) o un producto (una
// botella, una copa de 150 ml, un chupito…). Se hace una vez y vale para todos los días.

export type SalesItemRow = {
  id: string; code: string; name: string; link: "receta" | "producto" | "ignorado" | "sin_enlazar"; linkName: string | null;
  qtyPerSale: number; qty: number; amount: number; unitCost: number | null; cost: number | null; foodCost: number | null;
};
export type LinkTarget = { kind: "receta" | "producto"; id: string; name: string; detail: string; unit: string };

const UNIT_LABEL: Record<string, string> = { racion: "raciones", g: "g", ml: "ml", ud: "ud", mass: "g", volume: "ml", count: "ud" };
const PRESETS: Record<string, Array<[string, number]>> = {
  volume: [["Botella 75 cl", 750], ["Copa de vino", 150], ["Caña", 200], ["Combinado", 50], ["Chupito", 30]],
  count: [["1 unidad", 1]],
  racion: [["1 ración", 1]],
};

export function SalesLinkEditor({ item, targets, onClose, onSaved }: { item: SalesItemRow; targets: LinkTarget[]; onClose: () => void; onSaved: () => void }) {
  const current = targets.find((t) => t.name === item.linkName && (item.link === "receta" ? t.kind === "receta" : t.kind === "producto")) ?? null;
  const [target, setTarget] = useState<LinkTarget | null>(current);
  const [query, setQuery] = useState(current ? "" : item.name);
  const [qty, setQty] = useState(String(current ? item.qtyPerSale : 1).replace(".", ","));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const matches = useMemo(() => {
    const q = normalizeText(query);
    if (!q) return [];
    const words = q.split(" ").filter((w) => w.length > 1);
    return targets
      .map((t) => {
        const n = normalizeText(t.name);
        const score = n === q ? 100 : n.startsWith(q) ? 50 : words.filter((w) => n.includes(w)).length * 10;
        return { t, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || (a.t.kind === "receta" ? -1 : 1) || a.t.name.localeCompare(b.t.name, "es"))
      .slice(0, 12)
      .map((x) => x.t);
  }, [query, targets]);

  function pick(t: LinkTarget) {
    setTarget(t);
    setQuery("");
    // Por defecto: una ración del plato, una unidad, o una botella de 75 cl.
    setQty(t.kind === "producto" && t.unit === "volume" ? "750" : "1");
  }

  async function save(ignored: boolean) {
    const n = parseDecimal(qty);
    if (!ignored && target && (n === null || Number(n) <= 0)) return setError("Indica cuánto se gasta en cada venta.");
    const supabase = createClient();
    if (!supabase) return;
    setSaving(true);
    const { error: err } = await supabase.rpc("link_sales_item", {
      p_item: item.id,
      p_recipe: !ignored && target?.kind === "receta" ? target.id : null,
      p_product: !ignored && target?.kind === "producto" ? target.id : null,
      p_qty: ignored || !target ? null : Number(n),
      p_ignored: ignored,
    });
    setSaving(false);
    if (err) return setError("No se pudo guardar.");
    onSaved();
  }

  const unit = target ? UNIT_LABEL[target.unit] ?? "ud" : "";
  const presets = target ? PRESETS[target.unit] ?? [] : [];

  return (
    <div className="modal-layer editor-layer" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <section className="product-editor sales-link" role="dialog" aria-modal="true" aria-label={`Enlazar ${item.name}`}>
        <header className="editor-header">
          <div>
            <p className="eyebrow">Artículo del TPV · código {item.code}</p>
            <h2>{item.name}</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </header>
        <div className="editor-body sales-link-body">
          <p className="sales-link-help">¿Qué se gasta al venderlo? Elige el plato (su escandallo) o el producto. Se aplica a todos los días, también a los ya importados.</p>
          {target ? (
            <div className="sales-link-target">
              <div>
                <small>{target.detail}</small>
                <strong>{target.name}</strong>
              </div>
              <button className="ghost-button" onClick={() => { setTarget(null); setQuery(item.name); }}>Cambiar</button>
            </div>
          ) : (
            <>
              <div className="catalog-search">
                <Search size={16} />
                <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar plato, elaboración o producto" aria-label="Buscar a qué enlazar" />
              </div>
              <div className="sales-link-results">
                {matches.map((t) => (
                  <button key={`${t.kind}-${t.id}`} onClick={() => pick(t)}>
                    <strong>{t.name}</strong><small>{t.detail}</small>
                  </button>
                ))}
                {query && matches.length === 0 && <p className="sales-link-help">Nada con ese nombre. Prueba con otra palabra.</p>}
              </div>
            </>
          )}
          {target && (
            <label className="sales-link-qty">
              <span>Cantidad por venta</span>
              <span className="sales-link-qty-row">
                <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Cantidad por venta" />
                <b>{unit}</b>
                {presets.map(([label, v]) => (
                  <button type="button" key={label} className={`ghost-button${Number(parseDecimal(qty)) === v ? " on" : ""}`} onClick={() => setQty(String(v))}>{label}</button>
                ))}
              </span>
            </label>
          )}
          {error && <p className="import-error" role="alert">{error}</p>}
        </div>
        <footer className="editor-footer sales-link-foot">
          <button className="ghost-button" onClick={() => void save(true)} disabled={saving}>Sin coste (servicio, descuento…)</button>
          <span />
          <button className="ghost-button" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="catalog-primary" onClick={() => void save(false)} disabled={saving || !target}>Guardar</button>
        </footer>
      </section>
    </div>
  );
}
