import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { teamErrorMessage } from "@/lib/team";
import { accessLink, KIOSK_EMAIL_DOMAIN } from "@/lib/access-link";

// Pantallas de almacén: una cuenta por tablet, ligada a un local, que solo entra en /almacen.
//  POST   → la crea (sin email real) y devuelve su enlace para abrirlo en la tablet.
//  DELETE → le quita el acceso y la bloquea (su historial conserva el nombre).
// Como al invitar: la base de datos decide primero, con la sesión de quien lo pide, si puede hacerlo;
// la clave de servicio solo crea o bloquea la cuenta.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Create = z.object({ name: z.string().trim().min(1).max(60), locationId: z.uuid() });
const Remove = z.object({ userId: z.uuid() });
const fail = (status: number, message: string) => NextResponse.json({ message }, { status });

async function session() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  return claims?.claims?.sub ? supabase : null;
}

export async function POST(request: NextRequest) {
  const supabase = await session();
  if (!supabase) return fail(401, "Inicia sesión de nuevo.");
  const parsed = Create.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "Escribe un nombre y elige el local.");
  if (!adminConfigured()) return fail(503, "Falta configurar la clave de servicio de Supabase en el servidor (SUPABASE_SERVICE_ROLE_KEY).");
  const { name, locationId } = parsed.data;

  // 1. ¿Puede quien lo pide poner una pantalla en este local?
  const check = await supabase.rpc("team_check_assign", { p_role: "kiosk", p_all_locations: false, p_locations: [locationId] });
  if (check.error) return fail(403, teamErrorMessage(check.error));

  // 2. La cuenta de la pantalla: marcada como pantalla (app_metadata, solo la cambia el servidor).
  const admin = createAdminClient();
  const created = await admin.auth.admin.createUser({
    email: `pantalla-${randomUUID()}@${KIOSK_EMAIL_DOMAIN}`,
    email_confirm: true,
    app_metadata: { kiosk: true },
    user_metadata: { full_name: name },
  });
  if (created.error || !created.data.user) return fail(502, "No se pudo crear la pantalla. Inténtalo de nuevo.");
  const user = created.data.user;

  // 3. Rol y local, con la sesión de quien la crea (la base de datos vuelve a comprobarlo todo).
  const set = await supabase.rpc("team_set_member", {
    p_user: user.id,
    p_role: "kiosk",
    p_all_locations: false,
    p_locations: [locationId],
    p_full_name: name,
  });
  if (set.error) {
    await admin.auth.admin.deleteUser(user.id);
    return fail(403, teamErrorMessage(set.error));
  }

  const generated = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email! });
  if (generated.error) return fail(502, "La pantalla está creada, pero no se pudo generar su enlace: pide uno nuevo desde su ficha.");
  return NextResponse.json({ userId: user.id, link: accessLink(request.nextUrl.origin, generated.data.properties, "/almacen") });
}

export async function DELETE(request: NextRequest) {
  const supabase = await session();
  if (!supabase) return fail(401, "Inicia sesión de nuevo.");
  const parsed = Remove.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "Petición no válida.");
  if (!adminConfigured()) return fail(503, "Falta configurar la clave de servicio de Supabase en el servidor (SUPABASE_SERVICE_ROLE_KEY).");

  const { data: team, error } = await supabase.rpc("team_members");
  if (error) return fail(403, "No tienes permiso para gestionar el equipo.");
  const screen = (team ?? []).find((m) => m.user_id === parsed.data.userId);
  if (!screen?.can_edit || screen.role !== "kiosk") return fail(403, "No puedes quitar esa pantalla.");

  const removed = await supabase.rpc("team_remove_member", { p_user: screen.user_id });
  if (removed.error) return fail(403, teamErrorMessage(removed.error, "No se pudo quitar la pantalla."));

  // La cuenta se bloquea en vez de borrarse: lo que apuntó sigue diciendo «Pantalla · Local».
  // Su sesión deja de valer al caducar (como mucho una hora) y, sin acceso, ya no ve nada.
  const admin = createAdminClient();
  const { data: account } = await admin.auth.admin.getUserById(screen.user_id);
  if (account.user?.app_metadata?.kiosk) await admin.auth.admin.updateUserById(screen.user_id, { ban_duration: "876000h" });
  return NextResponse.json({ ok: true });
}
