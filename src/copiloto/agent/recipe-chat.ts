// Escandallo nuevo dicho en una frase («crea el escandallo de croquetas de jamón con PVP 9,50», «nueva
// elaboración salsa de tomate: 1 kg de tomate, 50 ml de aceite»). Aquí solo se lee la frase: el nombre, si es
// plato o elaboración, el PVP y los ingredientes con su cantidad. Qué productos son y si cuadran lo decide el
// constructor contra el catálogo.
import { normalize } from "../entities/normalize";

/** Verbo de alta + sustantivo de cocina: «crea el escandallo…», «nuevo plato…», «da de alta la receta…». */
export const NEW_RECIPE = /\b(crea|crear|creame|nuevo|nueva|da de alta|dar de alta|alta|anade|anadir)\b.*\b(escandallo|receta|elaboracion|plato)\b|\b(nuevo|nueva) (escandallo|receta|elaboracion|plato)\b/;

export interface RecipeIngredient {
  /** Cantidad tal cual se dijo, en cadena decimal con punto; null si no se dijo. */
  amount: string | null;
  /** Unidad dicha en minúsculas sin acentos («kg», «ml», «ud»…); null si la cantidad es un número de unidades. */
  unit: string | null;
  /** Lo que queda de la frase para buscar el producto. */
  phrase: string;
}

export interface RecipeChat {
  kind: "plato" | "elaboracion";
  name: string;
  /** PVP con IVA dicho en la frase, en cadena decimal; null si no se dijo. */
  salePrice: string | null;
  ingredients: RecipeIngredient[];
}

const NAME =
  /\b(?:escandallo|receta|elaboraci[oó]n|plato)\s+(?:nuev[oa]\s+)?(?:de\s+|del\s+|de\s+la\s+|de\s+las\s+|de\s+los\s+|para\s+|llamad[oa]\s+)?(.+?)(?=\s+(?:con|que|lleva|llevan|ingredientes|pvp|precio)\b|\s+a\s+\d|[,.:;!?]|$)/i;
/** El PVP dicho: «PVP 9,50», «precio de venta 9 €», «a 9,50 €» tras la palabra. */
const PRICE = /\b(?:pvp|precio(?: de venta)?)\b\D{0,12}?(\d+(?:[.,]\d{1,2})?)/i;
const PRICE_PHRASE = /\b(?:pvp|precio(?: de venta)?)\b\D{0,12}?\d+(?:[.,]\d{1,2})?\s*(?:€|euros?)?/i;
/** La lista de ingredientes: tras «lleva», «llevan», «ingredientes», «con» o tras dos puntos al nombrar. */
const INGREDIENTS = /\b(?:lleva|llevan|ingredientes|con)\b\s*:?\s*(.+)$/i;
const AFTER_COLON = /^\s*:\s*(.+)$/;
const PIECE = /^(\d+(?:[.,]\d+)?)\s*(?:(kg|kilos?|g|gramos?|l|litros?|cl|ml|ud|uds|unidades)\b\s*)?(?:de\s+|del\s+|de\s+la\s+|de\s+las\s+|de\s+los\s+)?(.+)$/i;
/** Cada unidad dicha, en la forma que usa la base de datos para la línea. */
const UNIT_ALIAS: Record<string, string> = {
  kg: "kg", kilo: "kg", kilos: "kg", g: "g", gramo: "g", gramos: "g",
  l: "l", litro: "l", litros: "l", cl: "cl", ml: "ml",
  ud: "ud", uds: "ud", unidad: "ud", unidades: "ud",
};

/** Lee el escandallo de la frase, o null si no se nombra ninguno. */
export function recipeFromMessage(message: string): RecipeChat | null {
  const nameMatch = NAME.exec(message);
  if (!nameMatch) return null;
  const name = nameMatch[1]!.replace(/[.!]+$/, "").trim();
  if (!name) return null;
  // Lo que sigue al nombre: el PVP, la lista de ingredientes («con…», «lleva…», «: …»).
  const rest = message.slice(nameMatch.index + nameMatch[0].length);
  const kind = /\belaboraci[oó]n\b/i.test(message) ? "elaboracion" : "plato";
  const price = PRICE.exec(rest)?.[1]?.replace(",", ".") ?? null;
  // El PVP se quita antes de buscar ingredientes: «con PVP 6,50: 1 l de…» no pierde la lista.
  const cleaned = rest.replace(PRICE_PHRASE, " ");
  const segment = (INGREDIENTS.exec(cleaned) ?? AFTER_COLON.exec(cleaned))?.[1]?.replace(/^(?:[\s,;:]|y\s+)+/, "").trim() ?? "";
  const ingredients = segment
    .split(/\s*,\s*|\s*;\s*|\s+y\s+(?=\d)/)
    .map((piece) => piece.trim().replace(/[.!?]+$/, ""))
    .filter(Boolean)
    .map((piece): RecipeIngredient | null => {
      const m = PIECE.exec(piece);
      if (m) {
        const unit = m[2] ? UNIT_ALIAS[normalize(m[2])] ?? null : null;
        return { amount: m[1]!.replace(",", "."), unit, phrase: m[3]!.trim() };
      }
      // Sin cantidad, la línea se avisa para que la pongan en Escandallos (no se inventa un número).
      return /^[a-záéíóúñü]/i.test(piece) ? { amount: null, unit: null, phrase: piece } : null;
    })
    .filter((x): x is RecipeIngredient => x !== null);
  return {
    kind,
    name: name.charAt(0).toUpperCase() + name.slice(1),
    salePrice: kind === "plato" ? price : null,
    ingredients,
  };
}
