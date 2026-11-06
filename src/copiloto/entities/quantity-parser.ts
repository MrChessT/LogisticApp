// Parser determinista de cantidades en español. Nunca convierte a number: todo va con decimal.js.
import Decimal from "decimal.js";
import { normalize } from "./normalize";

export interface Segment {
  /** Fragmento del mensaje original: "2 botellas de ron". */
  text: string;
  /** Cantidad como cadena decimal, o null si el mensaje nombra un producto sin cantidad. */
  amount: string | null;
  /** Unidad canónica ("botella", "kg", "ud"…) o null. */
  unit: string | null;
  /** Texto que describe el producto: "ron". */
  productText: string;
  /** Precio por unidad o formato si el mensaje lo dice ("a 12 €"). */
  price: string | null;
  /**
   * Unidades sueltas que acompañan a las cajas: «3 cajas y 5 sueltas» → amount 3 (caja) y loose 5.
   * Van en la unidad en que se cuenta el producto (ud, o la botella si se mide en ml), salvo que
   * `looseUnit` diga otra («2 cajas y 3 botellas»).
   */
  loose?: string | null;
  looseUnit?: string | null;
}

const NUMBER_WORDS: Record<string, string> = {
  un: "1", uno: "1", una: "1", dos: "2", tres: "3", cuatro: "4", cinco: "5", seis: "6", siete: "7", ocho: "8",
  nueve: "9", diez: "10", once: "11", doce: "12", trece: "13", catorce: "14", quince: "15", dieciseis: "16",
  diecisiete: "17", dieciocho: "18", diecinueve: "19", veinte: "20", veinticuatro: "24", veinticinco: "25",
  treinta: "30", cuarenta: "40", cincuenta: "50", sesenta: "60", cien: "100", media: "0.5", medio: "0.5",
};

const UNIT_ALIASES: Record<string, string> = {
  botella: "botella", botellas: "botella", bot: "botella",
  caja: "caja", cajas: "caja",
  barril: "barril", barriles: "barril",
  lata: "lata", latas: "lata",
  pack: "pack", packs: "pack",
  paquete: "paquete", paquetes: "paquete",
  bolsa: "bolsa", bolsas: "bolsa",
  bote: "bote", botes: "bote",
  garrafa: "garrafa", garrafas: "garrafa",
  saco: "saco", sacos: "saco",
  bandeja: "bandeja", bandejas: "bandeja",
  tercio: "tercio", tercios: "tercio",
  docena: "docena", docenas: "docena",
  copa: "copa", copas: "copa",
  chupito: "chupito", chupitos: "chupito",
  cana: "cana", canas: "cana",
  combinado: "combinado", combinados: "combinado",
  unidad: "ud", unidades: "ud", ud: "ud", uds: "ud", u: "ud",
  kg: "kg", kilo: "kg", kilos: "kg", kilogramo: "kg", kilogramos: "kg",
  g: "g", gr: "g", grs: "g", gramo: "g", gramos: "g",
  l: "l", lt: "l", litro: "l", litros: "l",
  cl: "cl", centilitro: "cl", centilitros: "cl",
  ml: "ml", mililitro: "ml", mililitros: "ml",
};

/** Un número justo después de estas palabras es un identificador ("barra 1"), no una cantidad. */
const ID_PREFIXES = new Set([
  "barra", "camara", "almacen", "zona", "mesa", "sala", "terraza", "local", "dia", "numero", "n", "no", "num",
  "albaran", "pedido", "las", "planta", "puerta",
]);

/** «11 euros», «3 pavos»: dinero, no una cantidad de producto. */
const MONEY_WORDS = new Set(["euros", "euro", "eur", "eurs", "pavos", "pelas"]);

/** Palabras que cierran el texto de producto de un segmento. */
const PRODUCT_BREAKERS = new Set([
  "en", "a", "al", "para", "desde", "hacia", "por", "porque", "que", "y", "o", "con", "sin", "hoy", "ayer",
  "roto", "rota", "rotos", "rotas", "caducado", "caducada", "caducados", "caducadas", "derramado", "derramada",
  "derramados", "derramadas", "del", "de",
  // La puntuación cierra el producto: «una coca, dala de baja» → «coca».
  ",", ";", ":", "!", "?", "¿", "¡", ".",
]);

