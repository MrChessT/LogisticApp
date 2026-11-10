// Dos consultas de cifras que antes acababan en «¿Qué quieres consultar?»:
// · «¿cuál es el producto más caro?» → ranking por precio de compra en su unidad natural;
// · «¿cómo voy este mes?» → compras, consumo y mermas del periodo frente al mismo tramo del anterior,
//   más el stock de ahora.
// Igual que el resto de tools/info.ts: solo lectura con el JWT del usuario, cifras con decimal.js y
// texto ya redactado. Sin «ve costes» no se enseñan importes.
import Decimal from "decimal.js";
import type { TableEvent } from "../contract/index";
import type { Product, SessionContext } from "../domain";
import { normalize, tokenize } from "../entities/normalize";
import { formatDecimal, formatMoney } from "../entities/units";

/** Último precio de compra de un formato (el más reciente de cualquier proveedor). */
export interface LatestPriceRaw { packId: string; supplierName: string; price: string; at: string | null }
/** Movimiento con su valor (cantidad en unidad base con signo y coste por unidad base). */
export interface FigureMovementRaw { type: "purchase" | "consumption" | "waste"; qty: string; unitCost: string | null; occurredAt: string }
export interface StockTotalsRaw { value: string; belowMin: number; critical: number }

export interface FiguresSource {
  latestPrices(): Promise<LatestPriceRaw[]>;
  /** Productos con existencias en esos locales. */
  stockedProducts(locationIds: string[]): Promise<string[]>;
  figureMovements(locationIds: string[], since: string): Promise<FigureMovementRaw[]>;
  /** Valor y bajo mínimo de esos locales (null = todos los que puede ver). */
  stockTotals(locationIds: string[] | null): Promise<StockTotalsRaw>;
}

export interface FigureResult { text: string; table?: TableEvent; rows: number }

const NO_COSTS = "Los importes de compra no se ven con tu puesto. Pide a un administrador el permiso «ve costes» si los necesitas.";
const MAX_ROWS = 10;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Lo más caro ---------------------------------------------------------------------------------

/** Precio por la unidad en que se piensa el producto: su formato de conteo (botella, ud…) o kg / l / ud. */
function naturalUnit(product: Product): { label: string; qtyBase: Decimal } {
  const count = product.packs.find((k) => k.isCountDefault && !k.isServing);
  if (count && new Decimal(count.qtyBase).gt(0)) return { label: count.name.toLowerCase(), qtyBase: new Decimal(count.qtyBase) };
  if (product.baseUnit === "g") return { label: "kg", qtyBase: new Decimal(1000) };
  if (product.baseUnit === "ml") return { label: "l", qtyBase: new Decimal(1000) };
  return { label: "ud", qtyBase: new Decimal(1) };
}

/** ¿Pregunta por lo más barato en vez de lo más caro? */
export const asksCheapest = (message: string) => /\b(mas|menos) barat|\bmenos car/.test(normalize(message));

