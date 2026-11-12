"use client";

// Permisos de la persona que usa la app, para lo que se enseña en pantalla. La base de datos decide de
// verdad (RLS y funciones); esto solo evita enseñar cifras o botones que no le corresponden.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type Permissions = { role: string; seesCosts: boolean };

let cache: { userId: string; value: Permissions } | null = null;

function seesCostsFor(role: string, canSeeCosts: boolean): boolean {
  return role === "owner" || role === "admin" || role === "manager" || (role === "staff" && canSeeCosts);
}

/**
 * null mientras carga. Sin pertenencia: sin costes. Justo después de entrar, la sesión a veces aún no
 * está en el navegador: antes eso se tomaba por «sin sesión» y la pantalla se quedaba en «Sin permiso»
 * aunque la cuenta viera costes. Ahora se espera a que llegue la sesión.
 */
export function usePermissions(): Permissions | null {
  const [value, setValue] = useState<Permissions | null>(null);
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    async function load(userId: string) {
      if (cache && cache.userId === userId) {
        if (!cancelled) setValue(cache.value);
        return;
      }
      const { data } = (await supabase?.from("memberships").select("role, can_see_costs").eq("user_id", userId).limit(1).maybeSingle()) ?? { data: null };
      const row = data as { role: string; can_see_costs: boolean | null } | null;
      const perms = { role: row?.role ?? "", seesCosts: row ? seesCostsFor(row.role, row.can_see_costs === true) : false };
      cache = { userId, value: perms };
      if (!cancelled) setValue(perms);
    }
    const sub = supabase?.auth.onAuthStateChange((_event, session) => {
      const id = session?.user.id;
      if (id) void load(id);
    });
    void (async () => {
      const userId = (await supabase?.auth.getSession())?.data.session?.user.id ?? "";
      if (userId) await load(userId);
    })();
    return () => {
      cancelled = true;
      sub?.data.subscription.unsubscribe();
    };
  }, []);
  return value;
}
