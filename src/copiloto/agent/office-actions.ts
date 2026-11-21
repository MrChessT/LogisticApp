// Órdenes de oficina que se reconocen sin Jev (no están en su catálogo): pagar una factura, apuntar y
// validar salidas de almacén, cambiar el PVP de un plato, las condiciones de un proveedor y la ficha
// de un producto (categoría, alérgenos). Solo la orden
// («marca pagada la factura de Makro», «valida las salidas del Parador»); la pregunta («¿qué facturas hay
// por pagar?», «¿hay salidas sin validar?») es una consulta.
import type { SessionContext } from "../domain";
import { normalize, tokenize } from "../entities/normalize";
import { QUERY_PAY } from "../tools/info";
import type { DocumentPlan } from "./plans";
import { mentionsWaste, namedLocations } from "../entities/signals";
import { mentionedSupplier } from "../entities/catalog-parser";
import { parseTermChanges } from "./supplier-terms";
import { parseSheet } from "./product-sheet";
import { NEW_RECIPE } from "./recipe-chat";
import { recipeEditFromMessage } from "./recipe-edit";
import { SALES_LINK } from "../drafts/sales-link-builder";
import { PACK_RE } from "../drafts/pack-builder";

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

/**
 * Salida de almacén a una zona de servicio («saca 2 cajas de coca a la barra 1») o devolución. «Baja» no
 * cuenta (también es «dar de baja») y una frase con palabras de merma es una merma.
 */
const MOVE_VERB = /\b(saca|sacar|sacame|sacamos|sube|subir|subeme|subimos|lleva|llevar|llevame|llevamos|pasa|pasar|pasame|mueve|mover|devuelve|devolver|devolvemos)\b|\b(apunta|registra) (una )?(salida|devolucion)\b/;

function namesServiceArea(text: string, ctx: SessionContext): boolean {
  const words = new Set(text.split(" "));
  return ctx.areas.some((a) => a.kind === "servicio" && tokenize(a.name).some((t) => t.length >= 4 && !/^\d+$/.test(t) && words.has(t)));
}

/** Una cantidad de operación («2 cajas», «3 botellas»): no es un cambio de ficha (lo es «Larios 12»). */
const QUANTITY = /\b\d+([.,]\d+)?\s*(cajas?|botellas?|ud|uds|unidades|packs?|kg|kilos?|latas?|bolsas?|barriles?|litros?)\b/;

/** «La coca también viene en caja de 12», «nuevo formato del Barceló: caja de 6 botellas». */
const NEW_PACK = /\b(viene|vienen|tambien viene|formato|formatos|se vende en|nos lo traen|lo traen)\b/;

/** «Crea la zona Terraza…», «añade una sección…», «nueva zona…». */
const NEW_ZONE = /\b(crea|crear|creame|anade|anadir|nueva|da de alta|dar de alta)\b.*\b(zona|seccion|espacio)\b|\bnueva (zona|seccion)\b/;

/**
 * «El proveedor de la tónica es Makro», «asocia Makro a la coca», «nos la trae Makro». Hace falta la palabra
 * proveedor (o asociar) y un verbo de asignar; las preguntas («¿quién es el proveedor…?», «dime el proveedor…») no.
 */
const SUPPLIER_WORD = /\b(proveedor|proveedores|asocia|asociar|asocialo|asociala)\b/;
const ASSIGN_VERB = /\b(es|son|sea|anade|anadir|agrega|agregar|pon|poner|asocia|asociar|asocialo|asociala)\b/;
/** «Nos la trae Makro»: sin la palabra proveedor, pero sin cantidades (con cantidades sería un pedido). */
const SUPPLY_VERB = /\b(nos lo trae|nos la trae|lo trae|la trae|lo compramos a|la compramos a|lo compramos|la compramos)\b/;
const ASKS_FIRST = /^(quien|que|cual|cuales|cuanto|cuantos|donde|dime|dame|muestrame|ensename|cuantas)\b/;
const supplierLinkMessage = (text: string) => ((SUPPLIER_WORD.test(text) && ASSIGN_VERB.test(text)) || (SUPPLY_VERB.test(text) && !QUANTITY.test(text))) && !ASKS_FIRST.test(text);

/** «Crea…», «nuevo…»: es un escandallo nuevo aunque se parezca a uno que ya existe. */
const NEW_RECIPE_VERB = /\b(crea|crear|creame|nuevo|nueva|da de alta|dar de alta)\b/;

const VALIDATE_MOVES =
  /\b(valida|validar|validame|validalas|validalo|aprueba|aprobar|apruebalas|acepta|aceptar|confirma|confirmar|confirmalas|da por buenas)\b.*\b(salidas?|movimientos?|devoluciones?|almacen)\b/;

export function officeAction(message: string, ctx: SessionContext, pageLocationId?: string): DocumentPlan | null {
  const text = normalize(message).replace(/[¿?¡!.,;:]/g, " ").replace(/\s+/g, " ").trim();
  if (!text || QUESTION.test(text)) return null;
  // «¿la factura de X está pagada?» pregunta si lo está: no es la orden de pagarla.
  const asksIfPaid = /[¿?]/.test(message) && /\b(esta|estan|ya esta|se ha|se han|fue|han sido)\s+pagad[ao]s?\b/.test(text);
  const accion = !asksIfPaid && PAY_INVOICE.test(text.replace(QUERY_PAY, " "))
    ? "pagar_factura"
    : VALIDATE_MOVES.test(text)
      ? "validar_salidas"
      : SALES_LINK.test(text)
        ? "enlazar_venta"
      : !NEW_RECIPE_VERB.test(text) && recipeEditFromMessage(message, ctx.recipes)
        ? "editar_escandallo"
      : NEW_RECIPE.test(text)
        ? "crear_escandallo"
      : supplierLinkMessage(text) && mentionedSupplier(message, ctx.suppliers)
        ? "asociar_proveedor"
      : DISH_PRICE.test(text) && /\d/.test(text)
        ? "precio_venta"
        : parseTermChanges(message).length > 0 && (mentionedSupplier(message, ctx.suppliers) || (CHANGE_TERMS.test(text) && SUPPLIER_TERMS.test(text)))
          ? "condiciones_proveedor"
          : MOVE_VERB.test(text) && /\d/.test(text) && namesServiceArea(text, ctx) && !mentionsWaste(message) && namedLocations(ctx.locations, message).length < 2
            ? "salida_almacen"
            : !QUANTITY.test(text) && parseSheet(message, ctx)
              ? "ficha_producto"
              : NEW_ZONE.test(text)
                ? "crear_zona"
                : NEW_PACK.test(text) && PACK_RE.test(text) && !/\b(da|dar|doy|dame) de alta\b|\bnuevo producto\b|\bproducto nuevo\b/.test(text)
                  ? "formato_producto"
                  : null;
  if (!accion) return null;
  const named = namedLocations(ctx.locations, message);
  const locationIds = named.length > 0 ? named.map((l) => l.id) : pageLocationId ? [pageLocationId] : ctx.locations.map((l) => l.id);
  return { type: "documento", accion, locationIds };
}
