// Alcance por cuenta de análisis en el asistente (roles, fase 5). Los datos ya llegan filtrados por la base de datos
// (0056 y 0058): aquí solo se evita una respuesta engañosa. Si el cocinero (solo Comida) pregunta por ginebra, no hay
// ningún producto que encaje y la consulta saldría sin filtro, con el stock de todo lo suyo. En su lugar se le dice
// que eso es de otra cuenta.
import { STOPWORDS, tokenize } from "../entities/normalize";
import type { Decision } from "../contract/index";
import type { SessionContext } from "../domain";
import type { AvisoPlan, Plan } from "../agent/plans";

/** Palabra de lo que no ve: su cuenta, y si también sale en lo que sí ve («vino»: Bebida y el vino de cocinar). */
export type PalabraOculta = { cuenta: string; compartida: boolean };

/** Palabras de lo que no ve (hidden_catalog_words, 0059), marcando las que también salen en su catálogo. */
export function palabrasOcultas(rows: Array<{ word: string; account: string }>, visibles: string[]): Record<string, PalabraOculta> {
  const propias = new Set(visibles.flatMap(tokenize));
  const out: Record<string, PalabraOculta> = {};
  for (const { word, account } of rows) out[word] = { cuenta: account, compartida: propias.has(word) };
  return out;
}

/** Singular y plural: «ginebras» ↔ «ginebra», «vino» ↔ «vinos», «licores» ↔ «licor». */
function variantes(token: string): string[] {
  const out = [token, `${token}s`, `${token}es`];
  if (token.endsWith("es")) out.push(token.slice(0, -2));
  if (token.endsWith("s")) out.push(token.slice(0, -1));
  return out;
}

const lista = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`);

/**
 * Pregunta que nombra algo de una cuenta que la persona no ve: aviso en vez de una respuesta sin filtro o de una
 * pregunta con productos que no son («cervezas» acababa en «cereza», «Beefeater» en «¿de qué producto?»).
 * - Una palabra que solo sale en lo que no ve: aviso en cualquier consulta o pregunta por el producto.
 * - Una que también sale en lo suyo («vino», por el de cocinar): solo si la consulta quedó sin productos porque Jev
 *   descartó los suyos («ninguno de estos»).
 */
export function fueraDeTusCuentas(
  plan: Plan,
  message: string,
  ctx: Pick<SessionContext, "cuentas" | "palabrasOcultas">,
  decisions: Decision[] = [],
): AvisoPlan | null {
  const ocultas = ctx.palabrasOcultas;
  if (!ocultas || !ctx.cuentas?.length) return null;
  const consulta = plan.type === "consultar";
  if (!consulta && !(plan.type === "clarify" && plan.field === "producto")) return null;
  const sinProductos = consulta && plan.products.length === 0 && decisions.some((d) => d.id.startsWith("producto_") && d.value === "ninguno");
  for (const token of tokenize(message)) {
    // Las palabras de la pregunta («cuanto», «queda», «falta») nunca nombran un producto.
    if (STOPWORDS.has(token)) continue;
    const hit = variantes(token).map((v) => ocultas[v]).find((o) => o && (!o.compartida || sinProductos));
    if (!hit) continue;
    return {
      type: "aviso",
      text: `«${token}» es de ${hit.cuenta}, y tú solo ves ${lista(ctx.cuentas)}. Si lo necesitas, pídeselo a quien lleva el equipo.`,
    };
  }
  return null;
}
