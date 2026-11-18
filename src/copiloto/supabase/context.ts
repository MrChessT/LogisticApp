import { createHash } from "node:crypto";
import { ROLES, type Role } from "../contract/index";
import { baseUnitOf, type Dimension, type RecipeRef, type SessionContext } from "../domain";
import { AuthError, type AuthUser, type ContextPort } from "../security/auth";
import { palabrasOcultas } from "../especialistas/cuentas";
import { DataError, readAll, userClient, type SupabaseSettings } from "./client";

interface ProductRow {
  id: string;
  name: string;
  dimension: Dimension;
  category_id: string | null;
  category: { name: string } | null;
  notes: string | null;
  packs: Array<{ id: string; name: string; qty_base: string; is_count_default: boolean; is_purchase_default: boolean; is_serving?: boolean; active: boolean }>;
}

/** Lectura paginada con la misma forma `{ data, error }` que una consulta suelta. */
function settle<T>(rows: Promise<T[]>): Promise<{ data: T[] | null; error: unknown }> {
  return rows.then(
    (data) => ({ data, error: null }),
    (error: unknown) => ({ data: null, error: error instanceof DataError ? error.cause : error }),
  );
}

function fail(what: string, error: unknown): never {
  throw new DataError(`No se pudo leer ${what}`, { cause: error });
}

/** Contexto del usuario leído con su JWT: rol, locales accesibles (RLS), espacios y catálogo. */
export class SupabaseContext implements ContextPort {
  constructor(private readonly settings: SupabaseSettings) {}

