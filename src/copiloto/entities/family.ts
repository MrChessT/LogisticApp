// Familias del catálogo («Destilados › Ron», «Cervezas», «Aguas»): si lo que se pregunta nombra una,
// la consulta es de toda la familia. Antes solo entraban los 10 productos con el nombre más parecido y
// «¿cuántas cervezas quedan en el Vivero?» dejaba fuera la Heineken o la Mahou (sin «cerveza» en el nombre).
import type { Product } from "../domain";
import { STOPWORDS, tokenize } from "./normalize";
import { tokenSimilarity } from "./retriever";

export interface Family {
  /** Nombre de la familia tal como está en el catálogo («Ron», «Cervezas»). */
  label: string;
  products: Product[];
}

const segmentsOf = (category: string | null): string[] => (category ? category.split("›").map((s) => s.trim()).filter(Boolean) : []);

/**
 * La familia más concreta que nombra el texto: todas sus palabras tienen que aparecer («vino blanco» →
 * «Vino blanco», no «Vino tinto»). null si no nombra ninguna o si la familia es todo el catálogo.
 */
export function familyOf(text: string, products: Product[], options: { exact?: boolean } = {}): Family | null {
  const words = tokenize(text).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  if (words.length === 0) return null;
  const names = new Map<string, string>();
  for (const p of products) for (const s of segmentsOf(p.category)) names.set(s.toLowerCase(), s);

  let best: { name: string; size: number } | null = null;
  for (const [key, name] of names) {
    const own = tokenize(key).filter((t) => !STOPWORDS.has(t));
    if (own.length === 0) continue;
    if (!own.every((t) => words.some((w) => tokenSimilarity(w, t) >= 0.85))) continue;
    // exact: el texto no dice nada más que la familia («agua», no «agua Font Vella»).
    if (options.exact && !words.every((w) => own.some((t) => tokenSimilarity(w, t) >= 0.85))) continue;
    if (!best || own.length > best.size) best = { name, size: own.length };
  }
  if (!best) return null;
  const key = best.name.toLowerCase();
  const members = products.filter((p) => segmentsOf(p.category).some((s) => s.toLowerCase() === key));
  if (members.length === 0 || members.length === products.length) return null;
  return { label: best.name, products: members };
}
