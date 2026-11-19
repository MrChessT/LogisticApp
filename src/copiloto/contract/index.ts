// Tipos y esquemas de CONTRACT.md. Cualquier cambio aquí debe reflejarse en CONTRACT.md.
import { z } from "zod";
import type { ExitKind } from "../../lib/exit-kinds";

export const CONTRACT_VERSION = "1.0.0-draft";

export const DecimalString = z.string().regex(/^-?\d+(\.\d+)?$/, "cantidad decimal no válida");
const Uuid = z.uuid();

export const ROLES = ["owner", "admin", "manager", "staff"] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

const APP_ROUTES = [
  "/", "/productos", "/stock", "/pedidos", "/recepciones", "/traspasos", "/inventarios", "/mermas", "/informes",
  "/almacen", "/proveedores", "/escandallos", "/ventas", "/facturas", "/equipo", "/zonas",
] as const;
export const AppRoute = z.enum(APP_ROUTES);
export type AppRoute = z.infer<typeof AppRoute>;

export type BaseUnit = "g" | "ml" | "ud";
export type GateOutcome = "actuar" | "confirmar" | "preguntar";

export interface Decision {
  id: string;
  label: string;
  value: string;
  valueLabel: string;
  probability: number;
  confidence: number | null;
  gate: GateOutcome;
}

// POST /chat ---------------------------------------------------------------

/** Importe o cantidad como cadena decimal con punto (sin coma flotante). */
const DecimalText = z.string().regex(/^-?\d{1,9}(\.\d{1,6})?$/);

export const ChatDocument = z.object({
  kind: z.enum(["factura", "albaran", "ventas"]),
  file: z.string().max(200),
  number: z.string().max(60).nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  /** Proveedor reconocido (factura, albarán) o centro de coste del TPV (ventas). */
  party: z.string().max(160).nullable(),
  base: DecimalText.nullable(),
  vat: DecimalText.nullable(),
  total: DecimalText.nullable(),
  status: z.enum(["cuadra", "revisar", "sin_lineas"]).nullable(),
  lines: z
    .array(z.object({ code: z.string().max(40).nullable(), description: z.string().max(200), qty: DecimalText, unit: z.string().max(60).nullable(), price: DecimalText.nullable(), amount: DecimalText }))
    .max(1500),
});
export type ChatDocument = z.infer<typeof ChatDocument>;

export const ChatRequest = z.object({
  orgId: Uuid,
  sessionId: Uuid,
  message: z.string().trim().min(1).max(1000).transform((m) => m.normalize("NFC")),
  page: AppRoute,
  pageContext: z
    .object({ locationId: Uuid.optional(), areaId: Uuid.optional() })
    .optional(),
  clarification: z
    .object({
      clarifyId: z.string().min(1).max(64),
      optionId: z.string().min(1).max(200),
      freeText: z.string().max(300).optional(),
      /** Qué se preguntó: si la sesión se perdiera, aún se sabe cómo leer lo escrito. */
      field: z.string().max(40).optional(),
    })
    .optional(),
  /**
   * Lo leído del último archivo que se dio al chat (factura, albarán o exportación del TPV), tal como lo leyó el
   * navegador: para preguntar por él («¿a cuánto cobra los limones esta factura?») o cargar las ventas. No se guarda.
   */
  document: ChatDocument.optional(),
  /** El otro documento leído antes (una factura si el último es un albarán, o al revés): para cuadrarlos. */
  otherDocument: ChatDocument.optional(),
  /** Botón de seguimiento de una respuesta anterior (se ejecuta sin volver a llamar a Jev). */
  followUpId: z.string().min(1).max(64).optional(),
  /** Miniformulario enviado: la operación y lo elegido en cada campo (el servidor lo valida todo). */
  /** Quién manda el mensaje: las baterías se marcan para que no cuenten como uso real en los indicadores (0062). */
  origen: z.enum(["panel", "bateria"]).optional(),
  form: z
    .object({
      accion: z.enum(["merma", "traspaso", "recepcion"]),
      values: z.object({
        local: z.string().trim().max(120).optional(),
        destino: z.string().trim().max(120).optional(),
        producto: z.string().trim().max(200).optional(),
        cantidad: z.string().trim().max(60).optional(),
        motivo: z.string().trim().max(40).optional(),
      }),
    })
    .optional(),
});
export type ChatRequest = z.infer<typeof ChatRequest>;

