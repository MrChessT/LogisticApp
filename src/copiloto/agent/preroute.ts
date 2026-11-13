// Antes de Jev: lo que se resuelve sin preguntarle, en este orden (el primero que contesta gana).
//
//   1. Comandos «/stock agua», «/preparar vivero»            → shortcuts.ts
//   2. Órdenes de oficina: pagar factura, validar salidas,
//      PVP de un plato, condiciones de un proveedor          → office-actions.ts (borrador)
//   3. Respuestas ya escritas: temas que no lleva, ir a una
//      pantalla, consumo a mano, «sí» suelto, datos de ficha
//      de varios productos, cuándo se pidió algo              → fixed-replies.ts
//   4. Temas de gestión dichos claramente (facturas, equipo,
//      escandallos…) y tareas de varios pasos                  → tools/info.ts, shortcuts.ts
//   5. Vía rápida de stock: «¿cuántas cocas quedan?»          → fast-path.ts
//
// Si nada contesta, decide Jev. Las reglas de cada paso evitan quitarle a Jev lo que no es claro: con un
// borrador o una pregunta pendiente, los pasos 4 y 5 no actúan (la respuesta puede ser para eso).
import type { SessionContext } from "../domain";
import { namedLocations } from "../entities/signals";
import type { Retriever } from "../entities/retriever";
import { infoTopicOf } from "../tools/info";
import type { InventoryDataSource } from "../tools/types";
import { fastStockPlan } from "./fast-path";
import { fixedReply } from "./fixed-replies";
import { officeAction } from "./office-actions";
import type { Plan } from "./plans";
import type { Session } from "./session";
import { isShortcut, resolveShortcut, tareaTopicOf } from "./shortcuts";

export interface PrerouteInput {
  ctx: SessionContext;
  session: Session;
  retriever: Retriever;
  source: InventoryDataSource;
  pageLocationId: string | undefined;
  now: Date;
  /** Hay un borrador esperando respuesta. */
  draftPending: boolean;
  /** El mensaje contesta a una aclaración. */
  answeringClarification: boolean;
  /** Vía rápida de stock activada (en los tests se apaga para probar a Jev). */
  fastPath: boolean;
  /**
   * Solo los pasos 4 y 5: para una petición que reescribió la comprensión con IA (no se convierte en
   * una orden de oficina ni en una respuesta escrita; esas se reconocen en lo que dice el usuario).
   */
  onlyQueries?: boolean;
}

export async function preroute(message: string, input: PrerouteInput): Promise<Plan | null> {
  const { ctx, session, retriever, pageLocationId } = input;

  if (!input.onlyQueries && isShortcut(message)) {
    const plan = await resolveShortcut(message, ctx, retriever, pageLocationId);
    if (plan) return plan;
  }

  const office = input.onlyQueries ? null : officeAction(message, ctx, pageLocationId);
  if (office) return office;

  const waiting = input.draftPending || session.clarifies.size > 0;
  const reply = input.onlyQueries ? null : await fixedReply(message, session, ctx, { retriever, source: input.source, now: input.now }, waiting);
  if (reply) {
    // Una respuesta escrita cierra lo que estuviera pendiente de aclarar.
    session.clarifies.clear();
    return { type: "aviso", ...reply };
  }

  if (input.answeringClarification || input.draftPending) return null;

  const named = namedLocations(ctx.locations, message);
  const scope = named.length > 0 ? named.map((l) => l.id) : pageLocationId ? [pageLocationId] : ctx.locations.map((l) => l.id);
  const tarea = tareaTopicOf(message);
  if (tarea) return { type: "tarea", tarea, locationIds: scope };
  const infoTool = infoTopicOf(message);
  if (infoTool) return { type: "info", tool: infoTool, locationIds: scope, locationsDefaulted: named.length === 0 && !pageLocationId, products: [], periodo: "no_indicado" };

  return input.fastPath ? fastStockPlan(message, ctx, retriever) : null;
}
