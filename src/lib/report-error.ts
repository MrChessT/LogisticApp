// Registro de errores (servidor): los guarda con report_app_error (migración 0043) y, la primera vez del
// día que aparece cada uno, avisa por el webhook de alertas (ERROR_WEBHOOK_URL: Slack, Discord o cualquier
// URL que acepte un JSON con «text»). Nunca lanza ni retrasa la respuesta más de 3 s: un fallo al avisar
// no puede empeorar el error original.
//
// Con sesión se registra a nombre de quien lo sufrió (su JWT). Sin sesión (pantalla de acceso, fallos del
// propio servidor) se usa la clave de servicio: la base de datos no deja ejecutar nada sin sesión.

export type ErrorSource = "server" | "client" | "assistant";

export interface ErrorInfo {
  path?: string | null;
  digest?: string | null;
  /** Contexto técnico (ruta de fichero, tipo de render, navegador…). Sin datos del negocio. */
  detail?: Record<string, unknown>;
  /** JWT del usuario, si hay sesión: permite saber a quién le pasó. */
  token?: string | null;
}

const TIMEOUT_MS = 3000;

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return typeof err === "string" ? err : "Error desconocido";
}

export async function reportError(source: ErrorSource, err: unknown, info: ErrorInfo = {}): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Sin sesión y sin clave de servicio no hay con qué registrarlo (queda en los registros de Vercel).
  const auth = info.token ? { apikey: anon, bearer: info.token } : service ? { apikey: service, bearer: service } : null;
  if (!url || !auth?.apikey) return;
  const message = errorMessage(err);
  const stack = err instanceof Error && err.stack ? err.stack.split("\n").slice(1, 6).map((l) => l.trim()) : undefined;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/report_app_error`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: auth.apikey, Authorization: `Bearer ${auth.bearer}` },
      body: JSON.stringify({ p_source: source, p_message: message, p_path: info.path ?? null, p_digest: info.digest ?? null, p_detail: { ...info.detail, ...(stack ? { stack } : {}) } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok && (await res.json()) === true) await alert(source, message, info.path ?? null);
  } catch {
    // Sin registro no hay aviso; el error original ya está en los registros de Vercel.
  }
}

async function alert(source: ErrorSource, message: string, path: string | null): Promise<void> {
  const hook = process.env.ERROR_WEBHOOK_URL;
  if (!hook) return;
  const origin = { server: "servidor", client: "navegador", assistant: "asistente" }[source];
  const text = `⚠️ LogisticApp · error nuevo (${origin})${path ? ` en ${path.split("?")[0]}` : ""}: ${message.slice(0, 300)}`;
  await fetch(hook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // «text» lo leen Slack y la mayoría; «content», Discord.
    body: JSON.stringify({ text, content: text }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => undefined);
}
