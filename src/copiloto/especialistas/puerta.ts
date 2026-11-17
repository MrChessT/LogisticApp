// Puerta de permisos por especialista: antes de ejecutar una lectura (consulta, información o tarea), se comprueba
// que la persona pueda usar el especialista que la atiende. Si no, un aviso sin cifras. Los borradores no pasan por
// aquí: cada constructor comprueba su permiso con un mensaje propio de la acción («las facturas las llevan…»).
import type { Decision } from "../contract/index";
import type { SessionContext } from "../domain";
import type { AvisoPlan, Plan } from "../agent/plans";
import { fueraDeTusCuentas } from "./cuentas";
import { especialistaDe } from "./mapa";
import { permitido, REGISTRO } from "./registro";

const LECTURAS = new Set<Plan["type"]>(["consultar", "info", "tarea"]);

export function fueraDeAlcance(plan: Plan, ctx: Pick<SessionContext, "role" | "seesCosts" | "cuentas" | "palabrasOcultas">, message = "", decisions: Decision[] = []): AvisoPlan | null {
  // Una pregunta por el producto también: si nombra algo de otra cuenta, mejor decirlo que ofrecer lo que no es.
  if (!LECTURAS.has(plan.type)) return fueraDeTusCuentas(plan, message, ctx, decisions);
  const especialista = REGISTRO[especialistaDe(plan)];
  if (permitido(especialista, ctx)) return fueraDeTusCuentas(plan, message, ctx, decisions);
  return { type: "aviso", text: especialista.sinPermiso ?? `${especialista.nombre} no está en tu alcance. Si lo necesitas, pídeselo a quien administra el equipo.` };
}