/** Sustantivos del dominio que siguen a "un/una" sin ser productos. */
const NON_PRODUCT_NOUNS = new Set([
  "traspaso", "merma", "inventario", "recepcion", "albaran", "pedido", "pregunta", "momento", "poco", "rato",
  "favor", "resumen", "informe", "vistazo", "lista", "listado", "cierre", "conteo", "movimiento", "ajuste", "vez",
  "semana", "mes", "dia", "hora", "par",
  // Personas y sitios: «un cliente tiró una coca», «una mesa se ha llevado 3 cocas».
  "cliente", "clienta", "clientes", "camarero", "camarera", "camareros", "cocinero", "cocinera", "mesa", "chico",
  "chica", "companero", "companera", "jefe", "jefa", "encargado", "encargada", "repartidor", "repartidora",
  "proveedor", "senor", "senora", "persona", "grupo", "amigo", "amiga", "nino", "nina", "trabajador", "trabajadora",
]);

/** Estado de lo que se da de baja; puede ir entre la unidad y el producto. */
const DAMAGE = new Set([
  "roto", "rota", "rotos", "rotas", "caducado", "caducada", "caducados", "caducadas", "derramado", "derramada",
  "derramados", "derramadas", "abierto", "abierta", "abiertos", "abiertas", "estropeado", "estropeada", "estropeados", "estropeadas",
]);

const SIZE_UNITS = new Set(["cl", "ml", "l", "g", "kg"]);

/** Formatos de varias unidades: lo que va detrás («y 5 sueltas») son unidades sueltas del mismo producto. */
const BOX_UNITS = new Set(["caja", "pack", "bandeja", "paquete"]);
/** Unen las cajas con las sueltas: «3 cajas y 5», «2 cajas + 3», «4 cajas más 2». */
// «con» no: «2 cajas con 12 unidades» describe la caja, no son sueltas.
const LOOSE_JOINERS = new Set(["y", "+", "mas"]);
/** Palabras que dicen que son unidades sueltas, sin ser el producto. */
const LOOSE_WORDS = new Set(["suelta", "sueltas", "suelto", "sueltos"]);
/** Unidades válidas para las sueltas («2 cajas y 3 botellas», «y 4 unidades», «y 6 latas»). */
const LOOSE_UNITS = new Set(["ud", "botella", "lata", "tercio", "bote"]);

const LEADING_FILLERS = new Set(["de", "del", "la", "el", "los", "las"]);

interface Token {
  raw: string;
  norm: string;
}

function tokens(message: string): Token[] {
  // NFC + \p{M}: una tilde enviada como carácter combinado (o + ´) no parte la palabra.
  const raw = message.normalize("NFC").match(/\d+(?:[.,/]\d+)?|[\p{L}\p{M}\p{N}]+|[€%,;:!?¿¡+.]/gu) ?? [];
  return raw.map((r) => ({ raw: r, norm: normalize(r) }));
}

/** "1,5" → 1.5 · "1.500" → 1500 · "1/2" → 0.5 · "dos" → 2. Devuelve null si no es un número. */
export function parseNumber(token: string): Decimal | null {
  const t = normalize(token);
  if (NUMBER_WORDS[t] !== undefined) return new Decimal(NUMBER_WORDS[t]);
  const fraction = /^(\d+)\/(\d+)$/.exec(t);
  if (fraction) {
    const den = new Decimal(fraction[2]!);
    return den.isZero() ? null : new Decimal(fraction[1]!).div(den);
  }
  if (/^\d+\.\d{3}$/.test(t)) return new Decimal(t.replace(".", ""));
  if (/^\d+([.,]\d+)?$/.test(t)) return new Decimal(t.replace(",", "."));
  return null;
}

function isDigitNumber(token: Token): boolean {
  return /^\d/.test(token.norm);
}

