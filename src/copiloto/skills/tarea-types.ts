// Tipos y piezas comunes de las tareas del asistente (tareas.ts y reponer.ts).
import type { NavigateEvent, TableEvent } from "../contract/index";
import type { SessionContext } from "../domain";
import type { ActionPlan, CatalogPlan, QueryPlan } from "../agent/plans";
import type { InventoryDataSource } from "../tools/types";

export const TAREAS = {
  pedidos: { label: "Preparar pedidos", hint: "Traspasos primero; luego lo que toca pedir hoy, por proveedor" },
  equilibrar: { label: "Equilibrar locales", hint: "Traspasos de donde sobra a donde falta" },
  catalogo: { label: "Revisar catálogo", hint: "Precios, formatos y stock que no cuadran" },
  parte: { label: "Parte de ayer", hint: "Consumo, mermas y alertas por local" },
} as const;
export type TareaId = keyof typeof TAREAS;

/**
 * Lo que se pregunta dentro de una tarea: un problema concreto del catálogo («¿qué productos no tienen precio?»)
 * o el stock parado. Sin foco, la tarea entera.
 */
export type TareaFoco = "sin_precio" | "sin_categoria" | "sin_minimo" | "sin_formatos" | "stock_negativo" | "parado";

export interface TareaPlan {
  type: "tarea";
  tarea: TareaId;
  locationIds: string[];
  foco?: TareaFoco;
}

/** Lo que una tarea deja preparado para un toque: borradores o consultas ya resueltas. */
export interface TareaFollowUp {
  label: string;
  plan: QueryPlan | CatalogPlan | ActionPlan | TareaPlan;
}

export interface TareaResult {
  tarea: TareaId;
  /** Respuesta en una o dos frases (las cifras, ya formateadas). */
  text: string;
  table: TableEvent | null;
  followUps: TareaFollowUp[];
  navigate?: NavigateEvent;
}

export interface TareaInput {
  ctx: SessionContext;
  source: InventoryDataSource;
  locationIds: string[];
  now: Date;
  foco?: TareaFoco;
}

export const MAX_ROWS = 15;
export const MAX_BUTTONS = 4;

export const locationName = (ctx: SessionContext, id: string) => ctx.locations.find((l) => l.id === id)?.name ?? "local";
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
