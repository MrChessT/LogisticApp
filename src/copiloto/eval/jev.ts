// Cliente Jev de los scripts de evaluación: sin caché, cada llamada es una medición nueva.
import { getVercelOidcToken } from "@vercel/oidc";
import { LruCache } from "../cache/lru";
import type { Config } from "../config";
import { JevClient, type JevResult } from "../jev/client";
import type { Metrics } from "../metrics/metrics";

export function requireJevKey(config: Config): void {
  if (!config.jev.apiKey && !config.jev.oidc) throw new Error("Falta TYPESAFE_API_KEY, AI_GATEWAY_API_KEY o VERCEL_OIDC_TOKEN en .env.local");
}

export function evalJev(config: Config, metrics: Metrics): JevClient {
  return new JevClient({
    apiKey: config.jev.oidc ? () => getVercelOidcToken() : config.jev.apiKey,
    baseURL: config.jev.baseURL,
    model: config.jev.model,
    timeoutMs: 20_000,
    maxRetries: 3,
    cacheTtlMs: 0,
    cache: new LruCache<JevResult>(1, 1),
    metrics,
  });
}