export async function priceRanking(
  source: FiguresSource,
  ctx: SessionContext,
  p: { message: string; locationIds: string[]; locationsChosen: boolean },
): Promise<FigureResult> {
  if (!ctx.seesCosts) return { text: NO_COSTS, rows: 0 };
  const cheapest = asksCheapest(p.message);
  const words = new Set(tokenize(p.message));
  // «¿cuál es el vino más caro?», «el vino tinto más caro»: solo esas categorías si el mensaje las nombra.
  // La categoría de un producto es su ruta («Vinos › Tinto»): tiene que contener todas las nombradas.
  const said = (w: string) => w.length > 3 && (words.has(w) || words.has(w.replace(/s$/, "")) || words.has(`${w}s`) || words.has(w.replace(/es$/, "")));
  const named = [...new Set(ctx.categories.filter((c) => tokenize(c.name).some(said)).map((c) => c.name))];
  const category = named.length > 0 ? { name: named.join(" › ") } : null;
  const inCategory = (product: Product) => {
    const path = (product.category ?? "").split(" › ");
    return named.every((n) => path.includes(n));
  };
  const [prices, stocked] = await Promise.all([source.latestPrices(), p.locationsChosen ? source.stockedProducts(p.locationIds) : Promise.resolve(null)]);
  const only = stocked ? new Set(stocked) : null;

  const latestByPack = new Map<string, LatestPriceRaw>();
  for (const price of prices) {
    const prev = latestByPack.get(price.packId);
    if (!prev || (price.at ?? "") > (prev.at ?? "")) latestByPack.set(price.packId, price);
  }

  type Line = { product: Product; unit: string; perUnit: Decimal; supplier: string };
  const lines: Line[] = [];
  for (const product of ctx.products) {
    if (only && !only.has(product.id)) continue;
    if (category && !inCategory(product)) continue;
    const unit = naturalUnit(product);
    // El formato de compra habitual manda; si no tiene precio, cualquier otro formato con precio.
    const ordered = [...product.packs].sort((a, b) => Number(b.isPurchaseDefault) - Number(a.isPurchaseDefault));
    const pack = ordered.find((k) => latestByPack.has(k.id) && new Decimal(k.qtyBase).gt(0));
    if (!pack) continue;
    const price = latestByPack.get(pack.id)!;
    const perUnit = new Decimal(price.price).div(pack.qtyBase).mul(unit.qtyBase);
    if (perUnit.lte(0)) continue;
    lines.push({ product, unit: unit.label, perUnit, supplier: price.supplierName });
  }
  const where = p.locationsChosen ? ` en ${p.locationIds.map((id) => ctx.locations.find((l) => l.id === id)?.name).filter(Boolean).join(", ")}` : "";
  // En el orden de la ruta del producto: «vinos › tinto», no «tinto › vinos».
  const firstPath = (lines[0]?.product.category ?? "").split(" › ");
  const label = category ? [...named].sort((a, b) => firstPath.indexOf(a) - firstPath.indexOf(b)).join(" › ").toLowerCase() : "";
  const what = category ? category.name.toLowerCase() : "productos";
  if (lines.length === 0) return { text: `No encuentro precios de compra de ${what}${where}. Se apuntan al recibir mercancía o desde la ficha de cada producto.`, rows: 0 };

  lines.sort((a, b) => (cheapest ? a.perUnit.cmp(b.perUnit) : b.perUnit.cmp(a.perUnit)) || a.product.name.localeCompare(b.product.name));
  const top = lines[0]!;
  const shown = lines.slice(0, MAX_ROWS);
  const text =
    `${cheapest ? "Lo más barato" : "Lo más caro"}${category ? ` en ${label}` : ""}${where} es ${top.product.name}: ${formatMoney(top.perUnit)} por ${top.unit} (${top.supplier}). ` +
    `Te pongo ${shown.length === 1 ? "su precio" : `los ${shown.length} ${cheapest ? "más baratos" : "más caros"}`} de ${plural(lines.length, "producto con precio", "productos con precio")}, por su unidad (botella, ud, kg o l), con el último precio de compra.`;
  return {
    text,
    rows: lines.length,
    table: {
      columns: [
        { key: "producto", label: "Producto" },
        { key: "precio", label: "Precio", align: "right" },
        { key: "por", label: "Por" },
        { key: "proveedor", label: "Proveedor" },
      ],
      rows: shown.map((l) => ({ producto: l.product.name, precio: formatMoney(l.perUnit), por: l.unit, proveedor: l.supplier })),
      ...(lines.length > shown.length ? { more: lines.length - shown.length } : {}),
    },
  };
}

// Cómo voy ------------------------------------------------------------------------------------

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Periodo en curso hasta hoy y el mismo tramo del anterior (del 1 al 10 de este mes frente al 1–10 del pasado). */
export function overviewPeriods(message: string, now: Date) {
  const week = /\bsemana\b/.test(normalize(message));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (week) {
    const start = new Date(today);
    start.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const days = Math.round((today.getTime() - start.getTime()) / 86_400_000) + 1;
    const prevStart = new Date(start);
    prevStart.setDate(start.getDate() - 7);
    const prevEnd = new Date(prevStart);
    prevEnd.setDate(prevStart.getDate() + days);
    return { label: "esta semana", previousLabel: "a la semana pasada", start: isoDay(start), prevStart: isoDay(prevStart), prevEnd: isoDay(prevEnd), days };
  }
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const prevStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  // Mismo número de días; si el mes pasado era más corto, hasta su último día.
  const prevLast = new Date(today.getFullYear(), today.getMonth(), 0).getDate();
  const prevEnd = new Date(prevStart.getFullYear(), prevStart.getMonth(), Math.min(today.getDate(), prevLast) + 1);
  return {
    label: `${MONTHS[today.getMonth()]} (del 1 al ${today.getDate()})`,
    previousLabel: `al mismo tramo de ${MONTHS[prevStart.getMonth()]}`,
    start: isoDay(start),
    prevStart: isoDay(prevStart),
    prevEnd: isoDay(prevEnd),
    days: today.getDate(),
  };
}

