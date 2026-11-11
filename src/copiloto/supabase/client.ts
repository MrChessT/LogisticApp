import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface SupabaseSettings {
  url: string;
  anonKey: string;
  /** Solo para tests. */
  fetch?: typeof fetch;
}

export class DataError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DataError";
  }
}

/** Filas por petición: PostgREST corta en `max_rows` (1000 en Supabase) sin avisar. */
const PAGE_SIZE = 1000;
/** Tope de filas de una lectura paginada. */
const MAX_ROWS = 20_000;

/**
 * Lee todas las filas de una consulta, de PAGE_SIZE en PAGE_SIZE. `page` debe ordenar por una clave
 * única para que las páginas no se solapen. Con menos de 1000 filas es una sola petición, como antes.
 */
export async function readAll<T>(
  what: string,
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  max = MAX_ROWS,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new DataError(`No se pudo leer ${what}`, { cause: error });
    out.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return out;
}

/**
 * Cliente con la clave anon y el JWT del usuario: todas las consultas pasan por RLS.
 * Nunca se usa la service role.
 */
export function userClient(settings: SupabaseSettings, accessToken: string | null): SupabaseClient {
  return createClient(settings.url, settings.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      ...(settings.fetch ? { fetch: settings.fetch } : {}),
    },
  });
}

export async function pingSupabase(settings: SupabaseSettings): Promise<boolean> {
  try {
    const response = await (settings.fetch ?? fetch)(`${settings.url}/auth/v1/health`, {
      headers: { apikey: settings.anonKey },
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
