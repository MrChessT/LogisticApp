// Señales del texto de un mensaje (sin Jev): si continúa lo anterior, qué local es origen y cuál
// destino, si nombra un espacio o una merma… Las usan la petición a Jev, la interpretación y los atajos.
import type { SessionContext } from "../domain";
import { tokenSimilarity } from "./retriever";
import { tokenize } from "./normalize";

/** Por qué se da de baja algo: roturas, caducidad, derrames, invitaciones, errores de servicio. */
export function mentionsReason(message: string): boolean {
  return /romp|\brot[oa]s?\b|caduc|derram|invit|error|equivoc|estrope|podri|venci|mal servid|se (?:ha|han) caido|cayo|tirad/.test(tokenize(message).join(" "));
}

/**
 * Palabras que solo se usan para dar algo de baja: el motivo («roto», «caducado», «invitación») o el
 * acto («tira», «tírame», «dala de baja», «pochos»). Sirven para confirmar una merma que Jev ya pone
 * primera; «quita» o «saca» no cuentan (también se dicen de un traspaso).
 */
export function mentionsWaste(message: string): boolean {
  const text = tokenize(message).join(" ");
  return mentionsReason(message) || /\btir(a|as|ame|ala|alo|alas|alos|ar|o|aron|amos)\b|\bde baja\b|\bpoch[oa]s?\b|\bmal(o|a|os|as)\b|\ba la basura\b/.test(text);
}

/** Lo que solo se dice continuando lo anterior: «¿y…?», «eso», «ahí», «lo mismo», «también». */
export function referencesPrevious(message: string): boolean {
  const words = tokenize(message);
  return words[0] === "y" || words.some((w) => /^(eso|esa|ese|esos|esas|ahi|alli|mismo|misma|mismos|mismas|tambien)$/.test(w));
}

/** Verbos que, en un mensaje corto, dejan el sujeto sobreentendido («¿qué alérgenos tiene?», «¿cuánto cuesta?»). */
const IMPLICIT_SUBJECT = /^(tiene|tienen|lleva|llevan|cuesta|cuestan|vale|valen|sale|salen|queda|quedan|deja|dejan)$/;

const TIME_AFTER = /^(semana|mes|ano|lunes|martes|miercoles|jueves|viernes|sabado|domingo|noche|manana|tarde|finde|fin|temporada|trimestre)$/;

/**
 * ¿El mensaje depende de lo hablado antes?
 *   fuerte: se refiere a algo anterior sin nombrarlo («¿y sus proveedores?», «¿cuánto se vendió de eso?»,
 *           «¿a cuánto la compramos?», «lo mismo pero en ventas», «ese plato»).
 *   debil:  continúa con «¿y…?» o «también» (lo normal es que cambie dónde o cuándo).
 */
export function contextReference(message: string): "fuerte" | "debil" | null {
  const words = tokenize(message);
  const text = words.join(" ");
  const demonstrative = words.some((w, i) => /^(eso|esa|ese|esos|esas|esto|aquel|aquella|aquello)$/.test(w) || (/^(este|esta|estos|estas)$/.test(w) && !TIME_AFTER.test(words[i + 1] ?? "") && words[i + 1] !== undefined));
  const strong =
    demonstrative ||
    words.some((w) => /^(sus?|ahi|alli|alla)$/.test(w)) ||
    /\b(me|nos|se|te) (la|lo|las|los|le|les)\b/.test(text) ||
    /\b(le|les) [a-z]{3,}/.test(text) ||
    /\b(la|lo|las|los) (compramos|compro|compran|compraron|pedimos|pido|piden|pidieron|pagamos|pago|pagan|debemos|debo|deben|vendemos|vendo|venden|vendimos|vendieron|tenemos|tengo|traen|trae|trajo|trajeron|servimos|usamos|gastamos|gasto|pedi|compre|enviamos|mandamos|hemos|habeis)\b/.test(text);
  if (strong) return "fuerte";
  // «lo mismo pero en el Vivero», «¿y el sábado?», «también»: suele cambiar dónde o cuándo (Jev hereda el
  // foco). Los mensajes muy cortos («¿qué alérgenos tiene?») dejan sobreentendido de qué se habla.
  return words[0] === "y" || words.includes("tambien") || words.some((w) => /^(mismo|misma|mismos|mismas)$/.test(w)) || (words.length <= 5 && words.some((w) => IMPLICIT_SUBJECT.test(w))) ? "debil" : null;
}