  async load(user: AuthUser, orgId: string): Promise<SessionContext> {
    const db = userClient(this.settings, user.token);

    // Todo en una sola ronda. RLS limita cada tabla igual que antes; la pertenencia se comprueba la
    // primera, así un usuario ajeno recibe "forbidden" aunque el resto de consultas hayan fallado.
    // Los espacios se filtran por el join con sus locales (activos, de la organización) en lugar de
    // esperar a tener la lista de locales: mismo resultado, una petición menos en serie.
    const [membership, locations, products, areas, suppliers, categories, archived, scope, hidden, recipes] = await Promise.all([
      // «*»: también assistant_test (0025) sin romper si esa migración aún no está aplicada.
      db.from("memberships").select("*").eq("org_id", orgId).eq("user_id", user.userId).maybeSingle(),
      db.from("locations").select("id,name,timezone,day_cutoff").eq("org_id", orgId).eq("active", true).order("name"),
      // Más de 1000 productos no caben en una respuesta de PostgREST: se lee por páginas.
      settle(
        readAll<ProductRow>("el catálogo", (from, to) =>
          db
            .from("products")
            .select("id,name,dimension,notes,category_id,category:categories(name),packs:product_packs(*)")
            .eq("org_id", orgId)
            .eq("active", true)
            .order("name")
            .order("id")
            .range(from, to)
            .overrideTypes<ProductRow[], { merge: false }>(),
        ),
      ),
      db
        .from("storage_areas")
        .select("id,location_id,name,kind,location:locations!inner(org_id,active)")
        .eq("active", true)
        .eq("location.org_id", orgId)
        .eq("location.active", true)
        .order("sort_order"),
      db.from("suppliers").select("id,name").eq("org_id", orgId).eq("active", true).order("name"),
      db.from("categories").select("id,name,parent_id").eq("org_id", orgId).order("name"),
      settle(
        readAll<{ id: string; name: string }>("los archivados", (from, to) =>
          db.from("products").select("id,name").eq("org_id", orgId).eq("active", false).order("name").order("id").range(from, to),
        ),
      ),
      // Cuentas de análisis (0055) y palabras de lo que no ve (0059): si fallan, sin alcance que explicar.
      db.from("membership_accounts").select("account_id").eq("org_id", orgId).eq("user_id", user.userId),
      // Son miles de palabras: por páginas, como el catálogo (una respuesta trae 1000 filas como mucho).
      settle(readAll<{ word: string; account: string }>("las palabras fuera de alcance", (from, to) => db.rpc("hidden_catalog_words").range(from, to))),
      // Escandallos que ve (RLS, también por cuentas): para reconocer «añade 20 g de queso a las croquetas».
      settle(readAll<{ id: string; name: string; kind: string; yield_unit: string }>("los escandallos", (from, to) =>
        db.from("recipes").select("id,name,kind,yield_unit").eq("org_id", orgId).eq("active", true).order("name").order("id").range(from, to),
      )),
    ]);
    if (membership.error) fail("la pertenencia", membership.error);
    const role = membership.data?.role as Role | undefined;
    if (!role || !ROLES.includes(role)) throw new AuthError("forbidden", "No perteneces a esta organización");
    if (locations.error) fail("los locales", locations.error);
    if (products.error) fail("el catálogo", products.error);
    if (areas.error) fail("los espacios", areas.error);
    // Proveedores, categorías y archivados solo alimentan las acciones de catálogo: si fallan, el resto sigue.
    const refs = (result: { data: unknown; error: unknown }) =>
      result.error ? [] : ((result.data ?? []) as Array<{ id: string; name: string }>).map((r) => ({ id: String(r.id), name: String(r.name) }));

    const productRows = (products.data ?? []) as unknown as ProductRow[];
    // Categoría con su familia («Destilados › Ginebra»): el asistente encuentra los productos tanto
    // por el tipo como por la familia.
    const categoryRows = (categories.error ? [] : (categories.data ?? [])) as Array<{ id: string; name: string; parent_id: string | null }>;
    const categoryById = new Map(categoryRows.map((c) => [c.id, c]));
    const categoryPath = (p: ProductRow): string | null => {
      const own = (p.category_id && categoryById.get(p.category_id)) || null;
      const parent = own?.parent_id ? categoryById.get(own.parent_id) : undefined;
      if (own && parent) return `${parent.name} › ${own.name}`;
      return own?.name ?? p.category?.name ?? null;
    };
    const catalogHash = createHash("sha256")
      .update(JSON.stringify(productRows.map((p) => [p.id, p.name, p.category?.name ?? null, p.notes ?? null, p.packs.map((k) => [k.id, k.name, k.qty_base])])))
      .digest("hex")
      .slice(0, 16);

    const accountIds = scope.error ? [] : (scope.data ?? []).map((r) => r.account_id);
    const cuentas = accountIds.map((id) => categoryById.get(id)?.name).filter((n): n is string => !!n);
    const visibles = [...productRows.map((p) => `${p.name} ${categoryPath(p) ?? ""}`), ...(locations.data ?? []).map((l) => String(l.name))];
    const alcance = cuentas.length > 0 ? { cuentas, palabrasOcultas: palabrasOcultas(hidden.error ? [] : (hidden.data ?? []), visibles) } : {};

    return {
      userId: user.userId,
      orgId,
      role,
      seesCosts: role === "owner" || role === "admin" || role === "manager" || (role === "staff" && membership.data?.can_see_costs === true),
      locations: (locations.data ?? []).map((l) => ({
        id: l.id as string,
        name: l.name as string,
        timezone: (l.timezone as string) ?? "Europe/Madrid",
        dayCutoff: ((l.day_cutoff as string) ?? "06:00").slice(0, 5),
      })),
      areas: (areas.data ?? []).map((a) => ({ id: a.id as string, locationId: a.location_id as string, name: a.name as string, kind: a.kind === "servicio" ? ("servicio" as const) : ("almacen" as const) })),
      products: productRows.map((p) => ({
        id: p.id,
        name: p.name,
        dimension: p.dimension,
        baseUnit: baseUnitOf(p.dimension),
        category: categoryPath(p),
        notes: p.notes ?? null,
        packs: p.packs
          .filter((k) => k.active)
          .map((k) => ({ id: k.id, name: k.name, qtyBase: String(k.qty_base), isCountDefault: k.is_count_default, isPurchaseDefault: k.is_purchase_default, ...(k.is_serving ? { isServing: true } : {}) })),
      })),
      suppliers: refs(suppliers),
      categories: refs(categories),
      archivedProducts: refs(archived),
      catalogHash,
      testMode: (membership.data as { assistant_test?: boolean } | null)?.assistant_test === true,
      recipes: recipes.error ? [] : (recipes.data ?? []).map((r) => ({
        id: r.id, name: r.name, kind: r.kind === "elaboracion" ? ("elaboracion" as const) : ("plato" as const),
        yieldUnit: (["g", "ml", "ud"].includes(r.yield_unit) ? r.yield_unit : "racion") as RecipeRef["yieldUnit"],
      })),
      ...alcance,
    };
  }
}
