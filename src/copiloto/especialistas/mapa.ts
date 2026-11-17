// Qué especialista atiende cada plan. Los mapas son exhaustivos por tipo: una herramienta, acción, orden de
// oficina o tarea nueva sin especialista no compila. Así el registro no se queda atrás cuando el asistente crece.
import type { AppRoute, Decision } from "../contract/index";
import type { Accion, Herramienta, InfoTool } from "../jev/catalog/criteria";
import type { DocumentPlan, Plan } from "../agent/plans";
import type { TareaId } from "../skills/tareas";
import type { EspecialistaId } from "./registro";

/** Herramientas de Jev y temas de información (tools/info.ts): algunos solo existen como tema («query_warehouse»). */
const POR_HERRAMIENTA: Record<Exclude<Herramienta, "ninguna"> | InfoTool, EspecialistaId> = {
  query_stock: "almacen",
  query_movements: "almacen",
  query_pending_transfers: "almacen",
  query_count_variance: "almacen",
  query_top_usage: "almacen",
  query_areas: "almacen",
  query_counts: "almacen",
  query_warehouse: "almacen",
  query_reorder: "compras",
  query_orders: "compras",
  query_spend: "compras",
  query_prices: "compras",
  query_price_ranking: "compras",
  query_suppliers: "compras",
  query_invoices: "facturas",
  query_recipes: "escandallos",
  query_sales: "ventas",
  query_product: "catalogo",
  query_team: "equipo",
  query_overview: "informes",
};

const POR_ACCION: Record<Exclude<Accion, "ninguna">, EspecialistaId> = {
  merma: "almacen",
  traspaso: "almacen",
  cierre_inventario: "almacen",
  abrir_inventario: "almacen",
  anotar_conteo: "almacen",
  recibir_traspaso: "almacen",
  cancelar_traspaso: "almacen",
  recepcion: "compras",
  preparar_pedido: "compras",
  enviar_pedido: "compras",
  recibir_pedido: "compras",
  cancelar_pedido: "compras",
  cambiar_precio: "compras",
  nuevo_producto: "catalogo",
  cambiar_minimo: "catalogo",
  archivar_producto: "catalogo",
};

/** Órdenes de documento: las de Jev (traspasos, pedidos) y las de oficina (office-actions.ts). */
const POR_DOCUMENTO: Record<DocumentPlan["accion"], EspecialistaId> = {
  recibir_traspaso: "almacen",
  cancelar_traspaso: "almacen",
  enviar_pedido: "compras",
  recibir_pedido: "compras",
  cancelar_pedido: "compras",
  validar_salidas: "almacen",
  salida_almacen: "almacen",
  crear_zona: "almacen",
  condiciones_proveedor: "compras",
  asociar_proveedor: "compras",
  pagar_factura: "facturas",
  precio_venta: "escandallos",
  crear_escandallo: "escandallos",
  ficha_producto: "catalogo",
  formato_producto: "catalogo",
};

const POR_TAREA: Record<TareaId, EspecialistaId> = {
  pedidos: "compras",
  equilibrar: "almacen",
  catalogo: "catalogo",
  parte: "almacen",
};

/** Avisos y respuestas ya escritas: el dominio es el de la pantalla a la que enlazan. */
const POR_RUTA: Record<AppRoute, EspecialistaId> = {
  "/": "conversacion",
  "/stock": "almacen",
  "/traspasos": "almacen",
  "/inventarios": "almacen",
  "/mermas": "almacen",
  "/almacen": "almacen",
  "/zonas": "almacen",
  "/pedidos": "compras",
  "/recepciones": "compras",
  "/proveedores": "compras",
  "/facturas": "facturas",
  "/escandallos": "escandallos",
  "/ventas": "ventas",
  "/productos": "catalogo",
  "/equipo": "equipo",
  "/informes": "informes",
};

const has = <K extends string>(map: Record<K, EspecialistaId>, key: string): key is K => Object.hasOwn(map, key);

/** Una aclaración aún no tiene herramienta: vale la acción o la herramienta que Jev ya eligió. */
function porDecision(decisions: readonly Decision[]): EspecialistaId | null {
  const accion = decisions.find((d) => d.id === "tipo_accion")?.value;
  if (accion && has(POR_ACCION, accion)) return POR_ACCION[accion];
  const herramienta = decisions.find((d) => d.id === "herramienta")?.value;
  if (herramienta && has(POR_HERRAMIENTA, herramienta)) return POR_HERRAMIENTA[herramienta];
  return null;
}

export function especialistaDe(plan: Plan, decisions: readonly Decision[] = []): EspecialistaId {
  switch (plan.type) {
    case "consultar":
    case "info":
      return POR_HERRAMIENTA[plan.tool];
    case "accion":
    case "catalogo":
      return POR_ACCION[plan.accion];
    case "documento":
      return POR_DOCUMENTO[plan.accion];
    case "tarea":
      return POR_TAREA[plan.tarea];
    case "aviso":
      return plan.route ? POR_RUTA[plan.route] : "conversacion";
    case "clarify":
      return porDecision(decisions) ?? "conversacion";
    default:
      return "conversacion";
  }
}
