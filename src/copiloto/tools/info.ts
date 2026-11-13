// Información de gestión que el asistente consulta además del inventario: facturas, equipo,
// escandallos, zonas, inventarios y proveedores. Solo lectura y siempre con el JWT del usuario: lo que
// la base de datos no le deja ver (RLS, «ve costes») tampoco sale aquí. Las cifras se formatean con
// decimal.js; el texto y la tabla ya salen redactados (no pasan por la LLM).
import Decimal from "decimal.js";
import type { AppRoute, TableEvent } from "../contract/index";
import type { SessionContext } from "../domain";
import type { InfoTool } from "../jev/catalog";
import { normalize, tokenize } from "../entities/normalize";
import { formatDecimal, formatMoney } from "../entities/units";
import { tokenSimilarity } from "../entities/retriever";
import { ALLERGENS } from "../../lib/recipes";
import { overview, priceRanking, type FiguresSource } from "./info-figures";
import { sales, type SalesSource } from "./info-sales";
import { warehouseQueue, type WarehouseSource } from "./info-warehouse";

// Datos crudos (cifras como texto) ---------------------------------------------------------

export interface InvoiceRaw {
  id: string;
  supplierName: string;
  number: string;
  code: string;
  date: string;
  due: string | null;
  total: string;
  status: "pendiente" | "pagada";
  paidAt: string | null;
  receipts: number;
  difference: string;
  overdue: boolean;
}
export interface UnbilledRaw { supplierName: string; date: string; total: string; locationName: string }
export interface TeamRaw { name: string; role: string; allLocations: boolean; locationIds: string[]; pending: boolean }
export interface RecipeRaw {
  /** Para cambiar su PVP desde el chat. */
  id?: string;
  name: string;
  kind: "plato" | "elaboracion";
  category: string | null;
  active: boolean;
  /** PVP con IVA. */
  salePrice: string | null;
  /** IVA del plato en % (para pasar el PVP a importe sin IVA). */
  vatRate?: string;
  target: string;
  portionCost: string | null;
  foodCostPct: string | null;
  margin: string | null;
  missingPrices: number;
  allergens: string[];
}
export interface AreaStockRaw { locationId: string; areaId: string; products: number; value: string }
export interface CountRaw { locationId: string; code: string | null; status: "open" | "closed" | "cancelled"; startedAt: string; closedAt: string | null }
export interface SupplierRaw {
  name: string;
  contact: string | null;
  phone: string | null;
  email: string | null;
  orderDays: number[];
  cutoff: string | null;
  leadHours: number | null;
  minOrder: string | null;
  paymentTerms: string | null;
  locationIds: string[];
}

/** Lecturas que necesita cada consulta (Supabase en producción, datos de prueba en los tests). */
export interface InfoSource extends FiguresSource, SalesSource, WarehouseSource {
  invoices(orgId: string): Promise<InvoiceRaw[]>;
  unbilled(orgId: string): Promise<UnbilledRaw[]>;
  team(): Promise<TeamRaw[]>;
  recipes(orgId: string): Promise<RecipeRaw[]>;
  areaStock(locationIds: string[]): Promise<AreaStockRaw[]>;
  counts(locationIds: string[]): Promise<CountRaw[]>;
  suppliers(orgId: string): Promise<SupplierRaw[]>;
}

export interface InfoParams {
  tool: InfoTool;
  message: string;
  locationIds: string[];
  /** El local lo eligió el usuario (o la página); si no, son todos los suyos. */
  locationsChosen: boolean;
  /** Nombres de productos que nombra el mensaje (para buscar un plato o un ingrediente). */
  productNames: string[];
  now: Date;
}

export interface InfoResult {
  text: string;
  table?: TableEvent;
  /** Pantalla donde se ve entero (enlace, nunca se abre sola). */
  route: AppRoute;
  rows: number;
  /** Botones que envían una frase completa («Validarlas»). */
  actions?: Array<{ label: string; say: string }>;
}

const MAX_ROWS = 12;

