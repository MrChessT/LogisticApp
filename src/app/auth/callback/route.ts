import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { safeNext } from "@/lib/team";

// Enlaces de email con ?code= (flujo PKCE de Supabase). Solo funcionan en el mismo navegador en el que se
// pidió el enlace; si no se puede abrir la sesión (otro dispositivo, caducado, ya usado) se vuelve al acceso
// con un aviso en vez de llevar a una pantalla que pide iniciar sesión sin explicar nada.
// Las plantillas de email recomendadas usan /auth/confirm (token_hash), que funciona en cualquier dispositivo.

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/login?error=enlace", url.origin));
  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/login?error=enlace", url.origin));
  // Destino tras el enlace (p. ej. /cuenta al recuperar la contraseña). Solo rutas internas.
  return NextResponse.redirect(new URL(safeNext(url.searchParams.get("next")), url.origin));
}
