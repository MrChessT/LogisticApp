// Respuestas ya escritas, sin Jev, en orden de prioridad: lo que el asistente no lleva (personal,
// previsiones) y «olvídalo», ir a una pantalla, el consumo dicho a mano, un «sí» suelto sin nada
// pendiente, la categoría de un producto y cuándo se pidió o llegó por última vez. null: el mensaje
// sigue el camino normal.
import type { SessionContext } from "../domain";
import type { Retriever } from "../entities/retriever";
import type { InventoryDataSource } from "../tools/types";
import { lastTime } from "./last-time";
import { productFact } from "./product-facts";
import type { Session } from "./session";
import { bareAnswer, consumptionByHand, screenHelp, topicReply, type TopicReply } from "./topics";

/** `waiting`: hay un borrador o una pregunta esperando respuesta (entonces un «sí» es para eso). */
export async function fixedReply(
  message: string,
  session: Session,
  ctx: SessionContext,
  deps: { retriever: Retriever; source: InventoryDataSource; now: Date },
  waiting: boolean,
): Promise<TopicReply | null> {
  return (
    topicReply(message) ??
    screenHelp(message, ctx.locations.map((l) => l.name)) ??
    consumptionByHand(message) ??
    (waiting ? null : bareAnswer(message, session.turns.findLast((t) => t.role === "assistant")?.text)) ??
    (await productFact(message, ctx, deps.retriever, deps.source)) ??
    (await lastTime(message, ctx, deps.retriever, deps.source, deps.now))
  );
}
