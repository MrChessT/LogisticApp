"use client";

// Quién usa la app y en qué organización: nombre, puesto, organización y locales. Se lee una vez por
// sesión y lo comparten el menú y las pantallas (sin repetir la consulta al cambiar de pantalla).
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ROLE_LABEL, type Role } from "@/lib/team";

export type IdentityLocation = { id: string; name: string };
export type Identity = {
  userId: string;
  name: string;
  initials: string;
  role: string;
  roleKey: Role | "";
  org: string;
  locations: IdentityLocation[];
  /** Pantalla de almacén (kiosko): sin menú ni asistente. */
  kiosk: boolean;
};

export function initialsOf(name: string): string {
  const parts = name.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

let cache: { userId: string; value: Identity | null; at: number } | null = null;
let inflight: Promise<Identity | null> | null = null;
const TTL_MS = 5 * 60 * 1000;

/** null: sin sesión o sin organización. */
export async function loadIdentity(force = false): Promise<Identity | null> {
  const supabase = createClient();
  if (!supabase) return null;
  const { data: session } = await supabase.auth.getSession();
  const user = session.session?.user;
  if (!user) {
    cache = null;
    return null;
  }
  if (!force && cache && cache.userId === user.id && Date.now() - cache.at < TTL_MS) return cache.value;
  if (inflight && !force) return inflight;
  inflight = (async () => {
    const [profile, membership, locations] = await Promise.all([
      supabase.from("profiles").select("full_name").eq("user_id", user.id).maybeSingle(),
      supabase.from("memberships").select("role, organizations(name)").eq("user_id", user.id).limit(1).maybeSingle(),
      supabase.from("locations").select("id, name").eq("active", true).order("name"),
    ]);
    const name = profile.data?.full_name?.trim() || user.email?.split("@")[0] || "Usuario";
    const member = membership.data as { role: Role; organizations: { name: string } | null } | null;
    const value: Identity | null = member
      ? {
          userId: user.id,
          name,
          initials: initialsOf(name),
          role: ROLE_LABEL[member.role],
          roleKey: member.role,
          org: member.organizations?.name ?? "Tu organización",
          locations: (locations.data ?? []) as IdentityLocation[],
          kiosk: user.app_metadata?.kiosk === true,
        }
      : null;
    cache = { userId: user.id, value, at: Date.now() };
    return value;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** undefined mientras carga; null sin sesión u organización. */
export function useIdentity(): Identity | null | undefined {
  const [value, setValue] = useState<Identity | null | undefined>(cache?.value ?? undefined);
  useEffect(() => {
    let cancelled = false;
    void loadIdentity().then((v) => {
      if (!cancelled) setValue(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return value;
}

/** Al cerrar sesión: que el siguiente usuario no vea el nombre del anterior. */
export function forgetIdentity(): void {
  cache = null;
}
