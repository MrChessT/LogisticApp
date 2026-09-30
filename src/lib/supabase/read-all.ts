// PostgREST devuelve como mucho `max_rows` filas por petición (1000 en Supabase) y corta sin avisar:
// con más productos o formatos que eso, las listas de la app se quedarían incompletas en silencio.

export const PAGE_SIZE = 1000;
const MAX_ROWS = 20_000;

type Page<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

/**
 * Lee todas las filas de una consulta por páginas y devuelve la misma forma `{ data, error }` que una
 * consulta suelta. `page` debe ordenar por una clave única para que las páginas no se solapen.
 * Con menos de PAGE_SIZE filas es una sola petición.
 */
export async function readAll<T>(page: (from: number, to: number) => Page<T>, max = MAX_ROWS): Promise<{ data: T[] | null; error: unknown }> {
  const rows: T[] = [];
  for (let from = 0; from < max; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { data: null, error };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return { data: rows, error: null };
}
