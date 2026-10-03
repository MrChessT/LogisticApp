import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { teamErrorMessage } from "@/lib/team";
import { accessLink } from "@/lib/access-link";

// Invitar a una persona al equipo.
//  1. La base de datos comprueba, con la sesión de quien invita, que puede dar ese rol en esos locales.
//  2. Con la clave de servicio se crea su cuenta y su enlace de acceso (si ya tenía cuenta, se reutiliza).
//  3. De nuevo con la sesión de quien invita, team_set_member le da el rol y los locales.
// El enlace se devuelve para compartirlo (WhatsApp, email…): no depende del correo de Supabase.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  email: z.email().max(254),
  fullName: z.string().trim().max(120).optional(),
  role: z.enum(["owner", "admin", "manager", "staff"]),
  allLocations: z.boolean().default(false),
  locationIds: z.array(z.uuid()).max(100).default([]),
  canValidate: z.boolean().optional(),
});

const fail = (status: number, message: string) => NextResponse.json({ message }, { status });

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const actorId = claims?.claims?.sub;
  if (!actorId) return fail(401, "Inicia sesión de nuevo.");

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "Revisa el email, el rol y los locales.");
  const { email, fullName, role, allLocations, locationIds, canValidate } = parsed.data;

  if (!adminConfigured()) {
    return fail(503, "Falta configurar la clave de servicio de Supabase en el servidor (SUPABASE_SERVICE_ROLE_KEY).");
  }

  // 1. ¿Puede quien invita dar este rol en estos locales?
  const check = await supabase.rpc("team_check_assign", { p_role: role, p_all_locations: allLocations, p_locations: locationIds });
  if (check.error) return fail(403, teamErrorMessage(check.error));
  const orgId = check.data;

  // 2. Cuenta de la persona: la que ya tenga o una nueva, y su enlace de acceso.
  const admin = createAdminClient();
  const { data: existingId } = await admin.rpc("auth_user_id_by_email", { p_email: email });
  if (existingId) {
    const { data: already } = await supabase.from("memberships").select("user_id").eq("org_id", orgId).eq("user_id", existingId).maybeSingle();
    if (already) return fail(409, "Esa persona ya está en el equipo: cambia su acceso desde la lista.");
  }
  // Una cuenta que ya existe no recibe enlace de entrada (sería entrar en la cuenta de otra persona):
  // se le da acceso y entra con su contraseña. Solo una cuenta nueva lleva su enlace de invitación.
  let userId = existingId ?? "";
  let link: string | null = null;
  if (!existingId) {
    const generated = await admin.auth.admin.generateLink({ type: "invite", email, options: { data: fullName ? { full_name: fullName } : {} } });
    if (generated.error || !generated.data.user) return fail(502, "No se pudo crear el acceso. Inténtalo de nuevo.");
    userId = generated.data.user.id;
    link = accessLink(request.nextUrl.origin, generated.data.properties);
  }

  // 3. Rol y locales, con la sesión de quien invita (la base de datos vuelve a comprobarlo todo).
  const set = await supabase.rpc("team_set_member", {
    p_user: userId,
    p_role: role,
    p_all_locations: allLocations,
    p_locations: locationIds,
    p_full_name: fullName ?? null,
    p_can_validate: role === "staff" ? (canValidate ?? false) : null,
  });
  if (set.error) {
    // Una cuenta recién creada que no ha podido entrar al equipo no debe quedarse huérfana.
    if (!existingId) await admin.auth.admin.deleteUser(userId);
    return fail(403, teamErrorMessage(set.error));
  }

  return NextResponse.json({ userId, existing: !!existingId, link });
}

