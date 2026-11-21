import type { ExitKind } from "../../lib/exit-kinds";
import type { BaseUnit } from "../contract/index";
import type { EvalKind, Herramienta, InfoTool } from "../jev/catalog";

// Datos crudos (todas las cifras como cadena decimal; nunca number) -----------------

export type MovementType =
  | "opening" | "purchase" | "consumption" | "waste" | "transfer_out" | "transfer_in" | "count_adjustment" | "manual_adjustment" | "internal_move";

export interface BalanceRaw { locationId: string; productId: string; qty: string; avgCost: string }
export interface AreaBalanceRaw { areaId: string; productId: string; qty: string; avgCost: string }
export interface LocationProductRaw { locationId: string; productId: string; minQty: string; parQty: string }
export interface MovementRaw {
  locationId: string; productId: string; areaId: string | null; type: MovementType;
  qty: string; unitCost: string | null; occurredAt: string;
  /** Solo en mermas: pérdida, invitación, consumo del personal… (null: anterior a los tipos = pérdida). */
  exitKind?: ExitKind | null;
}
export interface PriceRaw { supplierId: string; supplierName: string; packId: string; price: string; recordedAt: string }
export interface TransferRaw {
  id: string; fromLocationId: string; toLocationId: string; status: "draft" | "in_transit" | "received" | "cancelled";
  sentAt: string | null; lines: Array<{ productId: string; qtySent: string; unitCost: string | null }>;
}
export interface CountResultRaw {
  countId: string; locationId: string; closedAt: string; productId: string;
  expectedQty: string; countedQty: string; unitCost: string;
}

export interface DataFilter {
  locationIds: string[];
  productIds?: string[];
  /** ISO, incluido. */
  since?: string;
}

export interface OpenCountRaw {
  id: string;
  locationId: string;
  startedAt: string;
  lines: Array<{ productId: string; qty: string }>;
}

/** Pedido a proveedor con sus líneas (cifras como cadena decimal). */
export interface OrderRaw {
  id: string;
  locationId: string;
  supplierName: string;
  status: "draft" | "sent" | "partial" | "received" | "cancelled";
  createdAt: string;
  sentAt: string | null;
  /** YYYY-MM-DD o null. */
  expectedDate: string | null;
  lines: Array<{ productId: string; packsQty: string; packPrice: string | null; receivedPacks: string; packId?: string; packName?: string }>;
}

/** Recepción contabilizada: lo que se gastó con un proveedor en una fecha. */
/** Una línea de un albarán cerrado: el importe (cantidad × precio del formato) y el producto que compra. */
export interface PurchaseLineRaw {
  receiptId: string;
  locationId: string;
  supplierName: string | null;
  /** YYYY-MM-DD. */
  docDate: string;
  productId: string;
  amount: string;
}

export interface PurchaseRaw {
  receiptId: string;
  locationId: string;
  supplierId: string | null;
  supplierName: string | null;
  /** YYYY-MM-DD. */
  docDate: string;
  total: string;
}

/** Cantidad aún por recibir de pedidos abiertos (borrador, enviado o parcial), en unidad base. */
export interface OpenOrderRaw {
  locationId: string;
  productId: string;
  qtyBase: string;
}

/** Un problema del catálogo o del stock (función catalog_health de la base de datos). */
export interface HealthIssueRaw {
  productId: string;
  productName: string;
  family: string | null;
  locationId: string | null;
  issue: string;
  severity: "error" | "aviso" | "info";
  detail: string;
}

/** Condiciones de pedido de un proveedor (null: no puestas). */
export interface SupplierTermsRaw {
  supplierId: string;
  orderDays: number[] | null;
  orderCutoff: string | null;
  leadTimeHours: number | null;
  minOrder: string | null;
  /** Locales a los que sirve (null: a todos). */
  locationIds: string[] | null;
}

export interface SupplierPriceRaw {
  supplierId: string;
  supplierName: string;
  packId: string;
  lastPrice: string;
  lastPriceAt: string | null;
  /** Fuente de precio (escandallos importados, estimados): vale para valorar, nunca para pedir (0061). */
  priceSource?: boolean;
}

