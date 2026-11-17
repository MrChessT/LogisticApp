// Familias del catálogo («Destilados › Ron», «Cervezas», «Aguas»): si lo que se pregunta nombra una,
// la consulta es de toda la familia. Antes solo entraban los 10 productos con el nombre más parecido y
// «¿cuántas cervezas quedan en el Vivero?» dejaba fuera la Heineken o la Mahou (sin «cerveza» en el nombre).
import type { Product } from "../domain";
import { STOPWORDS, tokenize } from "./normalize";

export interface Family {
  /** Cómo se dice la familia en el titular («ron», «vino blanco»). */
  label: string;
  products: Product[];
}

const segmentsOf = (category: string | null): string[] => (category ? category.split("›").map((s) => s.trim()).filter(Boolean) : []);

const singular = (w: string) => (w.endsWith("es") && w.length > 4 ? w.slice(0, -2) : w.endsWith("s") && w.length > 3 ? w.slice(0, -1) : w);

/** Letras que cambian, sobran o faltan para pasar de una palabra a otra. */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * La misma palabra: igual salvo el plural («aguas», «ginebras») o con una errata en una palabra larga
 * («cervesas»). No vale empezar igual: «gasta» no es «Sin gas», «espera» no es «Especias».
 */
function sameWord(w: string, t: string): boolean {
  if (w === t || singular(w) === singular(t)) return true;
  return Math.min(w.length, t.length) >= 5 && editDistance(singular(w), singular(t)) <= (Math.min(w.length, t.length) >= 8 ? 2 : 1);
}

/**
 * La familia que nombra el texto. Si nombra varias encadenadas («vino blanco» → «Vinos» y «Blanco»), los
 * productos que están en todas; las palabras de cada familia tienen que aparecer todas. null si no
 * nombra ninguna o si la familia es todo el catálogo.
 */
export function familyOf(text: string, products: Product[], options: { exact?: boolean } = {}): Family | null {
  const words = tokenize(text).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  if (words.length === 0) return null;
  const names = new Map<string, string>();
  for (const p of products) for (const s of segmentsOf(p.category)) names.set(s.toLowerCase(), s);

  const matched: string[] = [];
  const used = new Set<string>();
  for (const key of names.keys()) {
    const own = tokenize(key).filter((t) => !STOPWORDS.has(t));
    if (own.length === 0) continue;
    const hits = own.map((t) => words.find((w) => sameWord(w, t)));
    if (hits.some((h) => h === undefined)) continue;
    matched.push(key);
    for (const h of hits) used.add(h!);
  }
  if (matched.length === 0) return null;
  // exact: el texto no dice nada más que la familia («agua», no «agua Font Vella»).
  if (options.exact && !words.every((w) => used.has(w))) return null;

  const inAll = (p: Product) => {
    const own = segmentsOf(p.category).map((s) => s.toLowerCase());
    return matched.every((m) => own.includes(m));
  };
  let members = products.filter(inAll);
  // Familias que no se cruzan («ron blanco» sin «Ron › Blanco»): la más concreta (más palabras).
  if (members.length === 0) {
    const best = [...matched].sort((a, b) => tokenize(b).length - tokenize(a).length)[0]!;
    members = products.filter((p) => segmentsOf(p.category).some((s) => s.toLowerCase() === best));
  }
  if (members.length === 0 || members.length === products.length) return null;
  // Una sola familia: su nombre del catálogo («tónicas», no lo escrito con errata); varias encadenadas
  // («vino blanco»): lo que se dijo.
  const label = matched.length === 1 ? names.get(matched[0]!)!.toLowerCase() : words.filter((w) => used.has(w)).join(" ");
  return { label, products: members };
}

/**
 * Grupo por nombre cuando ninguna familia del catálogo lo nombra. Desde la taxonomía por cuentas, «ron» o
 * «ginebra» ya no son familias (están dentro de «Destilados y Licores»), pero la gente sigue preguntando así.
 * Entran los productos con todas las palabras buscadas en el nombre o en las notas (marca, tipo). null si no
 * hay al menos dos o si son todo el catálogo: un solo producto lo resuelve la búsqueda normal.
 */
export function nameGroupOf(text: string, products: Product[]): Family | null {
  const words = tokenize(text).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  if (words.length === 0 || words.length > 2) return null;
  const members = products.filter((p) => {
    const own = tokenize(`${p.name} ${p.notes ?? ""}`);
    return words.every((w) => own.some((t) => sameWord(w, t)));
  });
  if (members.length < 2 || members.length === products.length) return null;
  // El título, como está escrito en el catálogo («tónica», con su tilde), no como se tecleó.
  // Primero la palabra igual (o en plural); la tolerante a erratas solo si no hay otra («tonica» → «Tónica», no «Tonic»).
  const nameWords = members.flatMap((p) => p.name.split(/[^\p{L}\p{N}]+/u)).filter(Boolean);
  const written = (w: string) =>
    (nameWords.find((t) => singular(tokenize(t)[0] ?? "") === singular(w)) ?? nameWords.find((t) => sameWord(w, tokenize(t)[0] ?? "")))?.toLowerCase() ?? w;
  return { label: words.map(written).join(" "), products: members };
}
