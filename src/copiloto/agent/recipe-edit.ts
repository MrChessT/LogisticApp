// Cambiar los ingredientes de un escandallo que ya existe, dicho en una frase:
//   «añade 20 g de queso a las croquetas», «quita el ajo del gazpacho», «en las croquetas pon 150 g de jamón»,
//   «cambia el jamón de las croquetas a 150 g», «las croquetas llevan 150 g de jamón».
// Aquí solo se lee la frase: qué escandallo (uno de los que ve la persona, por su nombre), qué se hace y con qué
// ingrediente y cantidad. Qué producto o elaboración es, y si la cantidad cuadra, lo decide el constructor.
import type { RecipeRef } from "../domain";
import { normalize } from "../entities/normalize";

type RecipeEditOp = "add" | "remove" | "set";

export interface RecipeEditChat {
  recipe: RecipeRef;
  op: RecipeEditOp;
  /** El ingrediente tal cual se dijo («queso rallado», «la bechamel»). */
  phrase: string;
  /** Cantidad dicha (cadena decimal con punto) y su unidad («g», «kg», «ml», «l», «cl», «ud»); null si no se dijo. */
  amount: string | null;
  unit: string | null;
}

const ADD = /\b(anade|anadir|anadele|agrega|agregar|agregale|mete|meter|metele|incluye|incluir|incluyele|suma|sumale)\b/;
const REMOVE = /\b(quita|quitar|quitale|elimina|eliminar|eliminale|borra|borrar|saca|sacale)\b/;
const SET = /\b(cambia|cambiar|cambiale|pon|poner|ponle|sube|subir|subele|baja|bajar|bajale|ajusta|deja|dejale|lleva|llevan)\b/;
/** Palabras de otras operaciones: con ellas no es un escandallo («quita la tónica del pedido»). */
const OTHER = /\b(pvp|precio|precios|euros?|pedido|pedidos|traspaso|traspasos|recepcion|albaran|inventario|merma|mermas|factura|stock|minimo|maximo|cajas?|botellas?|barril|packs?)\b/;
/** Antes del nombre del escandallo: «a las croquetas», «del gazpacho», «en la pizza». */
const PREP = "(?:a|al|en|de|del|para)(?:\\s+(?:el|la|los|las))?";
const AMOUNT = /(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|gr|gramos?|l|litros?|cl|ml|ud|uds|unidades)?\b/;
const UNIT_ALIAS: Record<string, string> = {
  kg: "kg", kilo: "kg", kilos: "kg", g: "g", gr: "g", gramo: "g", gramos: "g",
  l: "l", litro: "l", litros: "l", cl: "cl", ml: "ml", ud: "ud", uds: "ud", unidad: "ud", unidades: "ud",
};
const ARTICLES = /^(?:(?:el|la|los|las|un|una|de|del|a|al|en|y|tambien|que|mas)\s+)+/;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Fuera la puntuación, salvo la coma o el punto decimal de una cantidad («0,1 kg»).
const clean = (s: string) => normalize(s).replace(/(?<!\d)[.,]|[.,](?!\d)|[¿?¡!;:«»"()]/g, " ").replace(/\s+/g, " ").trim();

/** El escandallo nombrado tras una preposición: el de nombre más largo que aparece entero. */
function namedRecipe(text: string, recipes: RecipeRef[]): { recipe: RecipeRef; match: RegExpExecArray } | null {
  let best: { recipe: RecipeRef; match: RegExpExecArray } | null = null;
  for (const recipe of recipes) {
    const name = clean(recipe.name);
    if (name.length < 3) continue;
    const m = new RegExp(`\\b${PREP}\\s+(?:(?:escandallo|receta|plato|elaboracion)\\s+(?:de\\s+(?:la\\s+|las\\s+|los\\s+|el\\s+)?)?)?${escape(name)}\\b`).exec(text);
    if (m && (!best || name.length > clean(best.recipe.name).length)) best = { recipe, match: m };
  }
  return best;
}

/** Lee el cambio de la frase, o null si no es un cambio de ingredientes de un escandallo que la persona ve. */
export function recipeEditFromMessage(message: string, recipes: RecipeRef[] | undefined): RecipeEditChat | null {
  if (!recipes?.length) return null;
  const text = clean(message);
  if (OTHER.test(text)) return null;
  const op: RecipeEditOp | null = REMOVE.test(text) ? "remove" : ADD.test(text) ? "add" : SET.test(text) ? "set" : null;
  if (!op) return null;
  const named = namedRecipe(text, recipes);
  if (!named) return null;
  // Lo que queda sin el escandallo ni el verbo es el ingrediente (y su cantidad).
  const verb = op === "remove" ? REMOVE : op === "add" ? ADD : SET;
  let rest = `${text.slice(0, named.match.index)} ${text.slice(named.match.index + named.match[0].length)}`.replace(verb, " ");
  const amount = AMOUNT.exec(rest);
  if (amount) rest = rest.replace(amount[0], " ");
  // «cambia el jamón … a 150 g»: la «a» que queda delante de la cantidad sobra.
  const phrase = rest.replace(/\s+/g, " ").trim().replace(ARTICLES, "").replace(/\s+(?:a|en|de)$/, "").trim();
  if (!phrase || /^\d/.test(phrase)) return null;
  if (op !== "remove" && !amount) return null;
  return {
    recipe: named.recipe,
    op,
    phrase,
    amount: amount ? amount[1]!.replace(",", ".") : null,
    unit: amount?.[2] ? UNIT_ALIAS[amount[2]] ?? null : null,
  };
}
