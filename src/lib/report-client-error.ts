// Envío de errores del navegador a /api/errores. Como mucho 5 por carga de página y sin repetir el mismo.

const sent = new Set<string>();
const MAX_PER_PAGE = 5;

// Ruido que no es un fallo de la app: avisos del navegador, extensiones, cortes de red del usuario.
const NOISE = /ResizeObserver loop|^Script error\.?$|chrome-extension:|moz-extension:|Load failed|Failed to fetch|NetworkError|AbortError|The operation was aborted/i;

export function reportClientError(err: unknown, digest?: string): void {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : typeof err === "string" ? err : "";
  if (!message || NOISE.test(message) || sent.has(message) || sent.size >= MAX_PER_PAGE) return;
  sent.add(message);
  const stack = err instanceof Error && err.stack ? err.stack.split("\n").slice(1, 6).map((l) => l.trim().slice(0, 300)) : undefined;
  const body = JSON.stringify({ message: message.slice(0, 600), path: window.location.pathname, ...(digest ? { digest } : {}), ...(stack ? { stack } : {}), agent: navigator.userAgent.slice(0, 200) });
  try {
    // keepalive: sale aunque el usuario cambie de pantalla.
    void fetch("/api/errores", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
  } catch {
    // nada que hacer
  }
}
