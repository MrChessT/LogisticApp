/**
 * Enlace de acceso a la propia app (no a Supabase): /auth/confirm verifica el código de un solo uso y
 * abre la sesión; la persona llega a su cuenta para poner nombre y contraseña.
 */
export function accessLink(origin: string, properties: { hashed_token: string; verification_type: string }): string {
  const url = new URL("/auth/confirm", origin);
  url.searchParams.set("token_hash", properties.hashed_token);
  url.searchParams.set("type", properties.verification_type);
  url.searchParams.set("next", "/cuenta?bienvenida=1");
  return url.toString();
}
