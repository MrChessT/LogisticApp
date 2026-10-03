import { createClient } from "@/lib/supabase/client";
import type { UnitDimension } from "@/lib/units";
import type { PackRow } from "@/lib/packs";

// Buscador de productos en el servidor (product_lookup, migración 0020): los formularios piden los
// pocos productos que encajan con lo escrito en vez de descargar el catálogo entero.

export type LookupPack = { id: string; name: string; qty: string; count: boolean; purchase: boolean; price: string | null };
export type LookupProduct = {
  id: string;
  name: string;
  dimension: UnitDimension;
  base_unit: string;
  category: string | null;
  family: string | null;
  in_location: boolean;
  stock: string | null;
  packs: LookupPack[];
};

export type LookupOptions = { locationId?: string | null; supplierId?: string | null; limit?: number };

const CACHE_MAX = 80;
const CACHE_TTL = 60_000;
const cache = new Map<string, { at: number; value: Promise<LookupProduct[]> }>();

/** Busca productos; repetir la misma búsqueda en el último minuto no vuelve a ir a la red. */
export function lookupProducts(search: string, options: LookupOptions = {}): Promise<LookupProduct[]> {
  const key = [search.trim().toLowerCase(), options.locationId ?? "", options.supplierId ?? "", options.limit ?? 8].join("|");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value;
  const value = (async () => {
    const supabase = createClient();
    if (!supabase) return [];
    const { data, error } = await supabase.rpc("product_lookup", {
      p_search: search.trim() || null,
      p_location: options.locationId || null,
      p_supplier: options.supplierId || null,
      p_limit: options.limit ?? 8,
    });
    if (error) throw new Error("No se pudo buscar productos.");
    return (data ?? []) as unknown as LookupProduct[];
  })();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return value;
}

/** Tras guardar algo que cambia stock o precios, las búsquedas siguientes van a la red. */
export function clearLookupCache() {
  cache.clear();
}

/** Formatos del buscador con la forma que usan unitChoices / countingPacks. */
export function lookupPackRows(product: LookupProduct): PackRow[] {
  return product.packs.map((k) => ({ id: k.id, name: k.name, qty_base: k.qty, is_count_default: k.count, is_purchase_default: k.purchase, active: true }));
}

/** Formato de compra: el marcado por defecto o, si no hay, el más grande. */
export function purchasePack(product: LookupProduct): LookupPack | null {
  return product.packs.find((k) => k.purchase) ?? [...product.packs].sort((a, b) => Number(b.qty) - Number(a.qty))[0] ?? null;
}
