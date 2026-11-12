// Cola del almacén: salidas a barra o cocina (y devoluciones) apuntadas en la pantalla de almacén que
// esperan a que alguien autorizado las valide (migración 0024). Hasta validarlas el stock no se mueve.
// Solo lectura; validarlas es un borrador aparte («valida las salidas del Parador»).
import type { TableEvent } from "../contract/index";
import type { SessionContext } from "../domain";
import { formatStock } from "../entities/units";

export interface AreaMoveRaw {
  id: string;
  locationId: string;
  kind: "salida" | "devolucion";
  productId: string;
  productName: string;
  /** Cantidad en unidad base. */
  qty: string;
  fromArea: string;
  toArea: string;
  createdBy: string;
  createdAt: string;
}

export interface WarehouseSource {
  /** Movimientos de almacén pendientes de validar en esos locales. */
  areaMoves(locationIds: string[]): Promise<AreaMoveRaw[]>;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** «2 cajas de Coca-Cola 20 cl»: la cantidad como se cuenta ese producto. */
export function moveLabel(move: AreaMoveRaw, ctx: SessionContext): { product: string; qty: string; route: string } {
  const product = ctx.products.find((p) => p.id === move.productId);
  return { product: move.productName, qty: product ? formatStock(move.qty, product) : move.qty, route: `${move.fromArea} → ${move.toArea}` };
}

function whenLabel(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `hace ${hours} h` : `hace ${Math.round(hours / 24)} d`;
}

export interface WarehouseResult {
  text: string;
  table?: TableEvent;
  rows: number;
  /** Botones con frase: validar lo de un local. */
  actions?: Array<{ label: string; say: string }>;
}

export async function warehouseQueue(source: WarehouseSource, ctx: SessionContext, locationIds: string[], now: Date): Promise<WarehouseResult> {
  const moves = (await source.areaMoves(locationIds)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const names = new Map(ctx.locations.map((l) => [l.id, l.name]));
  const where = locationIds.length === 1 ? ` en ${names.get(locationIds[0]!) ?? "el local"}` : "";
  if (moves.length === 0) return { text: `No hay salidas de almacén pendientes de validar${where}.`, rows: 0 };

  const byLocation = new Map<string, number>();
  for (const m of moves) byLocation.set(m.locationId, (byLocation.get(m.locationId) ?? 0) + 1);
  const split = byLocation.size > 1 ? `: ${[...byLocation].map(([id, n]) => `${names.get(id) ?? "local"} ${n}`).join(", ")}` : "";
  const oldest = moves[0]!;
  const text = `${plural(moves.length, "movimiento de almacén pendiente", "movimientos de almacén pendientes")} de validar${where}${split}. El más antiguo, ${whenLabel(oldest.createdAt, now)}. Hasta validarlos el stock no se mueve.`;
  const table: TableEvent = {
    columns: [
      { key: "producto", label: "Producto" },
      { key: "cantidad", label: "Cantidad", align: "right" },
      { key: "ruta", label: "De → a" },
      ...(byLocation.size > 1 ? [{ key: "local", label: "Local" }] : []),
      { key: "quien", label: "Apuntó" },
      { key: "cuando", label: "Cuándo" },
    ],
    rows: moves.slice(0, 20).map((m) => {
      const label = moveLabel(m, ctx);
      return {
        producto: `${label.product}${m.kind === "devolucion" ? " (devolución)" : ""}`,
        cantidad: label.qty,
        ruta: label.route,
        ...(byLocation.size > 1 ? { local: names.get(m.locationId) ?? "" } : {}),
        quien: m.createdBy,
        cuando: whenLabel(m.createdAt, now),
      };
    }),
  };
  const actions = [...byLocation.keys()].slice(0, 4).map((id) => ({ label: byLocation.size > 1 ? `Validar las de ${names.get(id)}` : "Validarlas", say: `valida las salidas de almacén pendientes de ${names.get(id)}` }));
  return { text, table, rows: moves.length, actions };
}
