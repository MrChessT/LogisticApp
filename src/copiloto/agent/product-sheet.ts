// Cambios de la ficha de un producto dichos en una frase: la categoría («pon el pacharán en Licores»,
// «cambia la categoría del hielo a Fruta») y los alérgenos («la tónica lleva sulfitos», «quita el gluten
// del pan»). Solo la orden: con «¿…?» es una pregunta («¿lleva gluten el pan?») y va por su consulta.
// Qué productos son y si se puede cambiar lo deciden el borrador y la base de datos.
import type { SessionContext } from "../domain";
import { normalize, tokenize } from "../entities/normalize";

export interface SheetChange {
  categoryId?: string;
  addAllergens: string[];
  removeAllergens: string[];
  /** Lo que queda de la frase para buscar el producto. */
  productPhrase: string;
}

/** Cómo se dice cada alérgeno (claves de la tabla product_allergens, migración 0035). */
const ALLERGEN_WORDS: Array<[string, RegExp]> = [
  ["gluten", /\bgluten\b/],
  ["crustaceos", /\b(crustaceos?|marisco)\b/],
  ["huevo", /\bhuevos?\b/],
  ["pescado", /\bpescados?\b/],
  ["cacahuete", /\bcacahuetes?\b/],
  ["soja", /\bsoja\b/],
  ["lacteos", /\b(lacteos?|lactosa|leche)\b/],
  ["frutos_cascara", /\b(frutos? de cascara|frutos? secos|nueces)\b/],
  ["apio", /\bapio\b/],
  ["mostaza", /\bmostaza\b/],
  ["sesamo", /\bsesamo\b/],
  ["sulfitos", /\bsulfitos?\b/],
  ["altramuces", /\baltramuz(ces)?\b/],
  ["moluscos", /\bmoluscos?\b/],
];

const REMOVE = /\b(quita|quitale|quitar|elimina|eliminar|borra|no lleva|no llevan|no contiene|no contienen|no tiene|no tienen)\b/;
const ADD = /\b(lleva|llevan|contiene|contienen|tiene|tienen|anade|anadele|anadir|pon|ponle|marca|agrega)\b/;
const MOVE = /\b(pon|ponlo|ponla|ponlos|ponlas|mete|metelo|mueve|muevelo|pasa|pasalo|cambia|cambiar|cambiale|va en|van en|es de|son de|esta en|estan en)\b/;
const NOT_PRODUCT = new Set(
  "el la los las lo de del al a en y que pon ponlo ponla ponlos ponlas mete metelo mueve muevelo pasa pasalo cambia cambiar cambiale va van es son esta estan categoria familia seccion alergeno alergenos lleva llevan contiene contienen tiene tienen anade anadele anadir marca agrega quita quitale quitar elimina eliminar borra no ahora".split(" "),
);

export function parseSheet(message: string, ctx: SessionContext): SheetChange | null {
  if (/[¿?]/.test(message)) return null;
  const text = normalize(message).replace(/[¡!.,;:]/g, " ").replace(/\s+/g, " ").trim();
  const said = ` ${tokenize(message).join(" ")} `;

  // Categoría: se nombra una del catálogo (la más larga) con un verbo de mover o la palabra «categoría».
  const category = [...ctx.categories]
    .filter((c) => tokenize(c.name).length > 0 && said.includes(` ${tokenize(c.name).join(" ")} `))
    .sort((a, b) => b.name.length - a.name.length)[0];
  const wantsCategory = !!category && (MOVE.test(text) || /\b(categoria|familia|seccion)\b/.test(text));

  const allergens = ALLERGEN_WORDS.filter(([, re]) => re.test(text)).map(([id]) => id);
  const removing = REMOVE.test(text);
  const wantsAllergens = allergens.length > 0 && (removing || ADD.test(text));
  if (!wantsCategory && !wantsAllergens) return null;

  // Lo que queda (sin verbos, la categoría ni los alérgenos) es el producto.
  const drop = new Set([...(wantsCategory ? tokenize(category!.name) : []), ...tokenize(allergens.join(" ").replace(/_/g, " ")), "lactosa", "leche", "marisco", "secos", "cascara", "frutos"]);
  const productPhrase = tokenize(message).filter((w) => !NOT_PRODUCT.has(w) && !drop.has(w)).join(" ");
  if (!productPhrase) return null;
  return {
    ...(wantsCategory ? { categoryId: category!.id } : {}),
    addAllergens: wantsAllergens && !removing ? allergens : [],
    removeAllergens: wantsAllergens && removing ? allergens : [],
    productPhrase,
  };
}
