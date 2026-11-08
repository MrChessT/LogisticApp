"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ALLERGENS } from "@/lib/recipes";

// Los 14 alérgenos de declaración obligatoria de un producto. Se guardan al marcarlos; las recetas que
// lo usan los heredan solas (también a través de sus elaboraciones).
export function ProductAllergens({ productId, canEdit }: { productId: string; canEdit: boolean }) {
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error: err } = (await createClient()?.from("product_allergens").select("allergen").eq("product_id", productId)) ?? { data: null, error: null };
      if (cancelled) return;
      if (err) return setError("No se pudieron cargar los alérgenos.");
      setSelected(new Set((data ?? []).map((r) => r.allergen)));
    })();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  async function toggle(id: string) {
    const supabase = createClient();
    if (!supabase || !selected) return;
    setBusy(id);
    const on = !selected.has(id);
    const { error: err } = on
      ? await supabase.from("product_allergens").insert({ product_id: productId, allergen: id })
      : await supabase.from("product_allergens").delete().eq("product_id", productId).eq("allergen", id);
    setBusy("");
    if (err) return setError(err.code === "42501" ? "Solo encargados y administración cambian los alérgenos." : "No se pudo guardar.");
    setError("");
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  }

  if (!selected) return <div className="catalog-empty"><strong>{error || "Cargando alérgenos..."}</strong></div>;
  return (
    <div className="editor-section">
      <p className="section-hint">Marca los que contiene (también trazas declaradas por el proveedor). Los platos y elaboraciones que lo usan los muestran solos. Se guarda al marcar.</p>
      <div className="allergen-grid">
        {ALLERGENS.map((a) => (
          <label key={a.id} className={`check-option allergen-option ${selected.has(a.id) ? "on" : ""}`}>
            <input type="checkbox" checked={selected.has(a.id)} disabled={!canEdit || busy === a.id} onChange={() => void toggle(a.id)} /> {a.label}
          </label>
        ))}
      </div>
      {error && <p className="editor-message error">{error}</p>}
    </div>
  );
}