/** Botones para seguir desde una respuesta: «Precios», «Consumo del mes», «Ficha»… */
export interface ActionsEvent {
  actions: Array<{ id: string; label: string }>;
}

export interface DecisionEvent {
  messageId: string;
  intent: Decision;
  decisions: Decision[];
  shortcut: boolean;
  /** Especialista que atiende el mensaje (especialistas/registro.ts): para medir el enrutado y para el panel. */
  especialista: string;
}

interface TextEvent {
  delta: string;
  /** true: descarta el texto recibido hasta ahora (el verificador lo ha rechazado). */
  reset?: boolean;
}

interface NavigateFilters {
  locationId?: string;
  areaId?: string;
  productId?: string;
  status?: string;
  from?: string;
  to?: string;
  q?: string;
  /** Vista de /informes: resumen, consumo, mermas, stock, precios, reposicion, desvios. */
  view?: AnalyticsView;
  /** Días del periodo en /informes (7, 30 o 90). */
  days?: number;
}

export interface NavigateEvent {
  route: AppRoute;
  filters: NavigateFilters;
  auto: boolean;
}

export type ClarifyField =
  | "documento"
  | "intent"
  | "local"
  | "espacio"
  | "producto"
  | "cantidad"
  /** Precio nuevo de un producto («a 1,50»): no es una cantidad. */
  | "precio"
  | "tipo_accion"
  | "local_destino"
  | "herramienta"
  | "proveedor"
  | "formato"
  | "duplicado"
  | "sentido"
  /** Nombre de un producto nuevo: lo escrito ES la respuesta (no un mensaje nuevo). */
  | "nombre"
  | "borrador";

/** Un campo del miniformulario: lo ya entendido viene en `value`. */
export interface FormField {
  key: "local" | "destino" | "producto" | "cantidad" | "motivo";
  label: string;
  /** select: elegir de `options`; product: escribir con sugerencias del catálogo; text: libre. */
  kind: "select" | "product" | "text";
  options?: Array<{ id: string; label: string }>;
  value?: string;
  required: boolean;
  placeholder?: string;
}

/**
 * Miniformulario: la operación está clara pero faltan varios datos. En vez de preguntarlos de uno en uno
 * («¿En qué local?», «¿Qué producto y qué cantidad?»), se piden juntos, con lo entendido ya puesto.
 */
export interface FormEvent {
  formId: string;
  title: string;
  accion: "merma" | "traspaso" | "recepcion";
  fields: FormField[];
}

export interface ClarifyEvent {
  clarifyId: string;
  question: string;
  field: ClarifyField;
  options: Array<{ id: string; label: string; probability: number | null }>;
  allowFreeText: boolean;
}

type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "rate_limited"
  | "invalid_request"
  | "jev_unavailable"
  | "data_unavailable"
  | "internal";

/** Un borrador anterior se ha confirmado o descartado desde el chat: la tarjeta deja de ofrecer el botón. */
export interface ResolvedEvent {
  draftId: string;
  status: "confirmado" | "descartado";
  message: string;
}

