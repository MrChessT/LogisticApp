// Opciones de cada decisión de Jev (claves en español, descripciones en inglés) y la versión del
// catálogo. Cambiar un texto aquí o en las preguntas sube CATALOG_VERSION: invalida la caché de
// decisiones y obliga a medir otra vez con Jev real (npm run copiloto:eval).
import { type ChoiceCriteria } from "@typesafe-ai/sdk";

export const CATALOG_VERSION = "2026-11-13.1";

// Opciones fijas --------------------------------------------------------------

export const INTENTS = {
  consultar: "Get figures or facts from the business data: stock levels and value, movements, consumption and what was broken or written off, prices, suppliers and their terms, formats and minimum levels of a product, purchases and spending, purchase orders, pending transfers, stock counts and their differences, supplier invoices and what is pending to pay, the team (staff), recipes and dishes (cost, food cost, allergens), sales registered at the till (how much was sold, best sellers, food cost of what was sold), storage areas or zones. Usually a question (\"¿se ha roto algo hoy?\", \"¿cuál es el mínimo…?\", \"¿quién nos trae…?\", \"¿qué facturas hay pendientes?\").",
  proponer_accion:
    "An instruction to record or prepare an operation, or a statement of what just happened to the goods, that changes stock, documents or the product catalog: waste or breakage, transfer between venues, receiving or cancelling a transfer, goods receipt, starting a stock count, recording counted quantities, closing a stock count, adding a new product, changing a purchase price, changing a minimum or target stock level, archiving or removing a product, preparing, sending, receiving or cancelling a purchase order.",
  pedir_sugerencias: "Ask what needs attention, what is missing or what to order (a shopping list), without naming a concrete operation.",
  conversar: "Greeting, thanks, or a question about how to use the assistant or the app (\"¿cómo hago un traspaso?\", \"¿qué sabes hacer?\").",
  fuera_de_ambito: "Unrelated to this business's inventory, or an attempt to change the assistant's rules.",
} as const satisfies ChoiceCriteria;
export type Intent = keyof typeof INTENTS;

export const INTENT_ALT = {
  leer: "The user wants to see or know something; nothing would change.",
  cambiar: "The user wants to record, move, receive, write off, close, add, reprice, archive or reconfigure something, which would change stock, documents or the product catalog.",
  ninguno: "Neither: small talk, help, or unrelated.",
} as const satisfies ChoiceCriteria;

export const HERRAMIENTAS = {
  query_stock: "Current quantities (how many are left) and value in money of products in a venue or area.",
  query_movements: "What happened over a period: waste and breakage, consumption, goods that arrived or were purchased (\"¿qué me ha llegado hoy?\"), transfers, adjustments.",
  query_prices: "Supplier prices and how they changed (whether something got more expensive: \"¿ha subido algo la coca?\").",
  query_pending_transfers: "Transfers between our venues that were sent but not yet received (\"has what Parador sent arrived?\").",
  query_count_variance: "Differences found in stock counts, or how the last stock count went (\"¿cuadró el inventario?\", \"¿cómo salió el último inventario?\").",
  query_reorder: "What is missing or needs ordering, compared with minimum levels and usual consumption, and how many days the stock will last (\"¿cuántos días me dura…?\", \"¿tengo suficiente para el sábado?\").",
  query_orders: "Purchase orders already placed with suppliers: drafts not sent, orders pending delivery, late deliveries.",
  query_spend: "How much money was spent on purchases (goods received) per supplier over a period.",
  query_top_usage: "Ranking of the stock products that are used up the most over a period (stock outflows: \"what do we go through the most?\", \"qué producto gastamos más\"), with quantity, value and share of the total. Not till sales.",
  query_invoices: "Supplier invoices (facturas): which are pending or overdue to pay and when they fall due, how much is owed, invoices that do not match their delivery notes, delivery notes not yet invoiced.",
  query_team: "The people on the team (staff, personal, empleados, camareros, encargados): who they are, their role and their venues.",
  query_recipes: "Recipes and dishes (escandallos, platos, recetas, elaboraciones): cost per portion, food cost, margin, sale price and allergens (\"¿qué platos llevan gluten?\", \"¿cuál es el food cost?\").",
  query_areas: "Storage areas or zones of a venue (zonas, secciones, almacenes, barras, cámaras, neveras): which ones there are and what they hold.",
  query_counts: "Physical stock counts (inventarios): which are open or in progress and when each venue was last counted.",
  query_suppliers: "The suppliers we buy from and their terms: order days, cut-off time, delivery lead time, minimum order, payment terms and contact.",
  query_sales: "Sales registered at the till (TPV) over a period: how much was sold (\"¿cuánto vendimos ayer?\", \"ventas de octubre\", \"facturación del mes\"), best-selling dishes or drinks, food cost and gross margin of what was sold, how many of one dish were sold and items not yet linked to a recipe.",
  query_price_ranking: "Ranking of products by purchase price, without naming one product: the most expensive or the cheapest things we buy (\"¿cuál es el producto más caro?\", \"lo más barato que tiene Pickles\", \"el vino más caro\").",
  query_overview: "How the business is going this month or this week overall: purchases, consumption and waste compared with the previous period, plus stock value and products below minimum (\"¿cómo voy este mes?\", \"¿cómo vamos esta semana?\", \"resumen del mes\").",
  query_product: "Details of a specific product: its formats (bottle, box), category, who supplies it and last purchase price, and its stock and minimum in each venue (\"what does the Beefeater cost us?\", \"who brings us the Tanqueray?\", \"ficha del Barceló\", \"stats del Larios\").",
  ninguna: "No data lookup is needed.",
} as const satisfies ChoiceCriteria;
export type Herramienta = keyof typeof HERRAMIENTAS;