/**
 * «¿y en el Parador?», «¿y el Brugal?», «y para el finde?»: cambia dónde o de qué, no qué se pregunta.
 * Si dice qué quiere saber («¿y cuánto hay?», «¿y el precio?»), ya es otra consulta.
 */
export function asksSameAgain(message: string): boolean {
  const words = tokenize(message);
  return words[0] === "y" && words.length <= 5 && !words.some((w) => /^(cuant|que$|cual|como|cuando|donde|hay$|qued|teng|tene|preci|cuest|val|gast|compr|ped|repon|movim|consum|merm|traspas|desvi|inventari|stock|existenc)/.test(w));
}

/**
 * Papel de cada local nombrado según la preposición que lo precede: «del Parador», «desde Pickels» →
 * origen; «al Vivero», «a La Oliva», «hacia…», «para…» → destino. Solo corrobora lo que Jev elige.
 */
export function venueRoles(message: string, locations: string[]): { origin: string | null; destination: string | null } {
  const words = tokenize(message);
  const ORIGIN = new Set(["del", "desde", "de"]);
  const DESTINATION = new Set(["al", "a", "hacia", "para"]);
  const ARTICLES = new Set(["el", "la", "los", "las"]);
  let origin: string | null = null;
  let destination: string | null = null;
  for (const name of locations) {
    const first = tokenize(name).filter((t) => !ARTICLES.has(t))[0];
    if (!first) continue;
    const at = words.findIndex((w) => w === first || (w.length >= 4 && tokenSimilarity(w, first) >= 0.85));
    if (at < 0) continue;
    let k = at - 1;
    while (k >= 0 && ARTICLES.has(words[k]!)) k -= 1;
    const prev = words[k] ?? "";
    if (ORIGIN.has(prev) && origin === null) origin = name;
    else if (DESTINATION.has(prev) && destination === null) destination = name;
  }
  return { origin, destination };
}

/** Palabras genéricas de espacio: «¿qué hay en cada sección?» también pide ver los espacios. */
const AREA_WORDS = ["seccion", "secciones", "espacio", "espacios", "zona", "zonas"];

/** ¿El mensaje nombra algún espacio? Una palabra con sentido de su nombre («barra», «almacen», «camara»). */
export function mentionsArea(message: string, ctx: Pick<SessionContext, "areas">): boolean {
  const words = tokenize(message);
  if (words.some((w) => AREA_WORDS.includes(w))) return true;
  return ctx.areas.some((a) => tokenize(a.name).some((n) => n.length >= 4 && !/^\d+$/.test(n) && words.some((w) => tokenSimilarity(w, n) >= 0.85)));
}

/** «¿Qué hay en cada sección / por zonas / en cada barra?»: el stock se desglosa por espacio. */
export function wantsAreaBreakdown(message: string): boolean {
  const text = tokenize(message).join(" ");
  return /\b(cada|por|las|todas las|todos los|sus) (seccion|secciones|espacio|espacios|zona|zonas|barra|barras)\b/.test(text) || /\b(secciones|espacios|zonas)\b/.test(text);
}

/** Locales nombrados en el mensaje por sus palabras con sentido («la» de «La Oliva» no cuenta: «la caja de ayer»). */
export function namedLocations<L extends { name: string }>(locations: readonly L[], message: string): L[] {
  const words = new Set(tokenize(message));
  return locations.filter((l) => tokenize(l.name).some((w) => w.length > 2 && words.has(w)));
}
