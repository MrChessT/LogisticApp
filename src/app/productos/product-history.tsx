"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { LoadingRows } from "@/components/ui/loading-rows";

// Historial de un producto (o proveedor): lo escribe la base de datos con cada cambio (0034) y nadie lo
// edita. Los cambios de precio solo los ve quien tiene el permiso «ve costes».

type Change = { id: number; part: string; field: string; old: string | null; next: string | null; who: string; at: string };

const FIELD_LABEL: Record<string, string> = {
  name: "Nombre", sku: "Código", category_id: "Familia", dimension: "Medida", vat_rate: "IVA %", track_stock: "Lleva stock",
  active: "Activo", notes: "Notas", qty_base: "Contenido", barcode: "Código de barras", is_count_default: "Formato de conteo",
  is_purchase_default: "Formato de compra", is_serving: "Formato de servicio", full_weight_g: "Peso llena (g)", empty_weight_g: "Peso vacía (g)",
  last_price: "Precio", supplier_ref: "Ref. proveedor", min_qty: "Mínimo", par_qty: "Máximo", default_area_id: "Zona habitual",
  code: "Código", tax_id: "CIF", email: "Email", phone: "Teléfono", contact_name: "Contacto", order_days: "Días de pedido",
  order_cutoff: "Hora límite", lead_time_hours: "Plazo (horas)", min_order: "Pedido mínimo", payment_terms: "Forma de pago", location_ids: "Locales",
};
const DIMENSION: Record<string, string> = { count: "unidades", volume: "volumen", mass: "peso" };

function show(field: string, value: string | null) {
  if (value === null || value === "") return "—";
  if (field === "dimension") return DIMENSION[value] ?? value;
  return value;
}

export function EntityHistory({ entityId, emptyText = "Todavía no hay cambios registrados." }: { entityId: string; emptyText?: string }) {
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      if (!supabase) return;
      const { data, error: err } = await supabase
        .from("catalog_changes")
        .select("id, part, field, old_value, new_value, changed_by, changed_at")
        .eq("entity_id", entityId)
        .order("changed_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(300);
      if (cancelled) return;
      if (err) return setError("No se pudo cargar el historial.");
      const ids = [...new Set((data ?? []).map((r) => r.changed_by).filter(Boolean))] as string[];
      const { data: people } = ids.length ? await supabase.from("profiles").select("user_id, full_name").in("user_id", ids) : { data: [] };
      const names = new Map((people ?? []).map((p) => [p.user_id as string, (p.full_name as string | null) ?? ""]));
      if (cancelled) return;
      setChanges(
        (data ?? []).map((r) => ({
          id: r.id as number,
          part: r.part as string,
          field: r.field as string,
          old: r.old_value as string | null,
          next: r.new_value as string | null,
          who: r.changed_by ? names.get(r.changed_by as string) || "Alguien del equipo" : "Sistema (importación o proceso automático)",
          at: r.changed_at as string,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [entityId]);

  if (error) return <div className="catalog-empty"><strong>{error}</strong></div>;
  if (!changes) return <LoadingRows label="Cargando historial" />;
  if (changes.length === 0) return <div className="catalog-empty"><strong>{emptyText}</strong></div>;
  return (
    <ol className="history-list">
      {changes.map((c) => (
        <li key={c.id}>
          <time dateTime={c.at}>{new Date(c.at).toLocaleString("es-ES", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
          <div>
            <b>{c.part}</b>
            {c.field === "alta" ? (
              <span> · alta</span>
            ) : c.field === "baja" ? (
              <span> · eliminado</span>
            ) : (
              <span> · {FIELD_LABEL[c.field] ?? c.field}: <s>{show(c.field, c.old)}</s> → <strong>{show(c.field, c.next)}</strong></span>
            )}
            <small>{c.who}</small>
          </div>
        </li>
      ))}
    </ol>
  );
}
