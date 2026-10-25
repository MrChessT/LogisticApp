// Temas que el asistente no lleva (personal, ventas y márgenes) o que no se registran desde el chat
// (consumo): respuesta fija, sin Jev. Antes caían en «¿Qué quieres consultar?» y acababan en algo sin
// relación («que equipo hay» → stock del «Equilibrio»; «cuánto se espera ganar» → stock de especias).
import type { AppRoute } from "../contract/index";
import { normalize } from "../entities/normalize";

export interface TopicReply {
  text: string;
  route?: AppRoute;
}

const STOCK_WORDS = /\b(stock|queda|quedan|botellas?|cajas?|merma|traspas|pedido|inventario|recuento|precio)\b/;

/** null si el mensaje es del inventario (o no es uno de estos temas). */
export function topicReply(message: string): TopicReply | null {
  const text = normalize(message).replace(/[¿?¡!.,]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;

  // «olvídalo», «déjalo», «nada», «cancela»: no es una petición nueva.
  if (/^(olvidalo|dejalo|da igual|nada|nada nada|cancela|cancelar|no importa|ya esta)$/.test(text)) {
    return { text: "Vale, lo dejo. Dime si necesitas otra cosa." };
  }

  if (STOCK_WORDS.test(text)) return null;

  // Personal, turnos, fichajes.
  if (/\b(personal|plantilla|empleados?|trabajadores?|camareros?|nombres? del (equipo|personal)|que equipo|quien trabaja)\b/.test(text)) {
    return { text: "Las personas, sus roles y sus locales están en Equipo (solo para encargados y administración). Desde aquí llevo el inventario." };
  }
  if (/\b(fichar|fichaje|fichajes|horario|horarios|turnos?|nominas?|sueldos?|vacaciones)\b/.test(text)) {
    return { text: "Los fichajes, horarios y turnos todavía no están en la app. Desde aquí llevo el inventario: stock, mermas, traspasos, recepciones, recuentos y pedidos." };
  }

  // Ventas, ganancias, márgenes: no hay ventas registradas.
  if (/\b(ganar|ganamos|ganancias?|beneficios?|margen|margenes|facturacion|facturamos|ventas|vendemos|ingresos)\b/.test(text)) {
    return {
      text: "No tengo las ventas, así que no puedo calcular ganancias ni márgenes. Sí puedo darte el valor del stock, lo comprado a cada proveedor o las mermas (por ejemplo «¿cuánto vale el stock del Vivero?»).",
    };
  }
  return null;
}

/**
 * «se han consumido 10 cajas de coca», «apunta el consumo de…»: el consumo no se registra a mano, sale
 * de los recuentos. Se explica en vez de preguntar qué operación es (y acabar en una merma).
 */
export function consumptionByHand(message: string): TopicReply | null {
  const text = normalize(message).trim();
  // Una pregunta sobre el consumo («compara el consumo de los 4 locales», «¿cuánto se ha consumido?») se
  // contesta con los datos; esto es solo para cuando se quiere apuntar.
  if (/^[¿]?\s*(compara|cuant[oa]s?|que|cual|dame|muestra|ensena|ver|como|cuando|donde)\b/.test(text)) return null;
  if (text === "consumo") return CONSUMPTION_REPLY;
  const registers = /\b(se ha consumido|se han consumido|hemos consumido|consumimos|se ha gastado|se han gastado|hemos gastado)\b|\b(apunta|registra|anota|mete)\b.*\bconsumo\b/.test(text);
  if (!registers || !/\d/.test(text)) return null;
  return CONSUMPTION_REPLY;
}

const CONSUMPTION_REPLY: TopicReply = {
  text: "El consumo no se apunta a mano: sale de los recuentos (lo que había menos lo que queda). Si se ha roto, caducado o tirado, es una merma («merma de 2 botellas de Larios en el Parador»); si lo has contado, haz un recuento.",
  route: "/inventarios",
};