export function parseQuantities(message: string, maxSegments = 5): Segment[] {
  const toks = tokens(message);
  const segments: Segment[] = [];
  /** Dónde acaba cada fragmento (en tokens): el producto «de delante» no puede cruzarlo. */
  const segmentEnds: number[] = [];
  let i = 0;

  while (i < toks.length && segments.length < maxSegments) {
    const tok = toks[i]!;
    const prev = toks[i - 1];
    let amount = parseNumber(tok.raw);

    // Una palabra-número solo cuenta si le sigue una unidad o un posible producto
    // (evita "un traspaso", "una pregunta").
    if (amount && !isDigitNumber(tok)) {
      const next = toks[i + 1];
      if (tok.norm === "un" && next?.norm === "par") {
        amount = new Decimal(2);
        i += 1;
      } else {
        const nextIsUnit = next !== undefined && UNIT_ALIASES[next.norm] !== undefined;
        const nextIsProduct =
          next !== undefined && !PRODUCT_BREAKERS.has(next.norm) && !NON_PRODUCT_NOUNS.has(next.norm) && !parseNumber(next.raw);
        if (!nextIsUnit && !nextIsProduct) amount = null;
      }
    }
    if (!amount || (prev && ID_PREFIXES.has(prev.norm)) || toks[i + 1]?.raw === "%" || toks[i + 1]?.raw === "€" || MONEY_WORDS.has(toks[i + 1]?.norm ?? "")) {
      i += 1;
      continue;
    }

    const start = i;
    i += 1;
    let unit: string | null = null;
    const unitTok = toks[i];
    if (unitTok && UNIT_ALIASES[unitTok.norm] !== undefined) {
      unit = UNIT_ALIASES[unitTok.norm]!;
      i += 1;
      // "dos cajas y media"
      if (toks[i]?.norm === "y" && (toks[i + 1]?.norm === "media" || toks[i + 1]?.norm === "medio")) {
        amount = amount.plus("0.5");
        i += 2;
      }
    }
    // «3 cajas y 5 sueltas de coca», «2 cajas + 3 de red bull», «3 cajas y 4 unidades de heineken»:
    // las sueltas son del mismo producto y se suman a las cajas en un único fragmento.
    let loose: string | null = null;
    let looseUnit: string | null = null;
    if (unit !== null && BOX_UNITS.has(unit) && toks[i] && LOOSE_JOINERS.has(toks[i]!.norm) && toks[i + 1]) {
      const n = parseNumber(toks[i + 1]!.raw);
      const after = toks[i + 2]?.norm;
      const afterUnit = after !== undefined ? UNIT_ALIASES[after] : undefined;
      if (n && n.gt(0)) {
        if (after !== undefined && LOOSE_WORDS.has(after)) {
          loose = n.toString();
          i += 3;
        } else if (afterUnit !== undefined && LOOSE_UNITS.has(afterUnit)) {
          loose = n.toString();
          looseUnit = afterUnit === "ud" ? null : afterUnit;
          i += 3;
          if (toks[i] && LOOSE_WORDS.has(toks[i]!.norm)) i += 1;
        } else if (after === "de" || (after !== undefined && afterUnit === undefined && !PRODUCT_BREAKERS.has(after) && !parseNumber(toks[i + 2]!.raw))) {
          // «2 cajas y 3 de red bull», «3 cajas y 5 cocas»: sin producto aún, el número son sueltas.
          loose = n.toString();
          i += 2;
        }
      }
    }
    if (unit === "docena") {
      amount = amount.mul(12);
      unit = "ud";
    }

    while (toks[i] && LEADING_FILLERS.has(toks[i]!.norm)) i += 1;
    // «3 botellas rotas de ron», «2 cajas caducadas del zumo»: el estado va antes del producto.
    if (toks[i] && DAMAGE.has(toks[i]!.norm) && toks[i + 1] && LEADING_FILLERS.has(toks[i + 1]!.norm)) {
      i += 1;
      while (toks[i] && LEADING_FILLERS.has(toks[i]!.norm)) i += 1;
    }
    const productTokens: Token[] = [];
    while (toks[i] && productTokens.length < 6) {
      const t = toks[i]!;
      const nextUnit = UNIT_ALIASES[toks[i + 1]?.norm ?? ""];
      // "coca cola 20 cl": el tamaño forma parte del nombre del producto.
      if (productTokens.length > 0 && isDigitNumber(t) && nextUnit !== undefined && SIZE_UNITS.has(nextUnit)) {
        productTokens.push(t, toks[i + 1]!);
        i += 2;
        continue;
      }
      if (parseNumber(t.raw) && (isDigitNumber(t) || nextUnit !== undefined)) break;
      // «tiró una coca»: un «un/una» dentro del texto empieza otra cantidad.
      if (productTokens.length > 0 && parseNumber(t.raw) && !isDigitNumber(t)) break;
      if (PRODUCT_BREAKERS.has(t.norm) && productTokens.length > 0) {
        // "de" dentro del nombre ("zumo de naranja") sí se mantiene.
        if (t.norm === "de" && toks[i + 1] && !PRODUCT_BREAKERS.has(toks[i + 1]!.norm)) {
          productTokens.push(t);
          i += 1;
          continue;
        }
        break;
      }
      if (PRODUCT_BREAKERS.has(t.norm)) break;
      productTokens.push(t);
      i += 1;
    }

    const end = i;
    // Precio: "a 12 €", "a 12,50 euros"
    let price: string | null = null;
    if (toks[i]?.norm === "a" && toks[i + 1] && isDigitNumber(toks[i + 1]!)) {
      const after = toks[i + 2]?.norm;
      if (after === "€" || after === "euros" || after === "eur") {
        price = parseNumber(toks[i + 1]!.raw)?.toString() ?? null;
        i += 3;
      }
    }

    // «Larios, 3 botellas» / «Prueba Luis 2ud»: sin producto detrás, el que va justo delante (en la misma
    // frase y sin cruzar otra cantidad). Antes se perdía y se buscaba el producto en el mensaje entero.
    if (productTokens.length === 0 && unit !== null) productTokens.push(...productBefore(toks, start, segments.length > 0 ? segmentEnds[segmentEnds.length - 1]! : 0));
    const productText = productTokens.map((t) => t.raw).join(" ");
    // «6 cajas de coca y 2 de tónica»: «2 de» sin unidad justo después de otro fragmento con unidad
    // es la misma unidad (2 cajas), como lo entendería cualquiera.
    const previous = segments[segments.length - 1];
    if (unit === null && previous?.unit && toks[start + 1]?.norm === "de" && toks[start - 1]?.norm === "y") unit = previous.unit;
    // «2 cajas de tónica y 7 sueltas»: las sueltas van con las cajas del fragmento anterior.
    const looseTail = productTokens.length === 1 && LOOSE_WORDS.has(productTokens[0]!.norm);
    if (looseTail && previous?.unit && BOX_UNITS.has(previous.unit) && !previous.loose && (unit === null || unit === "ud") && LOOSE_JOINERS.has(toks[start - 1]?.norm ?? "")) {
      previous.loose = amount.toString();
      previous.text = `${previous.text} ${toks.slice(start - 1, end).map((t) => t.raw).join(" ")}`;
      continue;
    }
    segmentEnds.push(end);
    segments.push({
      text: toks.slice(start, end).map((t) => t.raw).join(" "),
      amount: amount.toString(),
      unit,
      productText,
      price,
      ...(loose !== null ? { loose, looseUnit } : {}),
    });
  }

  return segments.filter((segment) => segment.productText.length > 0 || segment.unit !== null);
}

