// Órdenes de oficina que se reconocen sin Jev (no están en su catálogo): pagar una factura y validar las
// salidas de almacén. Solo la orden («marca pagada la factura de Makro», «valida las salidas del
// Parador»); la pregunta («¿qué facturas hay por pagar?», «¿hay salidas sin validar?») es una consulta.
import type { SessionContext } from "../domain";
import { normalize } from "../entities/normalize";
import { QUERY_PAY } from "../tools/info";
import type { DocumentPlan } from "./plans";
import { namedLocations } from "./routing";

const QUESTION = /^(que|cual|cuales|cuant[oa]s?|hay|esta|estan|tengo|tenemos|cuando|donde|quien|como|se ha|se han|me dices|dime si)\b/;

const PAY_INVOICE =
  /\b(marca|marcar|marcame|marcala|pon|poner|ponla|apunta|apuntar|deja|dejar|dejala)\b.*(\bfactur\w*\b.*\bpagad[ao]s?\b|\bpagad[ao]s?\b.*\bfactur\w*)|\bfactur\w*\b.*\b(como|ya esta|esta|ya) pagad[ao]\b|\b(paga|pagar|pagame|pagamos|pague|he pagado|hemos pagado|liquida|liquidar|abona|abonar)\b.*\bfactur\w*|\bfactur\w*\b.*\b(la he|la hemos|ya la he|ya la hemos) pagado\b/;

const VALIDATE_MOVES =
  /\b(valida|validar|validame|validalas|validalo|aprueba|aprobar|apruebalas|acepta|aceptar|confirma|confirmar|confirmalas|da por buenas)\b.*\b(salidas?|movimientos?|devoluciones?|almacen)\b/;

export function officeAction(message: string, ctx: SessionContext, pageLocationId?: string): DocumentPlan | null {
  const text = normalize(message).replace(/[¿?¡!.,;:]/g, " ").replace(/\s+/g, " ").trim();
  if (!text || QUESTION.test(text)) return null;
  const accion = PAY_INVOICE.test(text.replace(QUERY_PAY, " ")) ? "pagar_factura" : VALIDATE_MOVES.test(text) ? "validar_salidas" : null;
  if (!accion) return null;
  const named = namedLocations(ctx.locations, message);
  const locationIds = named.length > 0 ? named.map((l) => l.id) : pageLocationId ? [pageLocationId] : ctx.locations.map((l) => l.id);
  return { type: "documento", accion, locationIds };
}
