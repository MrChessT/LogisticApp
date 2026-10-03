import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

// Cliente con la clave de servicio (salta RLS). SOLO en rutas del servidor y SOLO para lo que un usuario
// no puede hacer con su sesión: crear la cuenta de una persona invitada y generar su enlace de acceso.
// Quién puede invitar a quién lo decide antes la base de datos con la sesión de quien invita
// (team_check_assign / team_set_member). La clave nunca lleva NEXT_PUBLIC_: no llega al navegador.

export function adminConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export function createAdminClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en el servidor.");
  return createSupabaseClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
