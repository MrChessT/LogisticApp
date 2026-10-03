/**
 * Enlace de acceso a la propia app (no a Supabase): /auth/confirm verifica el código de un solo uso y
 * abre la sesión. Una persona llega a su cuenta para poner nombre y contraseña; una pantalla, al almacén.
 */
export function accessLink(
  origin: string,
  properties: { hashed_token: string; verification_type: string },
  next = "/cuenta?bienvenida=1",
): string {
  const url = new URL("/auth/confirm", origin);
  url.searchParams.set("token_hash", properties.hashed_token);
  url.searchParams.set("type", properties.verification_type);
  url.searchParams.set("next", next);
  return url.toString();
}

/** Las pantallas de almacén no tienen email real: una dirección interna que nunca recibe correo. */
export const KIOSK_EMAIL_DOMAIN = "pantallas.logisticapp.invalid";
