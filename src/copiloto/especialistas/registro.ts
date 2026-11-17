// Registro de especialistas del asistente: un manifiesto por dominio de trabajo (almacén, compras, facturas…).
// Es la pieza central de la arquitectura por especialistas (docs/copiloto/ESPECIALISTAS.md): el enrutador, la
// puerta de permisos, las métricas y la evaluación leen de aquí, así que un dominio nuevo se añade en un sitio.
//
// Los requisitos son los mismos que aplica el menú de la app (components/shell/app-shell.tsx): lo que una persona
// no ve en pantalla tampoco se lo ofrece el asistente. Los permisos de los datos los sigue decidiendo la base.
import { hasRole, type SessionContext } from "../domain";

export const ESPECIALISTAS = ["almacen", "compras", "facturas", "escandallos", "ventas", "catalogo", "equipo", "informes", "conversacion"] as const;
export type EspecialistaId = (typeof ESPECIALISTAS)[number];

interface Requisito {
  /** Rol mínimo («manager»: encargados, gerencia y propietario). */
  rol?: "manager";
  /** Hace falta «ve costes»: el especialista trabaja con importes. */
  costes?: boolean;
}

export interface Especialista {
  id: EspecialistaId;
  /** Cómo se nombra en una respuesta («Facturas no está en tu alcance»). */
  nombre: string;
  /** Qué resuelve, en una frase: documentación y, en el futuro, enrutado por descripción. */
  descripcion: string;
  requiere: Requisito;
  /** Qué se responde a quien no cumple el requisito (sin cifras). Los mismos textos que daban las herramientas. */
  sinPermiso?: string;
  /** Frases reales que le corresponden: base del conjunto etiquetado para medir el enrutador. */
  ejemplos: readonly string[];
}

export const REGISTRO: Record<EspecialistaId, Especialista> = {
  almacen: {
    id: "almacen",
    nombre: "Almacén",
    descripcion: "Stock, movimientos, mermas, traspasos entre locales, zonas e inventarios.",
    requiere: {},
    ejemplos: ["¿cuánta tónica queda en el Parador?", "se han roto 2 botellas de Barceló en el Vivero", "¿cuadró el último inventario?"],
  },
  compras: {
    id: "compras",
    nombre: "Compras",
    descripcion: "Pedidos, recepciones, proveedores, precios de compra y gasto.",
    requiere: {},
    ejemplos: ["haz el pedido de la semana", "¿ha subido algo la coca?", "el proveedor de Tónica Schweppes 20 cl es Bebidas Mar Menor"],
  },
  facturas: {
    id: "facturas",
    nombre: "Facturas",
    descripcion: "Facturas de proveedor: pendientes, vencidas, pagos y cuadre con albaranes.",
    requiere: { rol: "manager", costes: true },
    sinPermiso: "Las facturas las ve la dirección (propiedad, administración y encargados) con el permiso «ve costes».",
    ejemplos: ["facturas pendientes de pagar", "¿qué facturas vencen esta semana?"],
  },
  escandallos: {
    id: "escandallos",
    nombre: "Escandallos",
    descripcion: "Recetas, elaboraciones, coste por ración, food cost, alérgenos y PVP de los platos.",
    requiere: {},
    ejemplos: ["¿cuál es el food cost del arroz negro?", "pon el PVP de las croquetas a 9,50"],
  },
  ventas: {
    id: "ventas",
    nombre: "Ventas",
    descripcion: "Ventas del TPV: cuánto se vendió, por día y por plato.",
    requiere: { rol: "manager", costes: true },
    sinPermiso: "Las ventas las ve la dirección (propiedad, administración y encargados) con el permiso «ve costes».",
    ejemplos: ["¿cuánto se vendió ayer?", "ventas de la semana pasada"],
  },
  catalogo: {
    id: "catalogo",
    nombre: "Catálogo",
    descripcion: "Productos: ficha, formatos, mínimos, altas y archivado.",
    requiere: {},
    ejemplos: ["quiero archivar un producto", "la tónica también viene en caja de 12", "¿a cómo nos sale el larios?"],
  },
  equipo: {
    id: "equipo",
    nombre: "Equipo",
    descripcion: "Las personas del equipo, su rol y sus locales.",
    requiere: { rol: "manager" },
    sinPermiso: "El equipo lo ven los encargados y la administración (en Equipo).",
    ejemplos: ["¿quién está en el equipo del Vivero?"],
  },
  informes: {
    id: "informes",
    nombre: "Informes",
    descripcion: "Cómo va el negocio: compras, consumo y mermas frente al periodo anterior.",
    requiere: { costes: true },
    sinPermiso: "Los importes de compra no se ven con tu puesto. Pide a un administrador el permiso «ve costes» si los necesitas.",
    ejemplos: ["¿cómo vamos este mes?"],
  },
  conversacion: {
    id: "conversacion",
    nombre: "Conversación",
    descripcion: "Saludos, ayuda, aclaraciones, avisos y preguntas generales.",
    requiere: {},
    ejemplos: ["gracias", "qué significa trabajar con FIFO en cocina"],
  },
};

/** ¿Puede esta persona usar el especialista? Mismas reglas que el menú de la app. */
export function permitido(especialista: Especialista, ctx: Pick<SessionContext, "role" | "seesCosts">): boolean {
  const { rol, costes } = especialista.requiere;
  if (rol && !hasRole(ctx.role, rol)) return false;
  if (costes && !ctx.seesCosts) return false;
  return true;
}
