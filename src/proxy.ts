import { type NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/middleware";

// Next 16: "proxy" sustituye a "middleware" y corre en Node (no en edge).
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

// /api queda fuera: las rutas de API validan la sesión ellas mismas (y responden 401 en JSON),
// así no se verifica la sesión dos veces por petición.
export const config = {
  // Fuera: la API, los estáticos y el lector de albaranes (public/ocr: modelos y código, sin datos).
  matcher: ["/((?!api/|_next/static|_next/image|ocr/|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