export interface ErrorEvent {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

/** Resultado de una consulta con varias filas: el chat lo pinta como tabla (el texto queda de titular). */
export interface TableEvent {
  columns: Array<{ key: string; label: string; align?: "left" | "right" }>;
  rows: Array<Record<string, string>>;
  /** Filas que marcar (bajo mínimo, con retraso…), por índice. */
  flagged?: number[];
  /** Filas que no caben y se ven en la pantalla enlazada. */
  more?: number;
}

export interface DoneEvent {
  messageId: string;
  text: string;
  textSource: "llm" | "plantilla";
  latencyMs: number;
  /** El texto va aunque haya borrador: lo dice todo (varios borradores y las partes que no se pudieron preparar). */
  showText?: boolean;
}

// Borradores -----------------------------------------------------------------

interface QuantityInput {
  amount: string;
  unit: string;
  packId?: string;
}

/**
 * Comprobación visible en el borrador: qué se ha verificado y con qué resultado.
 * ok: todo bien · aviso: conviene mirarlo · revisar: el usuario debe marcar «lo he revisado» para confirmar.
 */
export interface DraftCheck {
  id: string;
  label: string;
  status: "ok" | "aviso" | "revisar";
  detail: string;
  /** Probabilidad de Jev asociada (null si es una regla del código). */
  probability: number | null;
}

export const CATALOG_KINDS = ["precio", "producto_nuevo", "minimo", "archivar"] as const;
type CatalogKind = (typeof CATALOG_KINDS)[number];

interface DraftBase {
  draftId: string;
  kind: "merma" | "traspaso" | "recepcion" | "cierre_inventario" | "pedido" | "documento" | "conteo" | CatalogKind;
  title: string;
  requiredRole: Role;
  canConfirm: boolean;
  coherence: number;
  warnings: string[];
  editable: string[];
  expiresAt: string;
  checks?: DraftCheck[];
  /** El usuario ha marcado «lo he revisado» (obligatorio si hay comprobaciones en «revisar»). */
  acknowledged?: boolean;
}

export interface WasteDraft extends DraftBase {
  kind: "merma";
  locationId: string;
  locationName: string;
  areaId: string | null;
  areaName: string | null;
  productId: string;
  productName: string;
  qtyBase: string;
  baseUnit: BaseUnit;
  input: QuantityInput;
  reason: string | null;
  /** Tipo de salida: pérdida, invitación, consumo del personal… */
  exitKind: ExitKind;
}

export interface TransferDraft extends DraftBase {
  kind: "traspaso";
  fromLocationId: string;
  fromLocationName: string;
  toLocationId: string;
  toLocationName: string;
  lines: Array<{ productId: string; productName: string; qtyBase: string; baseUnit: BaseUnit; input: QuantityInput }>;
  send: boolean;
  note: string | null;
}

export interface ReceiptDraft extends DraftBase {
  kind: "recepcion";
  locationId: string;
  locationName: string;
  supplierId: string | null;
  supplierName: string | null;
  docNumber: string | null;
  docDate: string;
  lines: Array<{
    packId: string;
    packName: string;
    productId: string;
    productName: string;
    packsQty: string;
    packPrice: string | null;
    priceSource: "ultimo_precio" | "usuario" | null;
  }>;
}

export interface CountCloseDraft extends DraftBase {
  kind: "cierre_inventario";
  countId: string;
  locationId: string;
  locationName: string;
  zeroUncounted: boolean;
  /** Las diferencias negativas se registran como consumo (no como ajuste). */
  asConsumption: boolean;
  preview: {
    countedProducts: number;
    adjustments: Array<{
      productId: string;
      productName: string;
      expected: string;
      counted: string;
      diff: string;
      baseUnit: BaseUnit;
      diffValue: string;
      /** Como se cuenta en barra («12 botellas», «2 cajas + 5 ud»), para mostrar. */
      expectedText?: string;
      countedText?: string;
      diffText?: string;
    }>;
    totalDiffValue: string;
  };
}

/** Cambio del último precio de compra de un formato con un proveedor. */
export interface PriceDraft extends DraftBase {
  kind: "precio";
  productId: string;
  productName: string;
  packId: string;
  packName: string;
  /** Contenido del formato en unidad base, para recalcular el coste unitario si se edita el precio. */
  packQtyBase: string;
  baseUnit: BaseUnit;
  supplierId: string;
  supplierName: string;
  oldPrice: string | null;
  newPrice: string;
  /** Coste por unidad base con el precio nuevo ("0,02 €/ml"), solo para mostrar. */
  unitCost: string;
}

/** Alta de un producto nuevo con, opcionalmente, su formato de compra, precio y locales. */
export interface NewProductDraft extends DraftBase {
  kind: "producto_nuevo";
  name: string;
  dimension: "mass" | "volume" | "count";
  baseUnit: BaseUnit;
  categoryId: string | null;
  categoryName: string | null;
  packName: string | null;
  packQtyBase: string | null;
  supplierId: string | null;
  supplierName: string | null;
  price: string | null;
  locationIds: string[];
  locationNames: string[];
}

/** Mínimo (alerta) o cantidad objetivo de un producto en un local. */
export interface MinimumDraft extends DraftBase {
  kind: "minimo";
  locationId: string;
  locationName: string;
  productId: string;
  productName: string;
  field: "min_qty" | "par_qty";
  oldValue: string | null;
  newValue: string;
  baseUnit: BaseUnit;
  input: QuantityInput;
}

/** Archivar un producto: deja de aparecer en la operativa; conserva historial. */
export interface ArchiveDraft extends DraftBase {
  kind: "archivar";
  productId: string;
  productName: string;
  stockQty: string;
  baseUnit: BaseUnit;
}

type CatalogDraft = PriceDraft | NewProductDraft | MinimumDraft | ArchiveDraft;

/** Pedidos a proveedor (uno por proveedor) que se crean en borrador al confirmar. */
export interface OrderDraft extends DraftBase {
  kind: "pedido";
  locationId: string;
  locationName: string;
  /** Periodo que cubre: "la próxima semana", "el fin de semana"… */
  horizonLabel: string;
  orders: Array<{
    supplierId: string;
    supplierName: string;
    /** Entrega prevista según las condiciones del proveedor (YYYY-MM-DD), si se conocen. */
    expectedDate?: string | null;
    lines: Array<{
      productId: string;
      productName: string;
      packId: string;
      packName: string;
      packsQty: string;
      packPrice: string | null;
      /** Por qué se pide: "quedan 1,4 l · para 2 días". */
      note: string;
    }>;
  }>;
}

/** Inventario: abrirlo en un local o apuntar lo contado en el que está abierto. */
export interface CountDraft extends DraftBase {
  kind: "conteo";
  operation: "abrir" | "anotar";
  locationId: string;
  locationName: string;
  /** Inventario abierto donde se apunta (null al abrir uno). */
  countId: string | null;
  areaId: string | null;
  areaName: string | null;
  lines: Array<{ productId: string; productName: string; qtyBase: string; baseUnit: BaseUnit; input: QuantityInput; text: string }>;
}

/**
 * Algo sobre un documento que ya existe: recibir, enviar o cancelar un traspaso o un pedido; marcar una
 * factura como pagada; apuntar o validar salidas de almacén; cambiar el PVP de un plato o las condiciones de un proveedor.
 */
export interface DocumentDraft extends DraftBase {
  kind: "documento";
  operation: "recibir_traspaso" | "cancelar_traspaso" | "enviar_pedido" | "recibir_pedido" | "cancelar_pedido" | "pagar_factura" | "validar_salidas" | "precio_venta" | "condiciones_proveedor" | "salida_almacen" | "ficha_producto" | "crear_zona" | "formato_producto" | "crear_escandallo" | "asociar_proveedor" | "editar_escandallo" | "enlazar_venta" | "cargar_ventas";
  documentId: string;
  /** Local para enlazar la pantalla al terminar. */
  locationId: string;
  /** «Parador → Vivero · enviado hace 3 días», «Makro · Parador · entrega 21/09». */
  summary: string;
  /** Líneas para mostrar («Coca-Cola 20 cl: 2 cajas»). */
  lines: Array<{ label: string; qty: string }>;
  /** Recibir un pedido: lo pendiente de cada formato, al último precio. */
  receive?: Array<{ packId: string; packsQty: string; packPrice: string | null }>;
  /** Validar salidas: los movimientos de almacén que se validan (los que se enseñaron, ni uno más). */
  moveIds?: string[];
  /** Precio de venta: el PVP nuevo con IVA (cadena decimal). */
  price?: string;
  /** Salida de almacén: lo que se apunta (queda pendiente de validar, como en la pantalla de Almacén). */
  move?: { productId: string; qtyBase: string; fromAreaId: string; toAreaId: string; kind: "salida" | "devolucion"; input: QuantityInput };
  /** Formato nuevo de un producto: nombre y cantidad en unidad base. */
  pack?: { productId: string; name: string; qtyBase: string };
  /** Zona nueva en un local: nombre y tipo (almacén: se guarda; servicio: barra, cocina). */
  zone?: { name: string; kind: "almacen" | "servicio" };
  /** Proveedor asociado a un producto en un formato de compra (sin precio: entra con la primera compra). */
  supplier?: { supplierId: string; packId: string; supplierName: string; productName: string };
  /** Escandallo nuevo: plato (con PVP) o elaboración (rendimiento = suma de ingredientes), con sus líneas en unidad base. */
  recipe?: { name: string; kind: "plato" | "elaboracion"; salePrice: string | null; yieldQty: string; yieldUnit: "racion" | "g" | "ml" | "ud"; lines: Array<{ productId: string; qtyBase: string }> };
  /** Cambio de ingredientes de un escandallo que ya existe (edit_recipe_lines, 0060): cantidades en unidad base o de rendimiento. */
  recipeEdit?: { recipeId: string; recipeName: string; changes: Array<{ op: "add"; productId?: string; subRecipeId?: string; qty: string } | { op: "remove"; lineId: string } | { op: "set"; lineId: string; qty: string }> };
  /** Artículo del TPV enlazado a un escandallo o producto (cantidad por venta, en raciones o unidad base), o ignorado. */
  salesLink?: { itemId: string; itemName: string; recipeId?: string; productId?: string; qty?: string; ignored?: boolean };
  /** Ventas de un día del TPV leídas en el chat, para cargarlas con import_sales. */
  salesImport?: { locationId: string; date: string; file: string; lines: Array<{ code: string; name: string; qty: string; unit: string | null; amount: string }> };
  /** Ficha de producto: categoría nueva y alérgenos que se añaden o quitan, en esos productos. */
  sheet?: { productIds: string[]; categoryId?: string; addAllergens: string[]; removeAllergens: string[] };
  /** Condiciones de proveedor: los campos que cambian, con su valor nuevo. */
  terms?: Array<{ field: "min_order" | "order_days" | "order_cutoff" | "lead_time_hours" | "payment_terms"; value: string }>;
}

export type Draft = WasteDraft | TransferDraft | ReceiptDraft | CountCloseDraft | OrderDraft | CatalogDraft | DocumentDraft | CountDraft;

// Gráficas y análisis -----------------------------------------------------------

export const ANALYTICS_VIEWS = ["resumen", "compras", "consumo", "mermas", "stock", "precios", "reposicion", "desvios"] as const;
export type AnalyticsView = (typeof ANALYTICS_VIEWS)[number];

/** Cómo se formatean los valores de una gráfica (las cifras ya vienen formateadas en display). */
export type ChartFormat = "money" | "number" | "days" | "percent";

export interface ChartPoint {
  /** Clave del eje X: fecha YYYY-MM-DD o categoría. */
  x: string;
  /** Etiqueta del eje X para mostrar: "23 sep", "Parador". */
  label: string;
  /** Valor como cadena decimal (calculado con decimal.js). La UI solo lo convierte para posicionar. */
  value: string;
  /** Valor ya formateado en es-ES: "45,00 €", "1,2 días". */
  display: string;
}

export interface ChartSeries {
  key: string;
  name: string;
  points: ChartPoint[];
}

export interface ChartSpec {
  id: string;
  /** line: evolución; column: categorías en vertical; bar: ranking horizontal; diverging: ± alrededor de 0. */
  kind: "line" | "column" | "bar" | "diverging";
  title: string;
  subtitle: string;
  format: ChartFormat;
  series: ChartSeries[];
  /** Línea de referencia (por ejemplo, el horizonte de reposición). */
  reference?: { value: string; label: string };
  /** Texto si no hay datos. */
  empty?: string;
}

export interface Kpi {
  id: string;
  label: string;
  value: string;
  hint?: string;
  delta?: { display: string; direction: "up" | "down" | "flat"; good: boolean };
}

export interface AnalyticsResponse {
  view: AnalyticsView;
  title: string;
  periodLabel: string;
  locationName: string | null;
  kpis: Kpi[];
  charts: ChartSpec[];
  generatedAt: string;
  /** Locales del usuario, para el selector (los añade la ruta HTTP). */
  locations: Array<{ id: string; name: string }>;
  /** Departamentos del catálogo, para el selector (los añade la ruta HTTP). */
  departments: string[];
}

// Eventos SSE ----------------------------------------------------------------

export type SseEvent =
  | { event: "decision"; data: DecisionEvent }
  | { event: "text"; data: TextEvent }
  | { event: "navigate"; data: NavigateEvent }
  | { event: "draft"; data: Draft }
  | { event: "chart"; data: ChartSpec }
  | { event: "table"; data: TableEvent }
  | { event: "actions"; data: ActionsEvent }
  | { event: "clarify"; data: ClarifyEvent }
  | { event: "form"; data: FormEvent }
  | { event: "resolved"; data: ResolvedEvent }
  | { event: "error"; data: ErrorEvent }
  | { event: "done"; data: DoneEvent };

export type Emit = (event: SseEvent) => Promise<void> | void;

// GET /health ----------------------------------------------------------------

export interface HealthResponse {
  status: "ok" | "degradado" | "caido";
  /** error: por qué no responde Jev (camino y qué revisar), para el administrador. */
  jev: { ok: boolean; model: string | null; latencyMs: number | null; error?: string | null };
  /** Ayudante con LLM (resumen de informes y preguntas generales). */
  assistant: { enabled: boolean; model: string; lastError?: string | null };
  writer: { ok: boolean; provider: string; model: string };
  embeddings: { ok: boolean; provider: string; model: string };
  supabase: { ok: boolean };
  contract: string;
}