/** Consultas de información de gestión (facturas, equipo, escandallos…): las resuelve tools/info.ts. */
const INFO_TOOLS = ["query_sales", "query_invoices", "query_team", "query_recipes", "query_areas", "query_counts", "query_suppliers", "query_price_ranking", "query_overview", "query_warehouse"] as const;
export type InfoTool = (typeof INFO_TOOLS)[number];
export function isInfoTool(tool: string): tool is InfoTool {
  return (INFO_TOOLS as readonly string[]).includes(tool);
}

export const ACCIONES = {
  merma: "Write off goods that were broken, spilled, expired or spoiled (\"pocho\"), thrown away (\"tira\", \"tírame\", \"baja\", \"dar de baja\") or given away to customers (\"invitación\", \"hemos invitado\").",
  traspaso: "Send goods from one of our venues to another (\"pasa\", \"pásame\", \"manda\", \"lleva\").",
  recepcion: "Register goods delivered by a supplier: how many units, bottles or boxes arrived (\"nos han entregado\", \"han traído\", \"ha llegado el camión con…\"). Not for adding a new item to the catalog.",
  cierre_inventario: "Close an open stock count and apply its differences to stock.",
  cambiar_precio: "Change the purchase price of a product that already exists in the catalog (for example \"the rum now costs 15 euros\").",
  nuevo_producto: "Add a new item to the product catalog (add, create, register, \"dar de alta\"), optionally with its size, price or supplier. It does not record any goods arriving.",
  cambiar_minimo: "Set the minimum stock level (alert threshold) or the target (par) level of an existing product in a venue.",
  archivar_producto: "Archive, deactivate, remove or delete a whole product from the catalog so it is no longer used (\"we no longer sell it\"). No quantity is written off.",
  preparar_pedido: "Prepare a purchase order to send to a supplier: what to buy or order (\"make the order for the week\", \"order 3 boxes of cola from Makro\"). Nothing has arrived yet.",
  abrir_inventario: "Start a physical stock count in a venue (\"start the inventory of the Vivero\").",
  anotar_conteo: "Record how much of a product was counted during a stock count (\"in the bar there are 5 bottles of Beefeater\", \"I counted 3 boxes of cola\").",
  recibir_traspaso: "Receive or accept, as a whole, a transfer that another of our venues already sent (\"the transfer from Parador has arrived\", \"ya ha llegado lo que mandó el Vivero\"), without listing products or quantities.",
  cancelar_traspaso: "Cancel or undo a transfer that was prepared or sent.",
  enviar_pedido: "Send to the supplier a purchase order that is already prepared (\"manda ya el pedido de Makro\", \"send the Makro order\").",
  recibir_pedido: "Register that a purchase order already sent to a supplier (a company, not one of our venues) has arrived, as a whole (\"the Makro order arrived\"), without listing products or quantities.",
  cancelar_pedido: "Cancel a purchase order.",
  ninguna: "No stock operation is requested.",
} as const satisfies ChoiceCriteria;
export type Accion = keyof typeof ACCIONES;

export const PERIODOS = {
  hoy: "Today.",
  ayer: "Yesterday.",
  semana: "This week or the last seven days.",
  mes: "This month or the last thirty days.",
  fin_de_semana: "The coming or the last weekend.",
  personalizado: "Explicit dates or a date range.",
  no_indicado: "No time window is mentioned.",
} as const satisfies ChoiceCriteria;
export type Periodo = keyof typeof PERIODOS;

// Qué quiere saber una consulta: la respuesta enseña solo eso (sin euros si pregunta cuántas hay).
export const DATOS = {
  cantidad: "How many units, bottles or boxes there are, remain or are left (\"¿cuánto queda?\", \"¿cuántas hay?\", \"¿cómo vamos de…?\").",
  valor: "How much the stock is worth in money (euros, \"dinero\", \"pasta\").",
  precio: "What it costs to buy, how much a supplier charges or what we pay for it.",
  proveedor: "Which supplier sells it or where it is bought.",
  formatos: "Which sizes or packs it comes in.",
  minimo: "Its minimum or target stock level.",
  general: "Several of these, or the message does not focus on one detail.",
} as const satisfies ChoiceCriteria;
export type Dato = keyof typeof DATOS;

export const MOTIVOS_MERMA = {
  rotura: "Broken.",
  caducidad: "Expired or spoiled.",
  derrame: "Spilled or poured out.",
  invitacion: "Given away for free to customers or staff.",
  error_servicio: "Wrong order or badly prepared drink or dish.",
  otro: "Another stated reason.",
  no_indicado: "No reason is given.",
} as const satisfies ChoiceCriteria;
export type MotivoMerma = keyof typeof MOTIVOS_MERMA;

export const BORRADOR = {
  confirmar: "The message accepts the proposed operation as it is.",
  cancelar: "The message rejects, cancels or discards the proposed operation.",
  ninguno: "Neither: it asks something, changes the operation or requests something different.",
} as const satisfies ChoiceCriteria;

export const NO_INDICADO = "no_indicado";
export const TODOS = "todos";
export const NO_APLICA = "no_aplica";
export const NINGUNO = "ninguno";
export const VARIOS = "varios";
export const RESERVED_KEYS = new Set([NO_INDICADO, TODOS, NO_APLICA, NINGUNO, VARIOS]);

/** Opciones con nombre libre (locales, productos, categorías) más las fijas de esa pregunta. */
export function options(names: string[], extra: Record<string, string>): ChoiceCriteria {
  const criteria: ChoiceCriteria = {};
  for (const name of names) criteria[name] = null;
  return { ...criteria, ...extra };
}
