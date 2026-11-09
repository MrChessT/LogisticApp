// Temas que el asistente no lleva (personal, ventas y márgenes) o que no se registran desde el chat
// (consumo): respuesta fija, sin Jev. Antes caían en «¿Qué quieres consultar?» y acababan en algo sin
// relación («que equipo hay» → stock del «Equilibrio»; «cuánto se espera ganar» → stock de especias).
import type { AppRoute } from "../contract/index";
import { normalize } from "../entities/normalize";
import { QUERY_PAY } from "../tools/info";

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

  // Registrar o pagar facturas se hace en su pantalla (con el PDF y el cuadre de albaranes).
  if (/\bfactur\w*/.test(text) && /\b(crea|crear|creame|registra|registrar|anade|anadir|mete|meter|sube|subir|adjunta|adjuntar|paga|pagar|marca|marcar|nueva)\b/.test(text.replace(QUERY_PAY, " "))) {
    return {
      text: "Las facturas se registran en Gestión › Facturas: «Registrar factura», o desde «Albaranes sin factura» con sus albaranes ya marcados (ahí se adjunta el PDF y se marca como pagada). Desde aquí te digo cuáles están pendientes, vencidas o no cuadran.",
      route: "/facturas",
    };
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

// Pantallas: el asistente no navega solo (fallaba y dejaba el chat colgado). Dice dónde está y deja el enlace.
const SCREENS: Array<{ re: RegExp; route: AppRoute; path: string; tip?: string }> = [
  { re: /\bmermas?\b|\broturas?\b/, route: "/mermas", path: "Operativa › Mermas", tip: "o dímela aquí («merma de 2 botellas de Larios en el Parador») y te la preparo" },
  { re: /\btraspasos?\b/, route: "/traspasos", path: "Operativa › Traspasos", tip: "o dímelo aquí («pasa 2 cajas de coca del Parador al Vivero»)" },
  { re: /\brecepcion(es)?\b|\balbaran(es)?\b/, route: "/recepciones", path: "Operativa › Recepciones", tip: "o dímela aquí («han llegado 3 cajas de tónica al Parador»)" },
  { re: /\bpedidos?\b/, route: "/pedidos", path: "Operativa › Pedidos", tip: "o pídemelo aquí («prepara el pedido del Vivero para el finde»)" },
  { re: /\binventarios?\b|\brecuentos?\b|\bconteos?\b/, route: "/inventarios", path: "Operativa › Inventarios", tip: "o dímelo aquí («empieza el inventario del Vivero»)" },
  { re: /\balmacen\b/, route: "/almacen", path: "Operativa › Almacén" },
  { re: /\bstock\b|\bexistencias\b/, route: "/stock", path: "Operativa › Stock", tip: "o pregúntame («¿cuánta coca queda en el Vivero?»)" },
  { re: /\bproductos?\b|\bcatalogo\b|\bfichas?\b/, route: "/productos", path: "Gestión › Productos" },
  { re: /\bproveedor(es)?\b/, route: "/proveedores", path: "Gestión › Proveedores" },
  { re: /\bescandallos?\b|\brecetas?\b|\bplatos?\b/, route: "/escandallos", path: "Gestión › Escandallos" },
  { re: /\bfacturas?\b/, route: "/facturas", path: "Gestión › Facturas" },
  { re: /\binformes?\b|\bgraficas?\b|\banalisis\b|\bestadisticas\b/, route: "/informes", path: "Gestión › Informes" },
  { re: /\bequipo\b|\busuarios?\b/, route: "/equipo", path: "Gestión › Equipo" },
  { re: /\bzonas?\b|\bsecciones\b/, route: "/zonas", path: "Gestión › Zonas" },
  { re: /\binicio\b|\bresumen\b|\bdashboard\b|\bportada\b/, route: "/", path: "Resumen (arriba del todo en el menú)" },
];

const GO_TO = /^(llevame|lleveme|vamos|vete|ve|ir|ire|quiero ir|abre|abreme|abrir|ensename|muestrame|pasame|cambia|cambiame|navega|donde (esta|estan|se ve|se ven|se hace|se hacen|puedo ver|veo)|como (llego|voy|entro))\b/;

/** «llévame a mermas», «abre pedidos», «¿dónde están las facturas?»: dónde está y el enlace (sin navegar). */
export function screenHelp(message: string, locationNames: string[] = []): TopicReply | null {
  const text = normalize(message).replace(/[¿?¡!.,]/g, " ").replace(/\s+/g, " ").trim();
  if (!GO_TO.test(text) || /\d/.test(text)) return null;
  // «abre inventario en el Vivero», «abre el pedido de Makro»: es una operación, no una pantalla.
  if (/^(abre|abreme|abrir)\b/.test(text) && !/\b(pantalla|apartado|pagina|seccion|menu)\b/.test(text)) {
    if (/\b(inventario|pedido|traspaso|recuento|conteo)\b/.test(text) || locationNames.some((n) => text.includes(normalize(n)))) return null;
  }
  const screen = SCREENS.find((s) => s.re.test(text));
  if (!screen) return { text: "No te llevo a las pantallas, pero te digo dónde está cada cosa: en el menú de la izquierda, «Operativa» (stock, pedidos, recepciones, traspasos, almacén, inventarios y mermas) y «Gestión» (productos, proveedores, escandallos, facturas, informes, equipo y zonas). ¿Qué buscas?" };
  return { text: `Lo tienes en el menú: ${screen.path}${screen.tip ? `, ${screen.tip}` : ""}. Te dejo el enlace.`, route: screen.route };
}
