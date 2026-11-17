// Qué especialista atiende cada plan. Los mapas son exhaustivos por tipo: una herramienta, acción, orden de
// oficina o tarea nueva sin especialista no compila. Así el registro no se queda atrás cuando el asistente crece.
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

export function especialistaDe(plan: Plan): EspecialistaId {
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
    default:
      return "conversacion";
  }
}
