import Decimal from "decimal.js";
import { countingPacks, type PackRow } from "@/lib/packs";
import { countLayout, countTotal, formatStock, packNoun, type CountLayout, type CountingPacks, type UnitDimension } from "@/lib/units";

// Pantalla de almacén (migraciones 0023-0024): tipos, cantidades y la cola de envíos sin cobertura.
// La base de datos decide quién puede apuntar y validar; aquí solo se prepara y se explica.

export type Area = { id: string; name: string; kind: "almacen" | "servicio" };
export type WarehouseContext = {
  kiosk: boolean;
  location_id: string | null;
  locations: Array<{ id: string; name: string }>;
  org_name: string | null;
  areas: Area[];
  can_validate: boolean;
  has_pin: boolean;
  pending: number;
  oldest_pending: string | null;
};
type CatalogPack = { id: string; name: string; qty: string; count: boolean; purchase: boolean; barcode: string | null };
export type CatalogItem = {
  id: string;
  name: string;
  dimension: UnitDimension;
  base_unit: string;
  family: string | null;
  uses: number;
  barcode_hit: boolean;
  stock: string;
  packs: CatalogPack[];
};
export type MoveKind = "salida" | "devolucion";
export type MoveRow = {
  id: string;
  kind: MoveKind;
  status: "pending" | "validated" | "rejected" | "cancelled";
  qty: string;
  input: { boxes?: string; loose?: string } | null;
  note: string | null;
  created_at: string;
  decided_at: string | null;
  decision_note: string | null;
  original: { qty?: string } | null;
  product_id: string;
  product_name: string;
  dimension: UnitDimension;
  base_unit: string;
  from_area_id: string;
  from_area: string;
  to_area_id: string;
  to_area: string;
  created_by_name: string;
  mine: boolean;
  decided_by_name: string | null;
  packs: Array<{ name: string; qty: string; count: boolean; purchase: boolean }> | null;
};

/** Formatos del producto con la forma de countingPacks (cajas + sueltas). */
function packsOf(dimension: UnitDimension, packs: Array<{ name: string; qty: string; count: boolean; purchase: boolean }> | null): CountingPacks {
  const rows: PackRow[] = (packs ?? []).map((k) => ({ name: k.name, qty_base: k.qty, is_count_default: k.count, is_purchase_default: k.purchase, active: true }));
  return countingPacks(dimension, rows);
}

/** «2 cajas + 3 botellas», «1,5 kg»… */
export function describeQty(qty: Decimal.Value, dimension: UnitDimension, packs: Array<{ name: string; qty: string; count: boolean; purchase: boolean }> | null): string {
  return formatStock(qty, packsOf(dimension, packs));
}

/** Cómo se cuenta este producto en el almacén: cajas (si las hay) y sueltas. */
export function layoutOf(dimension: UnitDimension, packs: Array<{ name: string; qty: string; count: boolean; purchase: boolean }> | null): CountLayout {
  return countLayout(packsOf(dimension, packs));
}

/** Lo que se tecleó, como se dice: «1 caja + 2 botellas». */
export function inputText(layout: CountLayout, input: { boxes?: string; loose?: string } | null): string | null {
  if (!input) return null;
  const parts: string[] = [];
  const boxes = input.boxes?.trim();
  const loose = input.loose?.trim();
  if (boxes && Number(boxes.replace(",", ".")) > 0 && layout.box) parts.push(`${boxes} ${packNoun(layout.box.name, Number(boxes.replace(",", ".")))}`);
  if (loose && Number(loose.replace(",", ".")) > 0) parts.push(`${loose} ${Number(loose.replace(",", ".")) === 1 ? packNoun(layout.unit.name, 1) : layout.unit.plural}`);
  return parts.length ? parts.join(" + ") : null;
}