export async function overview(
  source: FiguresSource,
  ctx: SessionContext,
  p: { message: string; locationIds: string[]; locationsChosen: boolean; now: Date },
): Promise<FigureResult> {
  if (!ctx.seesCosts) return { text: NO_COSTS, rows: 0 };
  const period = overviewPeriods(p.message, p.now);
  const [movements, stock] = await Promise.all([
    source.figureMovements(p.locationIds, period.prevStart),
    source.stockTotals(p.locationsChosen ? p.locationIds : null),
  ]);
  type Sums = Record<FigureMovementRaw["type"], Decimal> & { receipts: number };
  const empty = (): Sums => ({ purchase: new Decimal(0), consumption: new Decimal(0), waste: new Decimal(0), receipts: 0 });
  const now = empty();
  const before = empty();
  for (const m of movements) {
    const day = m.occurredAt.slice(0, 10);
    const bucket = day >= period.start ? now : day >= period.prevStart && day < period.prevEnd ? before : null;
    if (!bucket) continue;
    if (m.type === "purchase") bucket.receipts += 1;
    if (m.unitCost) bucket[m.type] = bucket[m.type].plus(new Decimal(m.qty).abs().mul(m.unitCost));
  }
  const change = (a: Decimal, b: Decimal) => (b.gt(0) ? `${a.gte(b) ? "+" : "−"}${formatDecimal(a.minus(b).abs().div(b).mul(100), 0)} %` : a.gt(0) ? "nuevo" : "—");
  const where = p.locationsChosen ? ` en ${p.locationIds.map((id) => ctx.locations.find((l) => l.id === id)?.name).filter(Boolean).join(", ")}` : "";

  const parts: string[] = [];
  parts.push(
    now.purchase.gt(0)
      ? `has comprado ${formatMoney(now.purchase)}${before.purchase.gt(0) ? ` (${change(now.purchase, before.purchase)} frente ${period.previousLabel})` : ""}`
      : now.receipts > 0
        ? `hay ${plural(now.receipts, "entrada de mercancía", "entradas de mercancía")} sin importe (revisa sus precios en Recepciones)`
        : "no hay compras registradas",
  );
  if (now.consumption.gt(0)) parts.push(`el consumo registrado suma ${formatMoney(now.consumption)}`);
  if (now.waste.gt(0)) {
    const share = now.consumption.gt(0) ? ` (${formatDecimal(now.waste.div(now.consumption.plus(now.waste)).mul(100), 1)} % de lo que ha salido)` : "";
    parts.push(`las mermas ${formatMoney(now.waste)}${share}`);
  } else parts.push("sin mermas");
  const first = `En ${period.label}${where} ${parts.join(", ")}.`;
  const stockLine = `Ahora tienes ${formatMoney(stock.value)} en stock y ${plural(stock.belowMin, "producto", "productos")} bajo mínimo${stock.critical > 0 ? `, ${stock.critical} sin stock` : ""}.`;
  const hint = now.consumption.isZero() ? " El consumo se registra con las ventas o al cerrar un inventario; sin él, las cifras de salida se quedan cortas." : "";

  const row = (concepto: string, a: Decimal, b: Decimal) => ({ concepto, actual: formatMoney(a), anterior: formatMoney(b), cambio: change(a, b) });
  return {
    text: `${first} ${stockLine}${hint}`,
    rows: 3,
    table: {
      columns: [
        { key: "concepto", label: "" },
        { key: "actual", label: period.label.startsWith("esta") ? "Esta semana" : "Este mes", align: "right" },
        { key: "anterior", label: period.label.startsWith("esta") ? "Semana pasada" : "Mes pasado (mismo tramo)", align: "right" },
        { key: "cambio", label: "Cambio", align: "right" },
      ],
      rows: [
        { ...row("Compras", now.purchase, before.purchase), concepto: `Compras (${plural(now.receipts, "entrada", "entradas")})` },
        row("Consumo", now.consumption, before.consumption),
        row("Mermas", now.waste, before.waste),
      ],
    },
  };
}
