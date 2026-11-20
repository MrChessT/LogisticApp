import Decimal from "decimal.js";
// Lecturas de facturas, equipo, escandallos, zonas, inventarios y proveedores con el cliente del
// usuario (RLS activo): lo que no puede ver vuelve vacío.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AreaStockRaw, CountRaw, InfoSource, RecipeLineRaw, RecipeRaw, SupplierRaw, TeamRaw } from "../tools/info";
import type { InvoiceRaw, ReceiptRaw } from "../tools/info-invoices";
import type { FigureMovementRaw, LatestPriceRaw, StockTotalsRaw } from "../tools/info-figures";
import type { SalesDayRaw, SalesImportLine, SalesItemRaw, SalesItemRef, SalesPreview } from "../tools/info-sales";
import type { AreaMoveRaw } from "../tools/info-warehouse";
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
    const data = rows("las facturas", await this.db.from("v_invoices").select("id, supplier_name, number, code, invoice_date, due_date, total, status, paid_at, receipts, difference, overdue").eq("org_id", orgId).limit(500));
    return data.map((r) => ({
      id: String(r.id),
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

  /** La cola de cada local por su función (comprueba el acceso al local; sin acceso, error). */
  async areaMoves(locationIds: string[]): Promise<AreaMoveRaw[]> {
    const lists = await Promise.all(locationIds.map(async (locationId) => ({ locationId, data: rows("las salidas de almacén", await this.db.rpc("area_moves_list", { p_location: locationId, p_status: "pending" })) })));
    return lists.flatMap(({ locationId, data }) =>
      data.map((r) => ({
        id: String(r.id),
        locationId,
        kind: r.kind === "devolucion" ? ("devolucion" as const) : ("salida" as const),
        productId: String(r.product_id),
        productName: String(r.product_name ?? "Producto"),
        qty: text(r.qty),
        fromArea: String(r.from_area ?? ""),
        toArea: String(r.to_area ?? ""),
        createdBy: String(r.created_by_name ?? "Alguien"),
        createdAt: String(r.created_at),
      })),
    );
  }

  /** Albaranes cerrados del último año con la factura en la que están (RLS: solo quien gestiona facturas ve el enlace). */
  async receipts(orgId: string): Promise<ReceiptRaw[]> {
    const since = new Date(Date.now() - 366 * 86_400_000).toISOString().slice(0, 10);
    const data = rows(
      "los albaranes",
      await this.db
        .from("goods_receipts")
        .select("code, doc_number, doc_date, supplier:suppliers(name), location:locations(name), lines:receipt_lines(packs_qty:packs_qty::text, pack_price:pack_price::text), billed:invoice_receipts(invoice:invoices(number))")
        .eq("org_id", orgId)
        .eq("status", "closed")
        .gte("doc_date", since)
        .order("doc_date", { ascending: false })
        .limit(1000),
    );
    return data.map((r) => {
      const lines = (r.lines as Array<{ packs_qty: string; pack_price: string }> | null) ?? [];
      const billed = (r.billed as Array<{ invoice: { number?: string } | null }> | null) ?? [];
      return {
        number: textOrNull(r.doc_number),
        code: textOrNull(r.code),
        supplierName: String((r.supplier as { name?: string } | null)?.name ?? "Sin proveedor"),
        date: String(r.doc_date),
        total: lines.reduce((acc, l) => acc.plus(new Decimal(l.packs_qty).mul(l.pack_price)), new Decimal(0)).toDecimalPlaces(2).toString(),
        locationName: String((r.location as { name?: string } | null)?.name ?? ""),
        invoiceNumber: billed[0]?.invoice?.number ?? null,
      };
    });
  }

  async team(): Promise<TeamRaw[]> {
    const data = rows("el equipo", await this.db.rpc("team_members"));
    return data.map((r) => ({
      name: String(r.full_name || r.email || "Sin nombre"),
      role: String(r.role),
      allLocations: r.all_locations === true,
      locationIds: (r.location_ids as string[] | null) ?? [],
      pending: r.pending === true,
      canValidate: r.can_validate === true,
      seesCosts: r.can_see_costs === true,
    }));
  }

  /** Ingredientes de un escandallo, en su orden. Un producto de otra cuenta (0056) sale sin nombre. */
  async recipeLines(recipeId: string): Promise<RecipeLineRaw[]> {
    const data = rows(
      "los ingredientes del escandallo",
      await this.db
        .from("recipe_lines")
        .select("id, qty, product_id, sub_recipe_id, product:products(name, dimension), sub:recipes!recipe_lines_sub_recipe_id_fkey(name, yield_unit)")
        .eq("recipe_id", recipeId)
        .order("sort_order"),
    );
    return data.map((r) => {
      const product = r.product as { name?: string; dimension?: string } | null;
      const sub = r.sub as { name?: string; yield_unit?: string } | null;
      const unit = sub ? sub.yield_unit : product?.dimension === "mass" ? "g" : product?.dimension === "volume" ? "ml" : "ud";
      return {
        id: String(r.id),
        productId: textOrNull(r.product_id),
        subRecipeId: textOrNull(r.sub_recipe_id),
        name: String(sub?.name ?? product?.name ?? "Ingrediente de otra cuenta"),
        qty: text(r.qty),
        unit: (["g", "ml", "ud"].includes(String(unit)) ? unit : "racion") as RecipeLineRaw["unit"],
      };
    });
  }

  async recipes(orgId: string): Promise<RecipeRaw[]> {
    const [recipes, costs] = await Promise.all([
      this.db.from("recipes").select("id, name, kind, category, active, sale_price, vat_rate, target_food_cost").eq("org_id", orgId),
      this.db.rpc("recipe_costs", { p_org: orgId }),
    ]);
    const byId = new Map(rows("los costes de los escandallos", costs).map((c) => [String(c.recipe_id), c]));
    return rows("los escandallos", recipes).map((r) => {
      const c = byId.get(String(r.id));
      return {
        id: String(r.id),
        name: String(r.name),
        kind: r.kind === "elaboracion" ? "elaboracion" : "plato",
        category: textOrNull(r.category),
        active: r.active !== false,
        salePrice: textOrNull(r.sale_price),
        vatRate: text(r.vat_rate ?? 10),
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
    const data = rows("los proveedores", await this.db.from("suppliers").select("name, contact_name, phone, email, order_days, order_cutoff, lead_time_hours, min_order, payment_terms, location_ids, created_at").eq("org_id", orgId).eq("active", true).order("name"));
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
      createdAt: String(r.created_at),
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
  async salesReport(orgId: string, from: string, to: string, locationId: string | null): Promise<SalesItemRaw[]> {
    const data = rows("las ventas", await this.db.rpc("sales_report", { p_org: orgId, p_from: from, p_to: to, p_location: locationId }));
    return data.map((r) => ({
      name: String(r.name ?? ""),
      link: (["receta", "producto", "ignorado"].includes(String(r.link)) ? r.link : "sin_enlazar") as SalesItemRaw["link"],
      linkName: textOrNull(r.link_name),
      qty: text(r.qty),
      amount: text(r.amount),
      cost: textOrNull(r.cost),
      foodCost: textOrNull(r.food_cost_pct),
    }));
  }

  async salesPreview(args: { orgId: string; locationId: string; date: string; lines: SalesImportLine[]; file: string }): Promise<SalesPreview> {
    const { data, error } = await this.db.rpc("import_sales", { p_org: args.orgId, p_location: args.locationId, p_date: args.date, p_lines: args.lines, p_source: "tpv", p_file: args.file, p_apply: false });
    if (error) throw new DataError("No se pudo comprobar las ventas", { cause: error });
    const r = (data ?? {}) as Record<string, unknown>;
    const unlinked = (r.unlinked as Array<{ amount: number }> | null) ?? [];
    return {
      replaced: r.replaced === true,
      linked: Number(r.linked_recipes ?? 0) + Number(r.linked_products ?? 0),
      unlinked: unlinked.length,
      unlinkedAmount: unlinked.reduce((s, u) => s + Number(u.amount ?? 0), 0).toFixed(2),
      theoreticalCost: textOrNull(r.theoretical_cost),
      costedAmount: textOrNull(r.costed_amount),
    };
  }

  async salesItems(orgId: string): Promise<SalesItemRef[]> {
    const data = await readAll<Row>("los artículos del TPV", (from, to) =>
      this.db.from("sales_items").select("id, code, name, recipe_id, product_id, ignored").eq("org_id", orgId).order("name").order("id").range(from, to),
    );
    return data.map((r) => ({
      id: String(r.id),
      code: String(r.code ?? ""),
      name: String(r.name ?? ""),
      link: r.recipe_id ? "receta" : r.product_id ? "producto" : r.ignored ? "ignorado" : "sin_enlazar",
    }));
  }

  async salesDays(orgId: string, from: string, to: string): Promise<SalesDayRaw[]> {
    const data = rows("los días de venta", await this.db.from("sales_days").select("sale_date, location_id, total_amount").eq("org_id", orgId).gte("sale_date", from).lte("sale_date", to).limit(2000));
    return data.map((r) => ({ date: String(r.sale_date), locationId: String(r.location_id), total: text(r.total_amount) }));
  }

  async lastSaleDate(orgId: string): Promise<string | null> {
    const data = rows("los días de venta", await this.db.from("sales_days").select("sale_date").eq("org_id", orgId).order("sale_date", { ascending: false }).limit(1));
    return data.length ? String(data[0]!.sale_date) : null;
  }
}
