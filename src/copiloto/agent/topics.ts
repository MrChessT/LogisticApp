// Temas que el asistente no lleva (personal, ventas y márgenes) o que no se registran desde el chat
// (consumo): respuesta fija, sin Jev. Antes caían en «¿Qué quieres consultar?» y acababan en algo sin
// relación («que equipo hay» → stock del «Equilibrio»; «cuánto se espera ganar» → stock de especias).
import type { AnalyticsView, AppRoute } from "../contract/index";
import { normalize, tokenize } from "../entities/normalize";
import { QUERY_PAY } from "../tools/info";
import type { AvisoPlan } from "./plans";

export type TopicReply = Omit<AvisoPlan, "type">;

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

  // Previsiones («¿cuánto se espera ganar?», «¿cuánto vamos a vender?»): no se inventan.
  if (/\b(se espera|esperamos|espero|prevision(es)?|previsto|prevemos|vamos a|ganaremos|venderemos|facturaremos|proximo mes|que viene)\b/.test(text) && /\b(ganar|ganaremos|ganancias?|beneficios?|vender|venderemos|ventas?|facturar|facturaremos|facturacion)\b/.test(text)) {
    return {
      text: "No hago previsiones de ventas ni de ganancias. Sí te digo lo vendido de verdad, con su coste teórico, food cost y margen bruto: pregúntame «¿cuánto vendimos este mes?» o «¿qué plato vende más?».",
      route: "/ventas",
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
  // Lo dicho desde la primera cantidad («10 cajas de cocacola y 3 fantas en el Parador») se ofrece como
  // merma ya escrita: si era eso, un toque y Jev prepara el borrador con los mismos productos.
  const items = message.slice(message.search(/\d/)).trim().replace(/[.!]+$/, "");
  return { ...CONSUMPTION_REPLY, text: `${CONSUMPTION_REPLY.text} Si se ha roto o tirado, te preparo la merma con lo que me has dicho.`, actions: [{ label: "Registrar como merma", say: `merma de ${items}` }] };
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
  { re: /\bventas?\b|\btpv\b/, route: "/ventas", path: "Gestión › Ventas", tip: "o pregúntame («¿cuánto vendimos ayer?»)" },
  { re: /\bfacturas?\b/, route: "/facturas", path: "Gestión › Facturas" },
  { re: /\binformes?\b|\bgraficas?\b|\banalisis\b|\bestadisticas\b/, route: "/informes", path: "Gestión › Informes" },
  { re: /\bequipo\b|\busuarios?\b/, route: "/equipo", path: "Gestión › Equipo" },
  { re: /\bzonas?\b|\bsecciones\b/, route: "/zonas", path: "Gestión › Zonas" },
  { re: /\binicio\b|\bresumen\b|\bpanel\b|\bdashboard\b|\bportada\b/, route: "/", path: "Panel (arriba del todo en el menú)" },
];

const GO_TO = /^(llevame|lleveme|vamos|vete|ve|ir|ire|quiero ir|abre|abreme|abrir|ensename|muestrame|pasame|cambia|cambiame|navega|donde (esta|estan|se ve|se ven|se hace|se hacen|puedo ver|veo)|como (llego|entro|voy a|voy al))\b/;

/** «llévame a mermas», «abre pedidos», «¿dónde están las facturas?»: dónde está y el enlace (sin navegar). */
export function screenHelp(message: string, locationNames: string[] = []): TopicReply | null {
  const text = normalize(message).replace(/[¿?¡!.,]/g, " ").replace(/\s+/g, " ").trim();
  if (!GO_TO.test(text) || /\d/.test(text)) return null;
  // «abre inventario en el Vivero», «abre el pedido de Makro»: es una operación, no una pantalla.
  if (/^(abre|abreme|abrir)\b/.test(text) && !/\b(pantalla|apartado|pagina|seccion|menu)\b/.test(text)) {
    if (/\b(inventario|pedido|traspaso|recuento|conteo)\b/.test(text) || locationNames.some((n) => text.includes(normalize(n)))) return null;
  }
  // «Llévame a los informes de mermas de este mes»: Informes con esa vista y ese periodo, no Mermas.
  const report = /\b(informes?|graficas?|analisis|estadisticas)\b/.test(text) ? reportView(text) : null;
  const screen = report ? SCREENS.find((s) => s.route === "/informes") : SCREENS.find((s) => s.re.test(text));
  if (!screen) return { text: "¿A qué pantalla? En el menú de la izquierda están «Operativa» (stock, pedidos, recepciones, traspasos, almacén, inventarios y mermas) y «Gestión» (productos, proveedores, escandallos, ventas, facturas, informes, equipo y zonas). Dime cuál y te llevo." };
  // «Llévame», «abre», «vamos a»: se abre la pantalla. «¿Dónde está…?»: se dice dónde, con el enlace.
  const go = !/^(donde|como)\b/.test(text);
  const where = report ? `${screen.path}, vista ${report.label}${report.days ? ` (últimos ${report.days} días)` : ""}` : screen.path;
  const filters = report ? { view: report.view, ...(report.days ? { days: report.days } : {}) } : undefined;
  if (go) return { text: `Te llevo a ${where}.${screen.tip && !report ? ` Si quieres, ${screen.tip.replace(/^o /, "")}.` : ""}`, route: screen.route, go, ...(filters ? { filters } : {}) };
  return { text: `Lo tienes en el menú: ${where}${screen.tip ? `, ${screen.tip}` : ""}. Te dejo el enlace.`, route: screen.route, ...(filters ? { filters } : {}) };
}

const REPORT_VIEWS: Array<{ re: RegExp; view: AnalyticsView; label: string }> = [
  { re: /\bmermas?\b|\broturas?\b/, view: "mermas", label: "Mermas" },
  { re: /\bconsumos?\b|\bgasto\b|\bse gasta\b/, view: "consumo", label: "Consumo" },
  { re: /\bprecios?\b/, view: "precios", label: "Precios" },
  { re: /\breponer\b|\breposicion\b/, view: "reposicion", label: "Reposición" },
  { re: /\bdesvios?\b|\bdescuadres?\b|\bdiferencias\b/, view: "desvios", label: "Desvíos" },
  { re: /\bstock\b|\bexistencias\b/, view: "stock", label: "Stock" },
];

/** Vista y periodo de Informes dichos en el mensaje (Informes muestra 7, 30 o 90 días). */
function reportView(text: string): { view: AnalyticsView; label: string; days?: 7 | 30 | 90 } {
  const found = REPORT_VIEWS.find((v) => v.re.test(text)) ?? { view: "resumen" as const, label: "Resumen" };
  const days = /\b(hoy|ayer|semana)\b/.test(text) ? 7 : /\b(trimestre|tres meses)\b/.test(text) ? 90 : /\bmes\b/.test(text) ? 30 : undefined;
  return { view: found.view, label: found.label, ...(days ? { days } : {}) };
}

/**
 * «sí», «no», «vale» sueltos cuando no hay nada pendiente (ni borrador ni pregunta): antes Jev no sabía
 * qué se pedía y contestaba «¿Qué quieres hacer?».
 */
export function bareAnswer(message: string, lastAssistant: string | undefined): TopicReply | null {
  const text = normalize(message).replace(/[¿?¡!.,]/g, " ").replace(/\s+/g, " ").trim();
  if (/^(no|no gracias|nop|nada mas|eso es todo)$/.test(text)) return { text: "Vale. Aquí estoy si necesitas otra cosa." };
  if (!/^(si|sip|vale|ok|okay|de acuerdo|claro|venga|perfecto|si porfa|si por favor|dale)$/.test(text)) return null;
  const offered = lastAssistant && /\benlace\b/.test(lastAssistant);
  return {
    text: offered
      ? "Pulsa el enlace de mi respuesta anterior y te abre la pantalla. Si quieres otra cosa, dímela."
      : "No tengo nada pendiente de confirmar. Dime qué necesitas («¿cuánta coca queda en el Vivero?», «merma de 2 botellas de Larios») o escribe /ayuda.",
  };
}

/** Saludo, agradecimiento o despedida corta («gracias!», «buenas», «hasta luego»). */
export function smallTalk(message: string): "hola" | "gracias" | "adios" | undefined {
  const words = tokenize(message);
  if (words.length === 0 || words.length > 5) return undefined;
  const text = words.join(" ");
  if (/^(muchas |mil )?gracias\b|^(genial|perfecto|vale|ok|estupendo)( muchas)? gracias\b|^thanks?\b/.test(text)) return "gracias";
  if (/^(adios|hasta luego|hasta manana|chao|nos vemos|bye)\b/.test(text)) return "adios";
  if (/^(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|ey)\b/.test(text)) return "hola";
  return undefined;
}
