// Piezas comunes de las comprobaciones de un borrador: una comprobación que cabe en el esquema y listas de
// nombres acotadas.
import type { DraftCheck } from "../contract/index";
import { MAX_CHECK_DETAIL } from "./schemas";

export function check(id: string, label: string, status: DraftCheck["status"], detail: string, p: number | null = null): DraftCheck {
  const fits = detail.length <= MAX_CHECK_DETAIL ? detail : `${detail.slice(0, MAX_CHECK_DETAIL - 1).trimEnd()}…`;
  return { id, label, status, detail: fits, probability: p };
}

/**
 * Lista de nombres para un aviso: los que quepan y «y N más». Un pedido de un local grande puede dejar
 * fuera cientos de productos y el aviso tiene un tope de longitud.
 */
export function nameList(names: string[], budget = 240): string {
  const shown: string[] = [];
  let used = 0;
  for (const name of names) {
    if (shown.length > 0 && used + name.length + 2 > budget) break;
    shown.push(name);
    used += name.length + 2;
  }
  const rest = names.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} y ${rest} más` : shown.join(", ");
}