const ROLE_LABEL: Record<string, string> = { owner: "Propiedad", admin: "Administración", manager: "Encargado/a", staff: "Personal" };
const WEEKDAYS = ["", "lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

const day = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${Number(d)}/${Number(m)}/${y}`;
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const money = (v: Decimal.Value) => formatMoney(v);
const pct = (v: Decimal.Value) => `${formatDecimal(v, 1)} %`;

/** Días entre hoy y una fecha ISO (negativo si ya pasó). */
function daysFrom(iso: string, now: Date): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const target = Date.UTC(y!, m! - 1, d!);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}

function table(allColumns: TableEvent["columns"], rows: Array<Record<string, string>>, flagged: number[] = []): TableEvent | undefined {
  if (rows.length < 2) return undefined;
  // Una columna sin ningún dato («—» en todas las filas) no aporta: fuera.
  const columns = allColumns.filter((c, i) => i === 0 || rows.some((r) => (r[c.key] ?? "").trim() !== "" && r[c.key] !== "—"));
  const shown = rows.slice(0, MAX_ROWS);
  const marks = flagged.filter((i) => i < shown.length);
  return { columns, rows: shown, ...(marks.length ? { flagged: marks } : {}), ...(rows.length > MAX_ROWS ? { more: rows.length - MAX_ROWS } : {}) };
}

/** ¿El mensaje nombra este texto (todas sus palabras con sentido, admitiendo erratas)? */
function names(message: string, name: string): boolean {
  const words = new Set(tokenize(message));
  const wanted = tokenize(name).filter((w) => w.length > 2 && !["demo", "s", "sl", "sa"].includes(w));
  if (wanted.length === 0) return false;
  const hits = wanted.filter((w) => [...words].some((m) => m.length > 2 && tokenSimilarity(m, w) >= 0.85));
  // Un nombre largo («Distribuciones Bahía») basta con su palabra distintiva («bahía»).
  return hits.length === wanted.length || (wanted.length >= 2 && hits.length >= 1 && hits.some((h) => h.length >= 5));
}

function locationName(ctx: SessionContext, id: string): string {
  return ctx.locations.find((l) => l.id === id)?.name ?? "—";
}

function scopeLabel(ctx: SessionContext, p: InfoParams): string {
  if (!p.locationsChosen || p.locationIds.length === ctx.locations.length) return ctx.locations.length > 1 ? "en tus locales" : "";
  return `en ${p.locationIds.map((id) => locationName(ctx, id)).join(", ")}`;
}

// Facturas -----------------------------------------------------------------------------------

async function invoices(source: InfoSource, ctx: SessionContext, p: InfoParams): Promise<InfoResult> {
  const route: AppRoute = "/facturas";
  if (!ctx.seesCosts || ctx.role === "staff") {
    return { text: "Las facturas las ve la dirección (propiedad, administración y encargados) con el permiso «ve costes».", route, rows: 0 };
  }
  const text = normalize(p.message);
  const [all, unbilled] = await Promise.all([source.invoices(ctx.orgId), source.unbilled(ctx.orgId)]);
  const supplier = [...new Set(all.map((i) => i.supplierName))].find((s) => names(p.message, s));
  const scoped = supplier ? all.filter((i) => i.supplierName === supplier) : all;
  const pending = scoped.filter((i) => i.status === "pendiente");
  const overdue = pending.filter((i) => i.overdue);
  const sum = (rows: InvoiceRaw[]) => rows.reduce((s, i) => s.plus(i.total), new Decimal(0));
  const mismatched = scoped.filter((i) => i.receipts > 0 && new Decimal(i.difference).abs().gt(0.5));
  const who = supplier ? ` de ${supplier}` : "";

  // Albaranes sin factura.
  if (/sin factura|sin facturar|no facturad|albaran/.test(text)) {
    const rows = (supplier ? unbilled.filter((u) => u.supplierName === supplier) : unbilled).sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length === 0) return { text: `No hay albaranes sin factura${who}: todo lo recibido está facturado.`, route, rows: 0 };
    const bySupplier = new Map<string, { n: number; total: Decimal; since: string }>();
    for (const r of rows) {
      const g = bySupplier.get(r.supplierName) ?? { n: 0, total: new Decimal(0), since: r.date };
      bySupplier.set(r.supplierName, { n: g.n + 1, total: g.total.plus(r.total), since: g.since < r.date ? g.since : r.date });
    }
    const groups = [...bySupplier.entries()].sort((a, b) => b[1].total.cmp(a[1].total));
    const total = rows.reduce((s, r) => s.plus(r.total), new Decimal(0));
    return {
      text: `Hay ${plural(rows.length, "albarán", "albaranes")} sin factura${who} por ${money(total)}. Cuando llegue la factura, regístrala en Facturas desde «Albaranes sin factura».`,
      table: table(
        [{ key: "proveedor", label: "Proveedor" }, { key: "albaranes", label: "Albaranes", align: "right" }, { key: "desde", label: "Desde" }, { key: "importe", label: "Importe", align: "right" }],
        groups.map(([name, g]) => ({ proveedor: name, albaranes: String(g.n), desde: day(g.since), importe: money(g.total) })),
      ),
      route,
      rows: rows.length,
    };
  }

  // Las que no cuadran con sus albaranes.
  if (/cuadr|diferencia|de mas|cobrad|discrepan/.test(text)) {
    if (mismatched.length === 0) return { text: `Todas las facturas${who} cuadran con sus albaranes.`, route, rows: 0 };
    const over = mismatched.filter((i) => new Decimal(i.difference).gt(0)).reduce((s, i) => s.plus(i.difference), new Decimal(0));
    return {
      text: `${plural(mismatched.length, "factura no cuadra", "facturas no cuadran")} con sus albaranes${who}${over.gt(0) ? `: cobran ${money(over)} más de lo recibido` : ""}.`,
      table: table(
        [{ key: "proveedor", label: "Proveedor" }, { key: "numero", label: "Número" }, { key: "fecha", label: "Fecha" }, { key: "diferencia", label: "Diferencia", align: "right" }],
        mismatched.map((i) => ({ proveedor: i.supplierName, numero: i.number, fecha: day(i.date), diferencia: `${new Decimal(i.difference).gt(0) ? "+" : ""}${money(i.difference)}` })),
      ),
      route,
      rows: mismatched.length,
    };
  }

  // Pagadas.
  if (/pagad|pague|pagamos/.test(text) && !/pendiente|por pagar|sin pagar|que pagar|hay que pagar/.test(text)) {
    const paid = scoped.filter((i) => i.status === "pagada").sort((a, b) => (b.paidAt ?? "").localeCompare(a.paidAt ?? ""));
    if (paid.length === 0) return { text: `No hay facturas pagadas${who}.`, route, rows: 0 };
    return {
      text: `${plural(paid.length, "factura pagada", "facturas pagadas")}${who} por ${money(sum(paid))}. La última, el ${day(paid[0]!.paidAt ?? paid[0]!.date)}.`,
      table: table(
        [{ key: "proveedor", label: "Proveedor" }, { key: "numero", label: "Número" }, { key: "pagada", label: "Pagada" }, { key: "total", label: "Total", align: "right" }],
        paid.map((i) => ({ proveedor: i.supplierName, numero: i.number, pagada: i.paidAt ? day(i.paidAt) : "—", total: money(i.total) })),
      ),
      route,
      rows: paid.length,
    };
  }

  // Pendientes (por defecto) o solo las vencidas.
  const onlyOverdue = /vencid|atrasad|retrasad|sin pagar desde|deb[oe]mos/.test(text) && overdue.length > 0;
  const list = (onlyOverdue ? overdue : pending).sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  if (pending.length === 0) {
    return { text: `No hay facturas pendientes de pago${who}.${unbilled.length > 0 && !supplier ? ` Eso sí, hay ${plural(unbilled.length, "albarán", "albaranes")} que aún no tienen factura.` : ""}`, route, rows: 0 };
  }
  const dueSoon = pending.filter((i) => !i.overdue && i.due && daysFrom(i.due, p.now) <= 7);
  const parts = [`Pendiente de pago${who}: ${money(sum(pending))} en ${plural(pending.length, "factura", "facturas")}.`];
  if (overdue.length > 0) parts.push(`${plural(overdue.length, "está vencida", "están vencidas")} (${money(sum(overdue))}).`);
  if (dueSoon.length > 0) parts.push(`${plural(dueSoon.length, "vence", "vencen")} en los próximos 7 días (${money(sum(dueSoon))}).`);
  if (mismatched.some((i) => i.status === "pendiente")) parts.push(`Ojo: ${plural(mismatched.filter((i) => i.status === "pendiente").length, "no cuadra", "no cuadran")} con sus albaranes.`);
  const dueText = (i: InvoiceRaw) => {
    if (!i.due) return "sin vencimiento";
    const d = daysFrom(i.due, p.now);
    return d < 0 ? `vencida hace ${plural(-d, "día", "días")}` : d === 0 ? "hoy" : d <= 31 ? `en ${plural(d, "día", "días")}` : day(i.due);
  };
  return {
    text: parts.join(" "),
    table: table(
      [{ key: "proveedor", label: "Proveedor" }, { key: "numero", label: "Número" }, { key: "vence", label: "Vence" }, { key: "total", label: "Total", align: "right" }, { key: "cuadre", label: "Cuadre" }],
      list.map((i) => ({
        proveedor: i.supplierName,
        numero: i.number,
        vence: dueText(i),
        total: money(i.total),
        cuadre: i.receipts === 0 ? "sin albaranes" : new Decimal(i.difference).abs().lte(0.5) ? "cuadra" : `${new Decimal(i.difference).gt(0) ? "+" : ""}${money(i.difference)}`,
      })),
      list.flatMap((i, n) => (i.overdue ? [n] : [])),
    ),
    route,
    rows: list.length,
  };
}

// Equipo -------------------------------------------------------------------------------------

async function team(source: InfoSource, ctx: SessionContext, p: InfoParams): Promise<InfoResult> {
  const route: AppRoute = "/equipo";
  if (ctx.role === "staff") return { text: "El equipo lo ven los encargados y la administración (en Equipo).", route, rows: 0 };
  // Las pantallas de almacén (kiosko) no son personas del equipo.
  let people = (await source.team()).filter((m) => m.role !== "kiosk");
  if (p.locationsChosen && p.locationIds.length < ctx.locations.length) {
    people = people.filter((m) => m.allLocations || m.locationIds.some((id) => p.locationIds.includes(id)));
  }
  if (people.length === 0) return { text: `No hay nadie en el equipo ${scopeLabel(ctx, p)}.`.replace(/\s+\./, "."), route, rows: 0 };
  const counts = new Map<string, number>();
  for (const m of people) counts.set(m.role, (counts.get(m.role) ?? 0) + 1);
  const GROUP: Record<string, [string, string]> = { owner: ["en propiedad", "en propiedad"], admin: ["en administración", "en administración"], manager: ["encargado", "encargados"], staff: ["de personal", "de personal"] };
  const breakdown = ["owner", "admin", "manager", "staff"].filter((r) => counts.has(r)).map((r) => plural(counts.get(r)!, GROUP[r]![0], GROUP[r]![1]));
  const pending = people.filter((m) => m.pending).length;
  const order = { owner: 0, admin: 1, manager: 2, staff: 3 } as Record<string, number>;
  const sorted = [...people].sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9) || a.name.localeCompare(b.name, "es"));
  // «dame los nombres del personal», «¿quién trabaja en el Vivero?»: los nombres van en el texto, no solo en la tabla.
  const names = /\b(nombres?|quien(es)?|como se llaman)\b/.test(normalize(p.message)) && sorted.length <= 15
    ? ` ${sorted.map((m) => `${m.name} (${(ROLE_LABEL[m.role] ?? m.role).toLowerCase()}${m.pending ? ", invitado" : ""})`).join(", ")}.`
    : "";
  return {
    text: `${plural(people.length, "persona", "personas")} ${scopeLabel(ctx, p)}: ${breakdown.join(", ")}.${names}${pending ? ` ${plural(pending, "invitación está", "invitaciones están")} sin aceptar.` : ""}`.replace(/\s+:/, ":"),
    table: table(
      [{ key: "nombre", label: "Nombre" }, { key: "puesto", label: "Puesto" }, { key: "locales", label: "Locales" }],
      sorted.map((m) => ({
        nombre: `${m.name}${m.pending ? " (invitado)" : ""}`,
        puesto: ROLE_LABEL[m.role] ?? m.role,
        locales: m.allLocations ? "Todos" : m.locationIds.map((id) => locationName(ctx, id)).join(", ") || "—",
      })),
    ),
    route,
    rows: people.length,
  };
}

// Escandallos --------------------------------------------------------------------------------

async function recipes(source: InfoSource, ctx: SessionContext, p: InfoParams): Promise<InfoResult> {
  const route: AppRoute = "/escandallos";
  const all = (await source.recipes(ctx.orgId)).filter((r) => r.active);
  if (all.length === 0) return { text: "Aún no hay escandallos. Se crean en Escandallos o se importan desde Importar.", route, rows: 0 };
  const text = normalize(p.message);
  const costs = ctx.seesCosts;

  // Alérgenos: «¿qué platos llevan gluten?», «platos sin lactosa».
  const allergen = ALLERGENS.find((a) => tokenize(a.label).every((w) => text.includes(w.slice(0, 5))) || (a.id === "lacteos" && /lactos|leche/.test(text)));
  if (allergen) {
    const without = /\bsin\b|libre|apto|aptos/.test(text);
    const platos = all.filter((r) => r.kind === "plato" && r.allergens.includes(allergen.id) !== without);
    return {
      text: platos.length === 0 ? `Ningún plato ${without ? "está libre de" : "lleva"} ${allergen.label.toLowerCase()}.` : `${plural(platos.length, "plato", "platos")} ${without ? "sin" : "con"} ${allergen.label.toLowerCase()}: ${platos.slice(0, 20).map((r) => r.name).join(", ")}${platos.length > 20 ? "…" : ""}.`,
      route,
      rows: platos.length,
    };
  }

  // Un plato o elaboración concreta.
  let named = all.filter((r) => names(p.message, r.name) || p.productNames.some((n) => normalize(n) === normalize(r.name)));
  if (named.length > 3) {
    // Muchas coincidencias sueltas: si una sola tiene todas las palabras pedidas, es esa.
    const words = tokenize(p.message).filter((w) => w.length >= 4);
    const exact = named.filter((r) => tokenize(r.name).filter((w) => w.length >= 4).every((w) => words.some((m) => m.startsWith(w.slice(0, Math.max(4, w.length - 1))))));
    if (exact.length === 1) named = exact;
  }
  // Lo pedido por su nombre («margen de la croqueta de cecina», «receta de los macarrones con queso»).
  // También «¿qué alérgenos tiene el rodaballo…?», «¿qué lleva la tarta…?».
  // «del plato rodaballo…», «de la receta de croquetas»: «plato» o «receta» no forman parte del nombre.
  const asked = (
    /\b(?:receta|escandallo|ficha(?: tecnica)?|coste|alergenos?|margen|food ?cost|pvp|precio)\s+(?:de\s+(?:la|las|los)|del|de)\s+(.+?)\s*\??$/.exec(text)?.[1] ??
    /\b(?:tiene|tienen|lleva|llevan)\s+(?:el|la|los|las)\s+(.+?)\s*\??$/.exec(text)?.[1]
  )?.replace(/^(?:plato|receta|escandallo|elaboracion)\s+(?:de\s+(?:la|las|los|el)\s+|del\s+|de\s+)?/, "");
  const words = asked ? asked.split(" ").filter((w) => w.length >= 4) : [];
  const stem = (w: string) => w.slice(0, Math.max(4, w.length - 1));
  const full = all.filter((r) => { const n = normalize(r.name); return words.length > 0 && words.every((w) => n.includes(stem(w))); });
  // Sin coincidencia clara pero una sola receta tiene todas las palabras pedidas: es esa.
  if ((named.length === 0 || named.length > 3) && full.length === 1) named = full;

  if (named.length === 1 || (named.length > 1 && named.length <= 3)) {
    const lines = named.map((r) => {
      const bits = [`${r.name}${r.category ? ` (${r.category})` : ""}`];
      if (costs && r.portionCost !== null) bits.push(`coste ${money(r.portionCost)}${r.kind === "plato" ? " por ración" : ""}`);
      if (costs && r.salePrice !== null) bits.push(`PVP ${money(r.salePrice)}`);
      else if (costs && r.kind === "plato") bits.push("sin PVP (ponlo en su escandallo para ver food cost y margen; el de lo vendido está en Ventas)");
      if (costs && r.foodCostPct !== null) bits.push(`food cost ${pct(r.foodCostPct)} (objetivo ${pct(r.target)})`);
      if (costs && r.margin !== null) bits.push(`margen ${money(r.margin)}`);
      if (costs && r.missingPrices > 0) bits.push(`${plural(r.missingPrices, "ingrediente sin precio", "ingredientes sin precio")}`);
      bits.push(r.allergens.length ? `alérgenos: ${r.allergens.map((a) => ALLERGENS.find((x) => x.id === a)?.label ?? a).join(", ")}` : "sin alérgenos declarados");
      return bits.join(" · ");
    });
    return { text: lines.join("\n"), route, rows: named.length };
  }

  // Se pide uno por su nombre y no existe («la receta de los macarrones con queso»): se dice, con los
  // parecidos si los hay, en vez de soltar el resumen de todos.
  // Aquí named está vacío o tiene más de 3 (coincidencias sueltas).
  if (asked) {
    if (!/\b(platos?|recetas?|escandallos?|todos?|todas?|cada|mes|semana|hoy|ayer)\b/.test(asked)) {
      // Con todas sus palabras («croquetas» → las 5 croquetas): se listan para elegir. Si ninguna las
      // tiene todas («macarrones con queso» solo encaja por «queso»), no existe; se dan las parecidas.
      if (full.length > 1) {
        return { text: `Hay ${full.length} escandallos de «${asked}»: ${full.slice(0, 10).map((r) => r.name).join(", ")}${full.length > 10 ? "…" : ""}. Dime cuál.`, route, rows: full.length };
      }
      const close = (named.length > 0 ? named : all.filter((r) => { const n = normalize(r.name); return words.some((w) => n.includes(stem(w))); })).slice(0, 5);
      return {
        text: `No hay ningún escandallo de «${asked}».${close.length ? ` Parecidos: ${close.map((r) => r.name).join(", ")}.` : " Se crea en Escandallos o se importa desde Importar."}`,
        route,
        rows: 0,
      };
    }
  }

  const platos = all.filter((r) => r.kind === "plato");
  const elaboraciones = all.length - platos.length;
  if (!costs) {
    return { text: `Hay ${plural(platos.length, "plato", "platos")} y ${plural(elaboraciones, "elaboración", "elaboraciones")}. Los costes los ve quien tiene el permiso «ve costes»; pregúntame por los alérgenos de un plato o por qué platos llevan un alérgeno.`, route, rows: all.length };
  }
  const priced = platos.filter((r) => r.foodCostPct !== null);
  const avg = priced.length ? priced.reduce((s, r) => s.plus(r.foodCostPct!), new Decimal(0)).div(priced.length) : null;
  const over = priced.filter((r) => new Decimal(r.foodCostPct!).gt(r.target)).sort((a, b) => new Decimal(b.foodCostPct!).cmp(a.foodCostPct!));
  const incomplete = all.filter((r) => r.missingPrices > 0).length;
  const parts = [`${plural(platos.length, "plato", "platos")} y ${plural(elaboraciones, "elaboración", "elaboraciones")}.`];
  if (avg) parts.push(`Food cost medio ${pct(avg)} (${plural(priced.length, "plato", "platos")} con PVP).`);
  else parts.push("Ningún plato tiene PVP todavía: ponlo en su escandallo para ver el food cost y el margen.");
  if (over.length) parts.push(`${plural(over.length, "está", "están")} por encima de su objetivo.`);
  if (incomplete) parts.push(`${plural(incomplete, "receta tiene", "recetas tienen")} ingredientes sin precio.`);
  const rows = (over.length ? over : [...priced].sort((a, b) => new Decimal(b.foodCostPct!).cmp(a.foodCostPct!))).map((r) => ({
    plato: r.name,
    coste: r.portionCost === null ? "—" : money(r.portionCost),
    pvp: r.salePrice === null ? "—" : money(r.salePrice),
    food_cost: r.foodCostPct === null ? "—" : pct(r.foodCostPct),
  }));
  return {
    text: parts.join(" "),
    table: table(
      [{ key: "plato", label: over.length ? "Por encima del objetivo" : "Plato" }, { key: "coste", label: "Coste", align: "right" }, { key: "pvp", label: "PVP", align: "right" }, { key: "food_cost", label: "Food cost", align: "right" }],
      rows,
    ),
    route,
    rows: all.length,
  };
}

// Zonas --------------------------------------------------------------------------------------

async function areas(source: InfoSource, ctx: SessionContext, p: InfoParams): Promise<InfoResult> {
  const route: AppRoute = "/zonas";
  const locationIds = p.locationIds.length ? p.locationIds : ctx.locations.map((l) => l.id);
  const zones = ctx.areas.filter((a) => locationIds.includes(a.locationId));
  if (zones.length === 0) return { text: `No hay zonas ${scopeLabel(ctx, p)}. Se crean en Zonas.`.replace(/\s+\./, "."), route, rows: 0 };
  const stock = await source.areaStock(locationIds);
  const byArea = new Map(stock.map((s) => [s.areaId, s]));
  const oneLocation = new Set(zones.map((z) => z.locationId)).size === 1;
  const text = oneLocation
    ? `${locationName(ctx, zones[0]!.locationId)} tiene ${plural(zones.length, "zona", "zonas")}: ${zones.map((z) => z.name).join(", ")}.`
    : `${plural(zones.length, "zona", "zonas")} ${scopeLabel(ctx, p)}: ${ctx.locations.filter((l) => zones.some((z) => z.locationId === l.id)).map((l) => `${l.name} (${zones.filter((z) => z.locationId === l.id).length})`).join(", ")}.`;
  return {
    text: `${text} Para ver qué hay en cada una, pregúntame «¿qué hay en cada zona del ${locationName(ctx, zones[0]!.locationId)}?».`,
    table: table(
      [
        ...(oneLocation ? [] : [{ key: "local", label: "Local" }]),
        { key: "zona", label: "Zona" },
        { key: "productos", label: "Productos", align: "right" as const },
        ...(ctx.seesCosts ? [{ key: "valor", label: "Valor", align: "right" as const }] : []),
      ],
      zones.map((z) => {
        const s = byArea.get(z.id);
        return { local: locationName(ctx, z.locationId), zona: z.name, productos: String(s?.products ?? 0), valor: s ? money(s.value) : money(0) };
      }),
    ),
    route,
    rows: zones.length,
  };
}

// Inventarios --------------------------------------------------------------------------------

async function counts(source: InfoSource, ctx: SessionContext, p: InfoParams): Promise<InfoResult> {
  const route: AppRoute = "/inventarios";
  const locationIds = p.locationIds.length ? p.locationIds : ctx.locations.map((l) => l.id);
  const rows = await source.counts(locationIds);
  const open = rows.filter((c) => c.status === "open");
  const lastClosed = new Map<string, CountRaw>();
  for (const c of rows.filter((r) => r.status === "closed" && r.closedAt)) {
    const prev = lastClosed.get(c.locationId);
    if (!prev || (prev.closedAt ?? "") < (c.closedAt ?? "")) lastClosed.set(c.locationId, c);
  }
  const ago = (iso: string) => {
    const d = -daysFrom(iso, p.now);
    return d <= 0 ? "hoy" : d === 1 ? "ayer" : `hace ${d} días`;
  };
  const parts: string[] = [];
  parts.push(open.length ? `${plural(open.length, "inventario abierto", "inventarios abiertos")}: ${open.map((c) => `${locationName(ctx, c.locationId)} (desde ${ago(c.startedAt)})`).join(", ")}.` : "No hay ningún inventario abierto.");
  const never = locationIds.filter((id) => !lastClosed.has(id));
  const stale = [...lastClosed.values()].filter((c) => -daysFrom(c.closedAt!, p.now) > 30);
  if (stale.length) parts.push(`Llevan más de un mes sin contar: ${stale.map((c) => locationName(ctx, c.locationId)).join(", ")}.`);
  if (never.length) parts.push(`Sin ningún inventario cerrado: ${never.map((id) => locationName(ctx, id)).join(", ")}.`);
  return {
    text: parts.join(" "),
    table: table(
      [{ key: "local", label: "Local" }, { key: "abierto", label: "Abierto" }, { key: "ultimo", label: "Último cerrado" }],
      locationIds.map((id) => {
        const o = open.find((c) => c.locationId === id);
        const l = lastClosed.get(id);
        return { local: locationName(ctx, id), abierto: o ? `Sí, desde ${ago(o.startedAt)}` : "No", ultimo: l ? `${day(l.closedAt!)} (${ago(l.closedAt!)})` : "Nunca" };
      }),
      locationIds.flatMap((id, i) => (!lastClosed.has(id) || stale.some((c) => c.locationId === id) ? [i] : [])),
    ),
    route,
    rows: locationIds.length,
  };
}

// Proveedores --------------------------------------------------------------------------------

async function suppliers(source: InfoSource, ctx: SessionContext, p: InfoParams): Promise<InfoResult> {
  const route: AppRoute = "/proveedores";
  let all = await source.suppliers(ctx.orgId);
  const days = (s: SupplierRaw) => (s.orderDays.length ? s.orderDays.map((d) => WEEKDAYS[d] ?? "").join(", ") : "—");
  const terms = (s: SupplierRaw) =>
    [
      s.orderDays.length ? `pedidos ${days(s)}${s.cutoff ? ` antes de las ${s.cutoff.slice(0, 5)}` : ""}` : null,
      s.leadHours ? `entrega en ${s.leadHours} h` : null,
      s.minOrder && new Decimal(s.minOrder).gt(0) ? `mínimo ${money(s.minOrder)}` : null,
      s.paymentTerms ? `pago: ${s.paymentTerms}` : null,
    ].filter(Boolean).join(" · ");
  const named = all.filter((s) => names(p.message, s.name));
  if (named.length === 1) {
    const s = named[0]!;
    const contact = [s.contact, s.phone, s.email].filter(Boolean).join(" · ");
    return { text: `${s.name}: ${terms(s) || "sin condiciones apuntadas"}.${contact ? ` Contacto: ${contact}.` : ""}`, route, rows: 1 };
  }
  if (p.locationsChosen && p.locationIds.length < ctx.locations.length) {
    all = all.filter((s) => s.locationIds.length === 0 || s.locationIds.some((id) => p.locationIds.includes(id)));
  }
  if (all.length === 0) return { text: "No hay proveedores activos.", route, rows: 0 };
  return {
    text: `${plural(all.length, "proveedor activo", "proveedores activos")} ${scopeLabel(ctx, p)}. Pregúntame por uno («¿qué condiciones tiene Makro?») para ver su contacto.`.replace(/\s+\./, "."),
    table: table(
      [{ key: "proveedor", label: "Proveedor" }, { key: "dias", label: "Días de pedido" }, { key: "entrega", label: "Entrega", align: "right" }, { key: "minimo", label: "Mínimo", align: "right" }, { key: "pago", label: "Pago" }],
      all.map((s) => ({
        proveedor: s.name,
        dias: `${days(s)}${s.cutoff ? ` (${s.cutoff.slice(0, 5)})` : ""}`,
        entrega: s.leadHours ? `${s.leadHours} h` : "—",
        minimo: s.minOrder && new Decimal(s.minOrder).gt(0) ? money(s.minOrder) : "—",
        pago: s.paymentTerms ?? "—",
      })),
    ),
    route,
    rows: all.length,
  };
}

export async function runInfo(source: InfoSource, ctx: SessionContext, p: InfoParams): Promise<InfoResult> {
  switch (p.tool) {
    case "query_sales":
      return { ...(await sales(source, ctx, p)), route: "/ventas" };
    case "query_invoices":
      return invoices(source, ctx, p);
    case "query_team":
      return team(source, ctx, p);
    case "query_recipes":
      return recipes(source, ctx, p);
    case "query_areas":
      return areas(source, ctx, p);
    case "query_counts":
      return counts(source, ctx, p);
    case "query_suppliers":
      return suppliers(source, ctx, p);
    case "query_price_ranking":
      return { ...(await priceRanking(source, ctx, p)), route: "/productos" };
    case "query_overview":
      return { ...(await overview(source, ctx, p)), route: "/informes" };
    case "query_warehouse":
      return { ...(await warehouseQueue(source, ctx, p.locationIds, p.now)), route: "/almacen" };
  }
}

// Reconocer el tema sin Jev ------------------------------------------------------------------

/** Verbos de hacer algo (no de consultar): «crea una factura» no es una consulta de facturas. */
const ACTION_WORDS = /\b(crea|crear|creame|registra|registrar|anade|anadir|agrega|agregar|apunta|apuntar|mete|meter|borra|borrar|elimina|eliminar|cambia|cambiar|pon|poner|sube|subir|baja|bajar|haz|hacer|hazme|marca|marcar|paga|pagar|invita|invitar|da de alta|dar de alta|abre|abrir|cierra|cerrar|empieza|empezar|inicia|iniciar)\b/;

/** «pendientes de pagar», «por pagar», «hay que pagar», «sin pagar», «qué pagar»: forma de preguntar. */
export const QUERY_PAY = /\b(de|por|sin|que|hay que|tengo que|tenemos que|quedan? por) pagar\b/g;

const TOPICS: Array<[InfoTool, RegExp]> = [
  // Ventas del TPV. «Facturación» y «facturamos» son ventas, no facturas de proveedor.
  ["query_sales", /\b(ventas?|vendid[oa]s?|vendimos|vendi|vendio|vendieron|vendemos|venden|facturacion|facturamos|recaudacion|recaudado|ingresos|ganancias?|beneficios?|ganamos|hemos ganado|margen bruto|tpv|ticket medio)\b|\bse (vende|venden|vendio|vendieron)\b|\bfood ?cost\b.*\b(ventas|ayer|hoy|semana|mes|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b|\bvende (mas|menos)\b|\b(pasta|dinero|pelas)\b.*\b(hicimos|hemos hecho|sacamos|hemos sacado|se hizo)\b|\bcaja (de |del )?(ayer|hoy|anoche|anteayer|\d{1,2}|lunes|martes|miercoles|jueves|viernes|sabado|domingo|esta semana|la semana)\b/],
  ["query_invoices", /\bfactur(?!acion|amos)\w*|\bfactuas?\b|\bvencimientos?\b|\bpor pagar\b|\bsin pagar\b|\bdeuda\b/],
  ["query_team", /\b(personal|plantilla|empleados?|trabajadores?|equipo|camareros?|encargad[oa]s?|usuarios?|quien trabaja|cuantas personas|cuanta gente)\b/],
  ["query_recipes", /\b(escandallos?|recetas?|platos?|food ?cost|elaboracion(es)?|alergenos?|carta)\b/],
  ["query_areas", /\b(zonas?|secciones|seccion|almacenes)\b/],
  // «¿qué hay pendiente de validar en el almacén?», «salidas sin validar»: la cola de la pantalla de almacén.
  ["query_warehouse", /\b(salidas?|movimientos?|devoluciones?)\b.*\b(pendientes?|sin validar|por validar|validar)\b|\bpendientes? de validar\b|\b(cola|pendientes?) (del|de|en el) almacen\b|\balmacen\b.*\b(pendientes?|sin validar|por validar)\b/],
  ["query_counts", /\binventarios? (abiertos?|pendientes?|en curso|sin cerrar)\b|\bcuando (fue el ultimo inventario|se conto|contamos|contaron|hicimos el (ultimo )?inventario)\b|\bque inventarios\b|\bhay (algun )?inventario abierto\b/],
  ["query_suppliers", /\b(proveedores|condiciones de pago|dias de pedido|hora limite|pedido minimo)\b/],
  // «¿cuál es el producto más caro?», «lo más barato que tenemos». No «¿qué está más caro que antes?» (subidas).
  ["query_price_ranking", /\b(mas|menos) (car[oa]s?|barat[oa]s?)\b(?!.*\bque (antes|el mes|la semana|el ano|hace)\b)/],
  ["query_overview", /\bcomo (voy|vamos|va|van|estamos|estoy|ha ido|fue)\b.*\b(mes|semana|negocio|todo|cosas)\b|\bcomo (voy|vamos)$|\b(resumen|balance|que tal) (del|de este|este|el|la|de la) (mes|semana)\b/],
];

/**
 * El tema de gestión que pregunta el mensaje, si es una consulta clara («¿qué facturas hay?», «cuánto
 * personal hay»). Con un verbo de acción o una cantidad no: eso es una operación.
 */
export function infoTopicOf(message: string): InfoTool | null {
  const text = normalize(message).replace(/[¿?¡!.,;:]/g, " ").replace(/\s+/g, " ").trim();
  // «pendientes de pagar», «hay que pagar», «sin pagar»: es una pregunta, no la orden de pagar.
  if (!text || ACTION_WORDS.test(text.replace(QUERY_PAY, " "))) return null;
  const hits = TOPICS.filter(([, re]) => re.test(text)).map(([tool]) => tool);
  // «¿qué hay en cada zona del Vivero?» es stock por zonas (otra consulta), no la lista de zonas.
  if (hits.includes("query_areas") && /\b(que hay|cuanto hay|stock|productos? hay|en cada)\b/.test(text)) return null;
  // «¿qué platos llevan gluten?»: escandallos aunque diga «carta» o «equipo».
  // «precio de venta», «PVP», «a cuánto se vende»: precio de un plato o producto, no las ventas.
  if (hits.includes("query_sales") && /\b(precio de venta|pvp|a cuanto se vende|a que precio)\b/.test(text)) return hits.includes("query_recipes") ? "query_recipes" : null;
  // «food cost de las ventas de octubre»: ventas, aunque diga «food cost».
  if (hits.includes("query_sales") && hits.every((h) => h === "query_sales" || h === "query_recipes" || h === "query_overview")) return "query_sales";
  // «¿qué food cost es razonable?», «¿cómo se calcula…?»: pregunta general, no un dato del negocio.
  if (/\b(razonable|ideal|recomendad[oa]s?|aconsejable|deberia (ser|tener)|como se calcula|que significa)\b/.test(text)) return null;
  // «¿qué proveedores nos traen la cerveza?»: proveedor de un producto (lo resuelve Jev), no la lista de proveedores.
  if (hits.includes("query_suppliers") && /\b(trae|traen|sirve|sirven|suministra|suministran|vende|venden)\b/.test(text)) return null;
  return hits.length === 1 ? hits[0]! : hits.includes("query_recipes") && /alergen|gluten|lactos|food ?cost|escandallo/.test(text) ? "query_recipes" : null;
}