/** Acceso de solo lectura. La implementación real (fase 3) usa el cliente Supabase con el JWT del usuario. */
export interface InventoryDataSource {
  openCount(locationId: string): Promise<OpenCountRaw | null>;
  supplierPrices(packIds: string[]): Promise<SupplierPriceRaw[]>;
  supplierTerms(supplierIds: string[]): Promise<SupplierTermsRaw[]>;
  balances(filter: DataFilter): Promise<BalanceRaw[]>;
  areaBalances(areaId: string, productIds?: string[]): Promise<AreaBalanceRaw[]>;
  locationProducts(filter: DataFilter): Promise<LocationProductRaw[]>;
  movements(filter: DataFilter & { since: string }): Promise<MovementRaw[]>;
  prices(packIds: string[] | null, since: string): Promise<PriceRaw[]>;
  transfers(filter: { locationIds: string[]; status: TransferRaw["status"][] }): Promise<TransferRaw[]>;
  countResults(filter: DataFilter & { since: string }): Promise<CountResultRaw[]>;
  openOrders(filter: { locationIds: string[] }): Promise<OpenOrderRaw[]>;
  orders(filter: { locationIds: string[]; statuses: OrderRaw["status"][] }): Promise<OrderRaw[]>;
  /** Recepciones cerradas desde `since` (YYYY-MM-DD, incluido). */
  purchases(filter: { locationIds: string[]; since: string }): Promise<PurchaseRaw[]>;
  /** Líneas de esas mismas recepciones: para repartir las compras por departamento, familia y día. */
  purchaseLines(filter: { locationIds: string[]; since: string }): Promise<PurchaseLineRaw[]>;
  /** Problemas del catálogo (sin local) y del stock de esos locales. */
  catalogHealth(filter: { locationIds: string[] }): Promise<HealthIssueRaw[]>;
}

// Parámetros y resultados ---------------------------------------------------------

export interface Period {
  from: string; // YYYY-MM-DD (día de negocio)
  to: string;
  label: string;
}

export interface ToolParams {
  locationIds: string[];
  areaId: string | null;
  productIds: string[];
  period: Period | null;
  /** Horizonte de reposición en días (query_reorder). */
  horizonDays: number;
  horizonLabel: string;
  now: Date;
  /** Stock desglosado por espacio («¿qué hay en cada sección?»). */
  byArea?: boolean;
  /** Movimientos repartidos por local («¿en qué local se pierde más?»). */
  byLocation?: boolean;
  /** Gasto de una familia del catálogo («en bebida»): solo las líneas de sus productos. */
  family?: { label: string; productIds: string[] };
  /** Gasto con un proveedor nombrado («en Bebidas del Sur»). */
  supplier?: string;
  /** Movimientos: solo estos tipos («¿cuánta merma…?» → mermas). Sin él, todos menos aperturas y cambios de zona. */
  movementTypes?: MovementType[];
}

/**
 * Tipos de movimiento que nombra el mensaje («merma», «roturas», «compras», «traspasos»…). Vacío si no
 * nombra ninguno.
 */
export function movementTypesIn(message: string): MovementType[] {
  const text = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const types: MovementType[] = [];
  if (/\b(merma|mermas|roto|rotos|rota|rotas|rotura|roturas|tirad|caducad|desperdici)/.test(text)) types.push("waste");
  if (/\b(compra|compras|comprado|recepcion|recepciones|albaran|albaranes|recibid)/.test(text)) types.push("purchase");
  if (/\btraspas/.test(text)) types.push("transfer_out", "transfer_in");
  if (/\b(consumo|consumid|gastad|vendid|ventas)/.test(text)) types.push("consumption");
  if (/\b(ajuste|ajustes|descuadre|descuadres)/.test(text)) types.push("count_adjustment", "manual_adjustment");
  if (/\b(apertura|aperturas|inicial|iniciales)/.test(text)) types.push("opening");
  return types;
}

export interface EvalItem {
  kind: EvalKind;
  /** Datos formateados que ve Jev; las claves coinciden con las rutas del catálogo. */
  data: Record<string, string>;
  /** Clave estable para sugerencias: "stock_bajo:<loc>:<prod>". */
  key: string;
  locationId: string | null;
}

export interface ToolRow {
  [key: string]: string | boolean | null;
}

export interface ToolResult {
  tool: Exclude<Herramienta, "ninguna" | InfoTool>;
  /** Filas ya formateadas para mostrar/redactar (cifras como texto es-ES). */
  rows: ToolRow[];
  /** Totales formateados. */
  totals: Record<string, string>;
  /** Filas totales antes de recortar. */
  count: number;
  truncated: boolean;
  evalItems: EvalItem[];
  baseUnits?: BaseUnit[];
}
