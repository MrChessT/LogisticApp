// Planes: lo que el asistente va a hacer con un mensaje, ya decidido (por Jev y sus umbrales, por un
// atajo o por la respuesta a una aclaración). Ejecutarlos es cosa de loop.ts.
import type { AppRoute, ClarifyField, GateOutcome, NavigateEvent } from "../contract/index";
import type { Product } from "../domain";
import type { Accion, Dato, InfoTool, Intent, MotivoMerma, Periodo } from "../jev/catalog";
import type { TareaPlan } from "../skills/tareas";
import type { ToolName } from "../tools/tools";

export interface ClarifyPlan {
  type: "clarify";
  field: ClarifyField;
  question: string;
  options: Array<{ id: string; label: string; probability: number | null }>;
  segmentIndex?: number;
  /** La pregunta pide repetir la orden entera: lo que se escriba es un mensaje nuevo, no un añadido. */
  restart?: boolean;
}

export interface ResolvedProduct {
  product: Product;
  segmentIndex: number;
  amount: string | null;
  unit: string | null;
  price: string | null;
  quantityOutcome: GateOutcome | null;
  /** Unidades sueltas que se suman a las cajas («3 cajas y 5 sueltas»). */
  loose?: string | null;
  looseUnit?: string | null;
  /** "confirmar": Jev lo eligió sin llegar al umbral de actuar; el borrador lo marca para revisar. */
  productOutcome?: GateOutcome;
}

export interface QueryPlan {
  type: "consultar";
  tool: ToolName;
  locationIds: string[];
  locationsDefaulted: boolean;
  areaId: string | null;
  products: ResolvedProduct[];
  periodo: Periodo;
  /** Lo heredado del mensaje anterior, para decírselo al usuario ("Barceló", "Parador"…). */
  inherited?: string[];
  /** Qué quiere saber (cantidad, precio, valor…): la respuesta enseña solo eso. Sin él, todo. */
  dato?: Dato;
  /** La consulta es de una familia entera del catálogo («Ron»): el titular la nombra. */
  familia?: string;
}

/** Información de gestión (facturas, equipo, escandallos, zonas, inventarios, proveedores): tools/info.ts. */
export interface InfoPlan {
  type: "info";
  tool: InfoTool;
  locationIds: string[];
  locationsDefaulted: boolean;
  products: ResolvedProduct[];
  periodo: Periodo;
}

export interface ActionPlan {
  type: "accion";
  accion: Exclude<Accion, "ninguna" | CatalogAccion | DocumentAccion>;
  locationId: string;
  locationOutcome: GateOutcome;
  toLocationId: string | null;
  toLocationOutcome: GateOutcome;
  areaId: string | null;
  products: ResolvedProduct[];
  motivo: MotivoMerma;
  ambiguous: number;
  /** Jev veía que faltaba algo aunque cada dato estaba claro: el borrador lo avisa. */
  reviewAll?: boolean;
}

/** Operaciones sobre el catálogo (no mueven stock). */
export const CATALOG_ACCIONES = ["cambiar_precio", "nuevo_producto", "cambiar_minimo", "archivar_producto", "preparar_pedido"] as const;
export type CatalogAccion = (typeof CATALOG_ACCIONES)[number];

export interface CatalogPlan {
  type: "catalogo";
  accion: CatalogAccion;
  /** Local: obligatorio para el mínimo; opcional en el alta (se activa el producto en él). */
  locationId: string | null;
  locationOutcome: GateOutcome;
  /** Producto existente al que se refiere (precio, mínimo, archivar). Vacío en el alta. */
  products: ResolvedProduct[];
  /** Periodo que debe cubrir un pedido ("para el finde", "de la semana"). */
  periodo?: Periodo;
}

/** Operaciones sobre traspasos y pedidos que ya existen. */
export const DOCUMENT_ACCIONES = ["recibir_traspaso", "cancelar_traspaso", "enviar_pedido", "recibir_pedido", "cancelar_pedido"] as const;
export type DocumentAccion = (typeof DOCUMENT_ACCIONES)[number];

/** Operaciones de documento que se reconocen sin Jev (office-actions.ts): no están en su catálogo. */
const OFFICE_ACCIONES = ["pagar_factura", "validar_salidas", "precio_venta", "condiciones_proveedor", "salida_almacen", "ficha_producto", "crear_zona", "formato_producto", "crear_escandallo"] as const;
type OfficeAccion = (typeof OFFICE_ACCIONES)[number];

/**
 * ¿Hace falta que Jev compruebe el borrador? No en las órdenes de oficina: se reconocen con reglas fijas
 * sobre lo que dice el usuario y el documento sale de la base de datos (pedirle la coherencia solo
 * añadía medio segundo y algún «revisa» sin motivo).
 */
export function needsCoherenceCheck(plan: Plan): boolean {
  return !(plan.type === "documento" && (OFFICE_ACCIONES as readonly string[]).includes(plan.accion));
}

export interface DocumentPlan {
  type: "documento";
  accion: DocumentAccion | OfficeAccion;
  /** Locales donde buscar el documento (el nombrado o, si no, todos los del usuario). */
  locationIds: string[];
  /** Traspasos: de dónde salió y a dónde llega, si la frase lo dice («lo que mandó Pickles al Parador»). */
  fromLocationId?: string;
  toLocationId?: string;
}

/** Respuesta a un borrador pendiente desde el chat («sí, adelante», «cancélalo»). */
interface DraftAnswerPlan {
  type: "borrador";
  action: "confirmar" | "cancelar";
  draftId: string;
}

export type Plan =
  | TareaPlan
  | ClarifyPlan
  | DraftAnswerPlan
  | CatalogPlan
  | DocumentPlan
  | QueryPlan
  | InfoPlan
  | ActionPlan
  | { type: "conversar" }
  | { type: "fuera_de_ambito" }
  | { type: "bloqueado" }
  | AvisoPlan;

/**
 * Respuesta ya escrita: lo que el asistente no lleva (personal, previsiones), lo que no se registra a
 * mano (consumo), ir a una pantalla o un dato del catálogo que no necesita a Jev.
 */
export interface AvisoPlan {
  type: "aviso";
  text: string;
  route?: AppRoute;
  filters?: NavigateEvent["filters"];
  /** Se pidió ir a la pantalla: el panel la abre (además de dejar el enlace). */
  go?: boolean;
  /** Botones que envían una frase ya completa, como si la escribiera el usuario. */
  actions?: Array<{ label: string; say: string }>;
}

/** Intención de un plan resuelto sin Jev (atajos, temas, vía rápida). */
export function shortcutIntent(plan: Plan): Intent {
  return plan.type === "conversar" || plan.type === "aviso"
    ? "conversar"
    : plan.type === "catalogo" || plan.type === "accion" || plan.type === "documento"
      ? "proponer_accion"
      : plan.type === "tarea"
        ? "pedir_sugerencias"
        : "consultar";
}