/** Cajas y sueltas tecleadas → unidad base. null si no hay nada o algo no es válido. */
export function qtyFromInput(dimension: UnitDimension, packs: Array<{ name: string; qty: string; count: boolean; purchase: boolean }> | null, boxes: string, loose: string): Decimal | null {
  const layout = countLayout(packsOf(dimension, packs));
  const parse = (v: string) => {
    const t = v.trim().replace(",", ".");
    if (!t) return null;
    if (!/^\d+(\.\d+)?$/.test(t)) return undefined;
    return new Decimal(t);
  };
  const b = parse(boxes);
  const l = parse(loose);
  if (b === undefined || l === undefined) return null;
  const total = countTotal(layout, layout.box ? b : null, l ?? (layout.box ? null : b));
  return total && total.gt(0) ? total : null;
}

const MESSAGES: Record<string, string> = {
  forbidden: "No tienes permiso para esto en este local.",
  invalid_area: "Revisa de dónde sale y a dónde va.",
  invalid_quantity: "Revisa la cantidad.",
  invalid_product: "Ese producto ya no está en el catálogo.",
  cannot_cancel: "Ya no se puede deshacer: pídele a quien valida que la rechace.",
  pin_format: "El PIN son 6 cifras.",
  pin_weak: "Ese PIN es demasiado fácil: evita 111111 o 123456.",
};

export function warehouseError(error: { message?: string } | null | undefined, fallback = "No se pudo guardar."): string {
  const code = Object.keys(MESSAGES).find((k) => new RegExp(`(^|[^a-z_])${k}($|[^a-z_])`).test(error?.message ?? ""));
  return code ? MESSAGES[code]! : fallback;
}

/** Sin conexión (o la red falló): se reintenta. Un error de la base de datos no se reintenta. */
export function isNetworkError(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  return !error.code && /fetch|network|load failed|timeout/i.test(error.message ?? "");
}

// Cola de envíos pendientes en este dispositivo ------------------------------------------------------

export type QueuedMove = {
  clientRef: string;
  locationId: string;
  fromArea: string;
  toArea: string;
  productId: string;
  qty: string;
  input: { boxes?: string; loose?: string };
  kind: MoveKind;
  label: string;
  queuedAt: string;
};

type Store = Pick<Storage, "getItem" | "setItem">;
const KEY = "logisticapp.almacen.cola";

function storage(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readQueue(store: Store | null = storage()): QueuedMove[] {
  try {
    const raw = store?.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as QueuedMove[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeQueue(list: QueuedMove[], store: Store | null = storage()): void {
  try {
    store?.setItem(KEY, JSON.stringify(list));
  } catch {
    // Sin almacenamiento (modo privado): la salida se intenta enviar igualmente.
  }
}

export function enqueue(move: QueuedMove, store: Store | null = storage()): QueuedMove[] {
  const list = readQueue(store).filter((m) => m.clientRef !== move.clientRef);
  list.push(move);
  writeQueue(list, store);
  return list;
}

export function dequeue(clientRef: string, store: Store | null = storage()): QueuedMove[] {
  const list = readQueue(store).filter((m) => m.clientRef !== clientRef);
  writeQueue(list, store);
  return list;
}

/**
 * Envía lo guardado en el dispositivo. `send` devuelve null si fue bien o el error. Los fallos de red se
 * quedan para el siguiente intento; los rechazos de la base de datos se descartan y se devuelven.
 */
export async function flushQueue(
  send: (move: QueuedMove) => Promise<{ message?: string; code?: string } | null>,
  store: Store | null = storage(),
): Promise<{ sent: number; failed: Array<{ move: QueuedMove; message: string }>; left: number }> {
  let sent = 0;
  const failed: Array<{ move: QueuedMove; message: string }> = [];
  for (const move of readQueue(store)) {
    const error = await send(move);
    if (!error) {
      dequeue(move.clientRef, store);
      sent += 1;
    } else if (isNetworkError(error)) {
      break;
    } else {
      dequeue(move.clientRef, store);
      failed.push({ move, message: warehouseError(error) });
    }
  }
  return { sent, failed, left: readQueue(store).length };
}
