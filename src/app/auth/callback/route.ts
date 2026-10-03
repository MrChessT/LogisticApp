import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { safeNext } from "@/lib/team";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }
  // Destino tras el enlace (p. ej. /cuenta al recuperar la contraseña). Solo rutas internas.
  const target = new URL(safeNext(url.searchParams.get("next")), url.origin);
  return NextResponse.redirect(target.origin === url.origin ? target : new URL("/", url.origin));
}
