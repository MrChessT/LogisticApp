import { createClient } from "@/lib/supabase/client";
import { readAll } from "@/lib/supabase/read-all";
import { countingPacks, type PackRow } from "@/lib/packs";
import type { CountingPacks, UnitDimension } from "@/lib/units";

// Catálogo para la hoja de inventario: el único sitio que necesita todos los productos (se cuentan
// todos los del local y, aparte, los demás). Se pide al abrir un conteo, no al entrar en la pantalla,
// y se reutiliza unos minutos para volver a abrirlo al instante.

export type CountProduct = { id: string; name: string; base_unit: string; family: string | null; packs: CountingPacks };

type CategoryRef = { name: string; parent: { name: string } | null } | null;
type Row = { id: string; name: string; base_unit: string; dimension: UnitDimension; product_packs: PackRow[] | null; category: CategoryRef };

const TTL = 5 * 60_000;
let cached: { userId: string; at: number; value: Promise<CountProduct[]> } | null = null;

export async function loadCountCatalog(): Promise<CountProduct[]> {
  const supabase = createClient();
  if (!supabase) return [];
  const userId = (await supabase.auth.getSession()).data.session?.user.id ?? "";
  if (cached && cached.userId === userId && Date.now() - cached.at < TTL) return cached.value;
  const value = (async () => {
    const { data, error } = await readAll((from, to) =>
      supabase
        .from("products")
        .select("id, name, base_unit, dimension, product_packs(name, qty_base, is_count_default, is_purchase_default, active), category:categories(name, parent:parent_id(name))")
        .eq("active", true)
        .order("name")
        .order("id")
        .range(from, to),
    );
    if (error) throw new Error("No se pudo cargar el catálogo.");
    return ((data ?? []) as unknown as Row[]).map((p) => ({
      id: p.id,
      name: p.name,
      base_unit: p.base_unit,
      // Familia (Destilados, Refrescos…): la hoja se agrupa por ella.
      family: p.category?.parent?.name ?? p.category?.name ?? null,
      packs: countingPacks(p.dimension, p.product_packs ?? []),
    }));
  })();
  cached = { userId, at: Date.now(), value };
  value.catch(() => {
    cached = null;
  });
  return value;
}
