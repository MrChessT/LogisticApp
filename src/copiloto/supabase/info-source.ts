// Lecturas de facturas, equipo, escandallos, zonas, inventarios y proveedores con el cliente del
// usuario (RLS activo): lo que no puede ver vuelve vacío.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AreaStockRaw, CountRaw, InfoSource, InvoiceRaw, RecipeRaw, SupplierRaw, TeamRaw, UnbilledRaw } from "../tools/info";
import type { FigureMovementRaw, LatestPriceRaw, StockTotalsRaw } from "../tools/info-figures";
import { DataError, readAll } from "./client";

type Row = Record<string, unknown>;

function rows(what: string, result: { data: unknown; error: unknown }): Row[] {
  if (result.error) throw new DataError(`No se pudo leer ${what}`, { cause: result.error });
  return (result.data as Row[] | null) ?? [];
}

const text = (v: unknown): string => (v === null || v === undefined ? "0" : String(v));
const textOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export class SupabaseInfoSource implements InfoSource {
  constructor(private readonly db: SupabaseClient) {}

  async invoices(orgId: string): Promise<InvoiceRaw[]> {
    const data = rows("las facturas", await this.db.from("v_invoices").select("supplier_name, number, code, invoice_date, due_date, total, status, paid_at, receipts, difference, overdue").eq("org_id", orgId).limit(500));
    return data.map((r) => ({
      supplierName: String(r.supplier_name ?? ""),
      number: String(r.number ?? ""),
      code: String(r.code ?? ""),
      date: String(r.invoice_date),
      due: textOrNull(r.due_date),
      total: text(r.total),
      status: r.status === "pagada" ? "pagada" : "pendiente",
      paidAt: textOrNull(r.paid_at),
      receipts: Number(r.receipts ?? 0),
      difference: text(r.difference),
      overdue: r.overdue === true,
    }));
  }

  async unbilled(orgId: string): Promise<UnbilledRaw[]> {
    const data = rows("los albaranes sin factura", await this.db.from("v_unbilled_receipts").select("supplier_name, doc_date, total, location_name").eq("org_id", orgId).limit(1000));
    return data.map((r) => ({ supplierName: String(r.supplier_name ?? ""), date: String(r.doc_date), total: text(r.total), locationName: String(r.location_name ?? "") }));
  }

  async team(): Promise<TeamRaw[]> {
    const data = rows("el equipo", await this.db.rpc("team_members"));
    return data.map((r) => ({
      name: String(r.full_name || r.email || "Sin nombre"),
      role: String(r.role),
      allLocations: r.all_locations === true,
      locationIds: (r.location_ids as string[] | null) ?? [],
      pending: r.pending === true,
    }));
  }

  async recipes(orgId: string): Promise<RecipeRaw[]> {
    const [recipes, costs] = await Promise.all([
      this.db.from("recipes").select("id, name, kind, category, active, sale_price, target_food_cost").eq("org_id", orgId),
      this.db.rpc("recipe_costs", { p_org: orgId }),
    ]);
    const byId = new Map(rows("los costes de los escandallos", costs).map((c) => [String(c.recipe_id), c]));
    return rows("los escandallos", recipes).map((r) => {
      const c = byId.get(String(r.id));
      return {
        name: String(r.name),
        kind: r.kind === "elaboracion" ? "elaboracion" : "plato",
        category: textOrNull(r.category),
        active: r.active !== false,
        salePrice: textOrNull(r.sale_price),
        target: text(r.target_food_cost),
        portionCost: textOrNull(c?.portion_cost),
        foodCostPct: textOrNull(c?.food_cost_pct),
        margin: textOrNull(c?.margin),
        missingPrices: Number(c?.missing_prices ?? 0),
        allergens: (c?.allergens as string[] | null) ?? [],
      };
    });
  }

  async areaStock(locationIds: string[]): Promise<AreaStockRaw[]> {
    const data = rows("el stock por zonas", await this.db.from("v_stock_area_valuation").select("location_id, area_id, qty, stock_value").in("location_id", locationIds).gt("qty", 0).limit(10000));
    const byArea = new Map<string, AreaStockRaw>();
    for (const r of data) {
      const key = String(r.area_id);
      const prev = byArea.get(key) ?? { locationId: String(r.location_id), areaId: key, products: 0, value: "0" };
      byArea.set(key, { ...prev, products: prev.products + 1, value: String(Number(prev.value) + Number(r.stock_value ?? 0)) });
    }
    return [...byArea.values()];
  }

  async counts(locationIds: string[]): Promise<CountRaw[]> {
    const data = rows("los inventarios", await this.db.from("inventory_counts").select("location_id, code, status, started_at, closed_at").in("location_id", locationIds).order("started_at", { ascending: false }).limit(200));
    return data.map((r) => ({
      locationId: String(r.location_id),
      code: textOrNull(r.code),
      status: r.status === "open" ? "open" : r.status === "closed" ? "closed" : "cancelled",
      startedAt: String(r.started_at),
      closedAt: textOrNull(r.closed_at),
    }));
  }

  async suppliers(orgId: string): Promise<SupplierRaw[]> {
    const data = rows("los proveedores", await this.db.from("suppliers").select("name, contact_name, phone, email, order_days, order_cutoff, lead_time_hours, min_order, payment_terms, location_ids").eq("org_id", orgId).eq("active", true).order("name"));
    return data.map((r) => ({
      name: String(r.name),
      contact: textOrNull(r.contact_name),
      phone: textOrNull(r.phone),
      email: textOrNull(r.email),
      orderDays: ((r.order_days as number[] | null) ?? []).map(Number),
      cutoff: textOrNull(r.order_cutoff),
      leadHours: r.lead_time_hours === null || r.lead_time_hours === undefined ? null : Number(r.lead_time_hours),
      minOrder: textOrNull(r.min_order),
      paymentTerms: textOrNull(r.payment_terms),
      locationIds: (r.location_ids as string[] | null) ?? [],
    }));
  }

  async latestPrices(): Promise<LatestPriceRaw[]> {
    const data = await readAll<Row>("los precios de compra", (from, to) =>
      this.db
        .from("supplier_prices")
        .select("supplier_id, pack_id, last_price:last_price::text, last_price_at, supplier:suppliers(name)")
        .not("last_price", "is", null)
        .order("supplier_id")
        .order("pack_id")
        .range(from, to),
    );
    return data.map((r) => ({
      packId: String(r.pack_id),
      supplierName: (r.supplier as { name?: string } | null)?.name ?? "proveedor",
      price: text(r.last_price),
      at: textOrNull(r.last_price_at),
    }));
  }

  async stockedProducts(locationIds: string[]): Promise<string[]> {
    if (locationIds.length === 0) return [];
    const data = await readAll<Row>("el stock", (from, to) =>
      this.db.from("stock_balances").select("location_id, product_id").in("location_id", locationIds).gt("qty", 0).order("location_id").order("product_id").range(from, to),
    );
    return [...new Set(data.map((r) => String(r.product_id)))];
  }

  async figureMovements(locationIds: string[], since: string): Promise<FigureMovementRaw[]> {
    if (locationIds.length === 0) return [];
    const data = await readAll<Row>("los movimientos", (from, to) =>
      this.db
        .from("stock_movements")
        .select("id, type, qty:qty::text, unit_cost:unit_cost::text, occurred_at")
        .in("location_id", locationIds)
        .in("type", ["purchase", "consumption", "waste"])
        .gte("occurred_at", since)
        .order("id")
        .range(from, to),
    );
    return data.map((r) => ({ type: r.type as FigureMovementRaw["type"], qty: text(r.qty), unitCost: textOrNull(r.unit_cost), occurredAt: String(r.occurred_at) }));
  }

  async stockTotals(locationIds: string[] | null): Promise<StockTotalsRaw> {
    const one = async (id: string | null) => {
      const r = rows("el resumen del stock", await this.db.rpc("stock_summary", { p_location: id }))[0];
      return { value: text(r?.total_value), belowMin: Number(r?.below_min_count ?? 0), critical: Number(r?.critical_count ?? 0) };
    };
    const parts = await Promise.all((locationIds ?? [null]).map(one));
    return parts.reduce((a, b) => ({ value: String(Number(a.value) + Number(b.value)), belowMin: a.belowMin + b.belowMin, critical: a.critical + b.critical }));
  }
}
