// Órdenes de oficina que se reconocen sin Jev (no están en su catálogo): pagar una factura, validar las
// salidas de almacén, cambiar el PVP de un plato y las condiciones de un proveedor. Solo la orden («marca pagada la factura de Makro», «valida las salidas del
// Parador»); la pregunta («¿qué facturas hay por pagar?», «¿hay salidas sin validar?») es una consulta.
import type { SessionContext } from "../domain";
import { normalize } from "../entities/normalize";
import { QUERY_PAY } from "../tools/info";
import type { DocumentPlan } from "./plans";
import { namedLocations } from "../entities/signals";
import { mentionedSupplier } from "../entities/catalog-parser";
import { parseTermChanges } from "./supplier-terms";

const QUESTION = /^(que|cual|cuales|cuant[oa]s?|hay|esta|estan|tengo|tenemos|cuando|donde|quien|como|se ha|se han|me dices|dime si)\b/;

const PAY_INVOICE =
  /\b(marca|marcar|marcame|marcala|pon|poner|ponla|apunta|apuntar|deja|dejar|dejala)\b.*(\bfactur\w*\b.*\bpagad[ao]s?\b|\bpagad[ao]s?\b.*\bfactur\w*)|\bfactur\w*\b.*\b(como|ya esta|esta|ya) pagad[ao]\b|\b(paga|pagar|pagame|pagamos|pague|he pagado|hemos pagado|liquida|liquidar|abona|abonar)\b.*\bfactur\w*|\bfactur\w*\b.*\b(la he|la hemos|ya la he|ya la hemos) pagado\b/;

/**
 * PVP de un plato: tiene que decir que es el precio de venta (si no, «el ron ahora cuesta 15 €» es el
 * precio de compra, que va por Jev) y llevar un importe.
 */
const DISH_PRICE = /\b(pvp|precio de venta|precio en carta|precio de carta|se vende a|vendemos a|lo vendemos a|la vendemos a|los vendemos a|las vendemos a|cobramos|cobrar|cobra)\b/;

/**
 * Condiciones dichas como cambio («ahora es 200», «pon…», «se le pide…»): es una orden aunque el
 * proveedor no se reconozca (el borrador dirá que no lo encuentra, en vez de listar los proveedores).
 */
const CHANGE_TERMS = /\b(ahora|pon|poner|cambia|cambiar|cambialo|sube|baja|se le pide|le pedimos|se le paga|le pagamos|pasa a ser|pasa a)\b/;
/** Sin proveedor reconocido, solo cuenta si habla de un proveedor («pon el mínimo del ron» es stock). */
const SUPPLIER_TERMS = /\b(proveedor|pedido minimo|minimo de pedido|se le pide|le pedimos|se le paga|le pagamos|forma de pago|condiciones de pago|dias de pedido|hora limite)\b/;

const VALIDATE_MOVES =
  /\b(valida|validar|validame|validalas|validalo|aprueba|aprobar|apruebalas|acepta|aceptar|confirma|confirmar|confirmalas|da por buenas)\b.*\b(salidas?|movimientos?|devoluciones?|almacen)\b/;

export function officeAction(message: string, ctx: SessionContext, pageLocationId?: string): DocumentPlan | null {
  const text = normalize(message).replace(/[¿?¡!.,;:]/g, " ").replace(/\s+/g, " ").trim();
  if (!text || QUESTION.test(text)) return null;
  const accion = PAY_INVOICE.test(text.replace(QUERY_PAY, " "))
    ? "pagar_factura"
    : VALIDATE_MOVES.test(text)
      ? "validar_salidas"
      : DISH_PRICE.test(text) && /\d/.test(text)
        ? "precio_venta"
        : parseTermChanges(message).length > 0 && (mentionedSupplier(message, ctx.suppliers) || (CHANGE_TERMS.test(text) && SUPPLIER_TERMS.test(text)))
          ? "condiciones_proveedor"
          : null;
  if (!accion) return null;
  const named = namedLocations(ctx.locations, message);
  const locationIds = named.length > 0 ? named.map((l) => l.id) : pageLocationId ? [pageLocationId] : ctx.locations.map((l) => l.id);
  return { type: "documento", accion, locationIds };
}
