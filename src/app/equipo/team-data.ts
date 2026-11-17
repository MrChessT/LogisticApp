import { createClient } from "@/lib/supabase/client";
import { managesTeam, seesAllLocations, teamErrorMessage, type Role } from "@/lib/team";

// Datos de la pantalla Equipo: quién hay, en qué locales y con qué cuentas de análisis.

export type Member = {
  userId: string;
  name: string;
  email: string;
  role: Role;
  allLocations: boolean;
  locationIds: string[];
  lastSignIn: string | null;
  pending: boolean;
  isSelf: boolean;
  canEdit: boolean;
  canValidate: boolean;
  /** Ve costes e importes (0032): siempre para encargados y superiores; al personal se le da aquí. */
  canSeeCosts: boolean;
  /** Modo pruebas del asistente (0025): lo que confirme en el chat no se guarda. */
  testMode: boolean;
  /** Cuentas de análisis a las que se limita (0055/0057). Vacío: todas. */
  accountIds: string[];
};
export type Location = { id: string; name: string };
/** Cuenta de análisis: una familia raíz del catálogo (Bebida, Comida, Menaje…). */
export type Account = { id: string; name: string };
export type Filter = "todos" | "direccion" | "manager" | "staff" | "pendientes";

export async function loadTeam(): Promise<{ actor: Role | null; members: Member[]; locations: Location[]; accounts: Account[] }> {
  const supabase = createClient();
  if (!supabase) throw new Error("Configura las variables de Supabase.");
  const userId = (await supabase.auth.getSession()).data.session?.user.id;
  if (!userId) throw new Error("Inicia sesión de nuevo.");
  const [{ data: me }, { data: locations }] = await Promise.all([
    supabase.from("memberships").select("role").eq("user_id", userId).limit(1).maybeSingle(),
    supabase.from("locations").select("id, name").eq("active", true).order("name"),
  ]);
  const actor = (me?.role ?? null) as Role | null;
  if (!managesTeam(actor)) return { actor, members: [], locations: (locations ?? []) as Location[], accounts: [] };
  const [{ data, error }, { data: flags }, { data: accounts }, { data: scopes }] = await Promise.all([
    supabase.rpc("team_members"),
    // «*»: assistant_test (0025) sin romper si la migración aún no está aplicada.
    supabase.from("memberships").select("*"),
    // Las cuentas que ve quien reparte: si él mismo está limitado, solo las suyas (0056), que son las que puede dar.
    supabase.from("categories").select("id, name").is("parent_id", null).order("sort_order").order("name"),
    supabase.from("membership_accounts").select("user_id, account_id"),
  ]);
  if (error) throw new Error(teamErrorMessage(error, "No se pudo cargar el equipo."));
  const scopeOf = new Map<string, string[]>();
  for (const r of scopes ?? []) scopeOf.set(r.user_id, [...(scopeOf.get(r.user_id) ?? []), r.account_id]);
  const testers = new Set((flags ?? []).filter((m) => m.assistant_test).map((m) => m.user_id));
  return {
    actor,
    locations: (locations ?? []) as Location[],
    accounts: (accounts ?? []) as Account[],
    members: (data ?? []).map((m) => ({
      userId: m.user_id,
      name: m.full_name?.trim() || m.email?.split("@")[0] || "Sin nombre",
      email: m.email ?? "",
      role: m.role,
      allLocations: m.all_locations || seesAllLocations(m.role),
      locationIds: m.location_ids ?? [],
      lastSignIn: m.last_sign_in_at,
      pending: m.pending,
      isSelf: m.is_self,
      canEdit: m.can_edit,
      canValidate: m.can_validate ?? false,
      canSeeCosts: m.can_see_costs ?? false,
      testMode: testers.has(m.user_id),
      accountIds: scopeOf.get(m.user_id) ?? [],
    })),
  };
}
