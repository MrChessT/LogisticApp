// Datos de prueba (ficticios) de facturas, equipo, escandallos, zonas, inventarios y proveedores.
import type { AreaStockRaw, CountRaw, InfoSource, InvoiceRaw, RecipeRaw, SupplierRaw, TeamRaw, UnbilledRaw } from "../tools/info";
import type { FigureMovementRaw, LatestPriceRaw, StockTotalsRaw } from "../tools/info-figures";
import { AREAS, LOCATIONS, PRODUCTS } from "./fixture";

const [PARADOR, PICKELS, VIVERO] = LOCATIONS.map((l) => l.id) as [string, string, string, string];

export class FixtureInfoSource implements InfoSource {
  constructor(private readonly now: Date) {}

  private day(offset: number): string {
    const d = new Date(this.now.getTime() + offset * 86_400_000);
    return d.toISOString().slice(0, 10);
  }

  async invoices(): Promise<InvoiceRaw[]> {
    return [
      { supplierName: "Makro", number: "MK-1001", code: "FAC-2026-0001", date: this.day(-40), due: this.day(-10), total: "1210.00", status: "pendiente", paidAt: null, receipts: 3, difference: "0.00", overdue: true },
      { supplierName: "Distribuciones Canarias", number: "DC-77", code: "FAC-2026-0002", date: this.day(-10), due: this.day(3), total: "484.00", status: "pendiente", paidAt: null, receipts: 2, difference: "18.00", overdue: false },
      { supplierName: "Bebidas del Sur", number: "BS-5", code: "FAC-2026-0003", date: this.day(-60), due: this.day(-30), total: "300.00", status: "pagada", paidAt: this.day(-31), receipts: 1, difference: "0.00", overdue: false },
    ];
  }

  async unbilled(): Promise<UnbilledRaw[]> {
    return [
      { supplierName: "Makro", date: this.day(-2), total: "150.00", locationName: "Parador" },
      { supplierName: "Makro", date: this.day(-1), total: "90.50", locationName: "Vivero" },
    ];
  }

  async team(): Promise<TeamRaw[]> {
    return [
      { name: "Ana Propietaria", role: "owner", allLocations: true, locationIds: [], pending: false },
      { name: "Luis Encargado", role: "manager", allLocations: false, locationIds: [PARADOR, PICKELS], pending: false },
      { name: "Marta Camarera", role: "staff", allLocations: false, locationIds: [VIVERO], pending: true },
    ];
  }

  async recipes(): Promise<RecipeRaw[]> {
    return [
      { name: "Croquetas de jamón", kind: "plato", category: "Entrantes", active: true, salePrice: "9.00", target: "30", portionCost: "3.40", foodCostPct: "41.6", margin: "4.78", missingPrices: 0, allergens: ["gluten", "lacteos", "huevo"] },
      { name: "Ensalada de la huerta", kind: "plato", category: "Entrantes", active: true, salePrice: "8.00", target: "30", portionCost: "1.60", foodCostPct: "22.0", margin: "5.67", missingPrices: 1, allergens: [] },
      { name: "Bechamel", kind: "elaboracion", category: "Bases", active: true, salePrice: null, target: "30", portionCost: "0.80", foodCostPct: null, margin: null, missingPrices: 0, allergens: ["gluten", "lacteos"] },
    ];
  }

  async areaStock(locationIds: string[]): Promise<AreaStockRaw[]> {
    return AREAS.filter((a) => locationIds.includes(a.locationId)).map((a, i) => ({ locationId: a.locationId, areaId: a.id, products: 3 + i, value: String(100 * (i + 1)) }));
  }

  async counts(locationIds: string[]): Promise<CountRaw[]> {
    const all: CountRaw[] = [
      { locationId: VIVERO, code: "INV-2026-0003", status: "open", startedAt: `${this.day(-1)}T10:00:00Z`, closedAt: null },
      { locationId: PARADOR, code: "INV-2026-0002", status: "closed", startedAt: `${this.day(-45)}T10:00:00Z`, closedAt: `${this.day(-44)}T10:00:00Z` },
      { locationId: VIVERO, code: "INV-2026-0001", status: "closed", startedAt: `${this.day(-8)}T10:00:00Z`, closedAt: `${this.day(-7)}T10:00:00Z` },
    ];
    return all.filter((c) => locationIds.includes(c.locationId));
  }

  async suppliers(): Promise<SupplierRaw[]> {
    return [
      { name: "Makro", contact: "Pedro", phone: "+34 600 000 001", email: null, orderDays: [1, 4], cutoff: "12:00:00", leadHours: 24, minOrder: "150", paymentTerms: "Transferencia a 30 días", locationIds: [] },
      { name: "Distribuciones Canarias", contact: null, phone: null, email: "pedidos@example.com", orderDays: [2], cutoff: null, leadHours: 48, minOrder: "0", paymentTerms: "Contado", locationIds: [PARADOR] },
    ];
  }

  /** Barceló 92,40 € la caja de 6, Tanqueray 18 € la botella, Coca-Cola 13,20 € la caja de 24, limones 6 € el saco de 5 kg. */
  async latestPrices(): Promise<LatestPriceRaw[]> {
    const at = `${this.day(-3)}T10:00:00Z`;
    const pack = (n: number, i: number) => PRODUCTS[n]!.packs[i]!.id;
    return [
      { packId: pack(0, 1), supplierName: "Distribuciones Canarias", price: "92.40", at },
      { packId: pack(2, 0), supplierName: "Makro", price: "18.00", at },
      { packId: pack(3, 0), supplierName: "Bebidas del Sur", price: "13.20", at },
      { packId: pack(7, 0), supplierName: "Makro", price: "6.00", at },
    ];
  }

  async stockedProducts(locationIds: string[]): Promise<string[]> {
    // Vivero solo tiene Coca-Cola y limones.
    return locationIds.includes(VIVERO) && locationIds.length === 1 ? [PRODUCTS[3]!.id, PRODUCTS[7]!.id] : PRODUCTS.map((p) => p.id);
  }

  /** Este mes: 300 € de compras, 120 € de consumo y 30 € de merma; el mismo tramo del anterior: 200 €, 100 € y 10 €. */
  async figureMovements(): Promise<FigureMovementRaw[]> {
    const thisMonth = new Date(this.now.getFullYear(), this.now.getMonth(), 1, 12).toISOString();
    const lastMonth = new Date(this.now.getFullYear(), this.now.getMonth() - 1, 1, 12).toISOString();
    return [
      { type: "purchase", qty: "100", unitCost: "3", occurredAt: thisMonth },
      { type: "consumption", qty: "-60", unitCost: "2", occurredAt: thisMonth },
      { type: "waste", qty: "-10", unitCost: "3", occurredAt: thisMonth },
      { type: "purchase", qty: "50", unitCost: "4", occurredAt: lastMonth },
      { type: "consumption", qty: "-50", unitCost: "2", occurredAt: lastMonth },
      { type: "waste", qty: "-5", unitCost: "2", occurredAt: lastMonth },
    ];
  }

  async stockTotals(): Promise<StockTotalsRaw> {
    return { value: "4520.50", belowMin: 3, critical: 1 };
  }
}
