// ¿El mensaje nombra tal cual un local, un espacio o un producto? Es la «evidencia literal» que
// permite a la política de confianza pedir menos seguridad a Jev (ver gates/policy.ts).
import { STOPWORDS, tokenize } from "./normalize";
import { tokenSimilarity } from "./retriever";

const ARTICLES = new Set(["el", "la", "los", "las", "de", "del", "y"]);

function has(words: string[], token: string): boolean {
  return words.some((w) => (/^\d+$/.test(token) ? w === token : tokenSimilarity(w, token) >= 0.85));
}

/** Todas las palabras con sentido del nombre aparecen en el texto («La Oliva» → «oliva»; «Barra 1» → «barra» y «1»). */
export function namesAll(text: string, name: string): boolean {
  const words = tokenize(text);
  const tokens = tokenize(name).filter((t) => !ARTICLES.has(t));
  return tokens.length > 0 && tokens.every((t) => has(words, t));
}

/**
 * Un producto está nombrado si aparece una palabra que lo distingue: de al menos 4 letras y que no sea
 * de su categoría («beefeater» sí; «ginebra» no, porque vale para todas las ginebras).
 */
export function namesProduct(text: string, product: { name: string; category?: string | null }): boolean {
  const words = tokenize(text);
  const generic = new Set(tokenize(product.category ?? ""));
  return tokenize(product.name).some((t) => t.length >= 4 && !/^\d+$/.test(t) && !generic.has(t) && has(words, t));
}

/**
 * Palabras del texto que el producto no explica: ni su nombre ni su categoría las contienen («prubea» en
 * «Prubea Luis» frente a «Luis Latour»; «light» frente a «Coca-Cola 20 cl»). Si queda alguna, el
 * producto se parece pero no es seguro que sea el que se dice: para escribir, se pregunta.
 */
/** Palabras que señalan sin nombrar («ese ron de aquí», «el otro»): no contradicen ningún producto. */
const DEICTIC = new Set(["aqui", "alli", "alla", "otro", "otra", "otros", "otras", "mismo", "misma", "mismos", "mismas", "esos", "esas", "estos", "estas", "este", "esta", "eso", "esto", "aquel", "aquella", "aquellos", "aquellas", "cosa", "cosas"]);

export function unexplainedWords(text: string, product: { name: string; category?: string | null }, ignore: (word: string) => boolean = () => false): string[] {
  const own = tokenize(`${product.name} ${product.category ?? ""}`);
  return tokenize(text).filter(
    (w) =>
      w.length >= 4 &&
      !/^\d/.test(w) &&
      !STOPWORDS.has(w) &&
      !DEICTIC.has(w) &&
      !ignore(w) &&
      !own.some((t) => tokenSimilarity(w, t) >= 0.8 || (t.length >= 4 && (t.startsWith(w) || w.startsWith(t)))),
  );
}
