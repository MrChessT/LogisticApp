"use client";

import { useEffect, useMemo, useState } from "react";
import { Receipt, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { euros, parseDecimal } from "@/lib/format";

// PVP de los platos según lo que cobra el TPV (tpv_sale_prices, migración 0042). Sin PVP, Escandallos
// no puede dar food cost ni margen; con las ventas importadas, el precio real sale de ahí.

export type TpvPrice = {
  recipeId: string;
  name: string;
  current: number | null;
  suggested: number;
  portions: number;
  days: number;
  item: string;
};

/** Diferencia que merece avisar entre el PVP del escandallo y lo que cobra el TPV. */
const DIFF = 0.05;
const differs = (p: TpvPrice) => p.current !== null && Math.abs(p.suggested - p.current) / p.current >= DIFF;

export function useTpvPrices(orgId: string, enabled: boolean) {
  const [prices, setPrices] = useState<TpvPrice[]>([]);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!orgId || !enabled) return;
    let cancelled = false;
    void (async () => {
      const { data } = (await createClient()?.rpc("tpv_sale_prices", { p_org: orgId })) ?? { data: null };
      if (cancelled) return;
      setPrices((data ?? []).map((r) => ({
        recipeId: r.recipe_id, name: r.recipe_name, current: r.current_price === null ? null : Number(r.current_price),
        suggested: Number(r.suggested_price), portions: Number(r.portions_sold), days: r.days, item: r.item_name,
      })));
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, enabled, version]);
  return { prices, refresh: () => setVersion((v) => v + 1) };
}

/** Aviso en Escandallos: platos sin PVP (o con uno distinto) que sí tienen precio en el TPV. */
export function TpvPricesBanner({ prices, onOpen }: { prices: TpvPrice[]; onOpen: () => void }) {
  const missing = prices.filter((p) => p.current === null).length;
  const other = prices.filter(differs).length;
  if (!missing && !other) return null;
  return (
    <div className="tpv-banner">
      <Receipt size={18} aria-hidden="true" />
      <p>
        {missing > 0 && <><b>{missing} {missing === 1 ? "plato sin PVP se vende" : "platos sin PVP se venden"} en el TPV.</b> Toma su precio de ahí para ver su food cost y su margen. </>}
        {other > 0 && <>{other} {other === 1 ? "plato tiene" : "platos tienen"} un PVP distinto del que cobra el TPV.</>}
      </p>
      <button className="catalog-primary" onClick={onOpen}>Revisar PVP del TPV</button>
    </div>
  );
}

export function TpvPricesDialog({ prices, onClose, onApplied }: { prices: TpvPrice[]; onClose: () => void; onApplied: () => void }) {
  const rows = useMemo(() => prices.filter((p) => p.current === null || differs(p)), [prices]);
  // Por defecto se aplican los que no tienen PVP; los que ya tienen uno distinto, solo si se marcan.
  const [chosen, setChosen] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.filter((p) => p.current === null).map((p) => [p.recipeId, p.suggested.toFixed(2).replace(".", ",")])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const count = Object.keys(chosen).length;

  function toggle(p: TpvPrice) {
    setChosen((c) => {
      const next = { ...c };
      if (p.recipeId in next) delete next[p.recipeId];
      else next[p.recipeId] = p.suggested.toFixed(2).replace(".", ",");
      return next;
    });
  }

  async function apply() {
    const updates = Object.entries(chosen).map(([id, v]) => ({ id, price: parseDecimal(v) }));
    const bad = updates.find((u) => u.price === null || Number(u.price) <= 0);
    if (bad) return setError(`Revisa el precio de «${rows.find((r) => r.recipeId === bad.id)?.name ?? "un plato"}».`);
    const supabase = createClient();
    if (!supabase) return;
    setSaving(true);
    setError("");
    for (let i = 0; i < updates.length; i += 10) {
      const results = await Promise.all(updates.slice(i, i + 10).map((u) => supabase.from("recipes").update({ sale_price: Number(u.price) }).eq("id", u.id)));
      if (results.some((r) => r.error)) {
        setSaving(false);
        return setError("No se pudieron guardar todos los precios. Vuelve a intentarlo.");
      }
    }
    setSaving(false);
    onApplied();
  }

  return (
    <div className="modal-layer editor-layer" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <section className="product-editor tpv-dialog" role="dialog" aria-modal="true" aria-label="PVP desde el TPV">
        <header className="editor-header">
          <div>
            <p className="eyebrow">Escandallos · PVP</p>
            <h2>PVP desde el TPV</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </header>
        <div className="editor-body">
          <p className="tpv-help">Lo cobrado por ración en el TPV (sin IVA), con el IVA del plato y redondeado a 5 céntimos. Revisa y aplica: el food cost y el margen de esos platos aparecen al momento.</p>
          <div className="tpv-list">
            {rows.map((p) => {
              const on = p.recipeId in chosen;
              return (
                <label key={p.recipeId} className={`tpv-row${on ? " on" : ""}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(p)} />
                  <span className="tpv-name">
                    <strong>{p.name}</strong>
                    <small>{p.portions.toLocaleString("es-ES", { maximumFractionDigits: 1 })} raciones en {p.days} {p.days === 1 ? "día" : "días"}{p.item !== p.name ? ` · «${p.item}»` : ""}{p.current !== null ? ` · ahora ${euros(p.current)}` : " · sin PVP"}</small>
                  </span>
                  <input
                    className="tpv-price"
                    inputMode="decimal"
                    aria-label={`PVP de ${p.name}`}
                    disabled={!on}
                    value={on ? chosen[p.recipeId] : p.suggested.toFixed(2).replace(".", ",")}
                    onChange={(e) => setChosen((c) => ({ ...c, [p.recipeId]: e.target.value }))}
                  />
                  <span className="tpv-eur">€</span>
                </label>
              );
            })}
          </div>
          {error && <p className="import-error" role="alert">{error}</p>}
        </div>
        <footer className="editor-footer">
          <button className="ghost-button" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="catalog-primary" onClick={() => void apply()} disabled={saving || count === 0}>{saving ? "Guardando…" : `Aplicar ${count} PVP`}</button>
        </footer>
      </section>
    </div>
  );
}
