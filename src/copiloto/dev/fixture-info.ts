// Datos de prueba (ficticios) de facturas, equipo, escandallos, zonas, inventarios y proveedores.
import type { AreaStockRaw, CountRaw, InfoSource, InvoiceRaw, RecipeRaw, SupplierRaw, TeamRaw, UnbilledRaw } from "../tools/info";
import { AREAS, LOCATIONS } from "./fixture";

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
}