/** Palabras de operación u orden que no forman parte de un nombre de producto («registrar merma.»). */
const NOT_PRODUCT = new Set([...PRODUCT_BREAKERS, "merma", "mermas", "registrar", "registra", "apunta", "apuntar", "anota", "anotar", "traspaso", "pasa", "pasame", "tira", "baja", "quita", "manda", "hay", "son", "es"]);

/** Hasta 4 palabras justo delante de la cantidad, sin cruzar puntuación, números ni otro fragmento. */
function productBefore(toks: Token[], start: number, floor: number): Token[] {
  const found: Token[] = [];
  let j = start - 1;
  // «Larios, 3 botellas»: una coma pegada se salta.
  if (toks[j]?.raw === "," || toks[j]?.raw === ":") j -= 1;
  while (j >= floor && found.length < 4) {
    const t = toks[j]!;
    if (NOT_PRODUCT.has(t.norm) || parseNumber(t.raw) || UNIT_ALIASES[t.norm] !== undefined) break;
    found.unshift(t);
    j -= 1;
  }
  return found;
}

/** Unidad, también con errata («votellas», «kajas»): no es parte del nombre de un producto. */
export function isUnitWord(word: string): boolean {
  const w = normalize(word);
  if (UNIT_ALIASES[w] !== undefined) return true;
  return w.length >= 5 && Object.keys(UNIT_ALIASES).some((u) => u.length >= 5 && oneEditApart(w, u));
}

/** Una letra cambiada, sobrante o que falta («votellas» → «botellas», «cajs» no: menos de 5 letras). */
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j += 1;
  return Math.max(a.length, b.length) - i - j <= 1;
}

export function canonicalUnit(word: string): string | null {
  return UNIT_ALIASES[normalize(word)] ?? null;
}
