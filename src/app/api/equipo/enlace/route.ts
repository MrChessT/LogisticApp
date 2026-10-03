import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { accessLink } from "@/lib/access-link";

// Nuevo enlace de acceso para alguien del equipo que aún no ha entrado (el anterior caducó o no le llegó)
// o para una pantalla de almacén (siempre: es un dispositivo, no una persona).
// Solo para quien puede gestionar a esa persona: lo decide team_members() con la sesión de quien lo pide.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ userId: z.uuid() });
const fail = (status: number, message: string) => NextResponse.json({ message }, { status });

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return fail(401, "Inicia sesión de nuevo.");
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "Petición no válida.");
  if (!adminConfigured()) return fail(503, "Falta configurar la clave de servicio de Supabase en el servidor (SUPABASE_SERVICE_ROLE_KEY).");

  const { data: team, error } = await supabase.rpc("team_members");
  if (error) return fail(403, "No tienes permiso para gestionar el equipo.");
  const member = (team ?? []).find((m) => m.user_id === parsed.data.userId);
  if (!member?.can_edit || !member.email) return fail(403, "No puedes generar un acceso para esa persona.");
  // Una pantalla de almacén no es una persona: quien la gestiona puede volver a vincularla (tablet nueva,
  // sesión cerrada…) cuando quiera. Entra solo en /almacen y la base de datos la aísla.
  const kiosk = member.role === "kiosk";
  // A una persona, solo si aún no ha entrado: un enlace a una cuenta en uso permitiría entrar como ella.
  // Quien ya entró y olvidó su contraseña la recupera desde el acceso («¿Has olvidado la contraseña?»).
  if (!kiosk && !member.pending) return fail(409, "Ya ha entrado alguna vez: si olvidó su contraseña, que use «¿Has olvidado la contraseña?» en el acceso.");

  const generated = await createAdminClient().auth.admin.generateLink({ type: "magiclink", email: member.email });
  if (generated.error) return fail(502, "No se pudo generar el enlace. Inténtalo de nuevo.");
  return NextResponse.json({ link: accessLink(request.nextUrl.origin, generated.data.properties, kiosk ? "/almacen" : undefined) });
}
