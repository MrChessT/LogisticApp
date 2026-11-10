// Un local grande (Parador real: ~290 productos por reponer, casi todos sin consumo registrado) hacía
// fallar «prepárame el pedido»: el borrador superaba los topes del esquema (aviso de más de 400
// caracteres, más de 80 líneas por proveedor) y el usuario solo veía «Algo ha fallado».
import { describe, expect, it } from "vitest";
import type { LocationProductRaw, BalanceRaw, SupplierPriceRaw, SupplierTermsRaw } from "../tools/types";
import type { DataFilter } from "../tools/types";
import type { Product, SessionContext } from "../domain";
import { FixtureDataSource, fixtureContext, LOCATIONS } from "../dev/fixture";
import { CatalogDraftBuilder, nameList } from "../drafts/catalog-builder";
import { MAX_CHECK_DETAIL, MAX_CHECKS, MAX_ORDER_LINES, validateDraft } from "../drafts/schemas";
import type { OrderDraft } from "../contract/index";
import { NOW } from "./helpers";

const PARADOR = LOCATIONS[0]!;
const N = 230;
const SUPPLIERS_N = 8;
const uuid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;

const products: Product[] = Array.from({ length: N }, (_, i) => ({
  id: uuid("eeeeeeee", i),
  name: `Producto de prueba con un nombre bastante largo número ${i}`,
  dimension: "count",
  baseUnit: "ud",
  category: "Varios",
  packs: [{ id: uuid("ffffffff", i), name: "Caja 6 ud", qtyBase: "6", isCountDefault: false, isPurchaseDefault: true }],
}));
const suppliers = Array.from({ length: SUPPLIERS_N }, (_, s) => ({ id: uuid("abababab", s), name: `Proveedor ${s}` }));

/** Mínimos en todo, stock a cero y sin consumo; precios repartidos entre 8 proveedores con condiciones. */
class BigSource extends FixtureDataSource {
  override async locationProducts(filter: DataFilter): Promise<LocationProductRaw[]> {
    return filter.locationIds.includes(PARADOR.id) ? products.map((p) => ({ locationId: PARADOR.id, productId: p.id, minQty: "12", parQty: "24" })) : [];
  }
  override async balances(): Promise<BalanceRaw[]> {
    return [];
  }
  override async supplierPrices(packIds: string[]): Promise<SupplierPriceRaw[]> {
    // Los 200 primeros, a un solo proveedor (como «Precio de referencia» en producción); el resto, repartidos.
    return products
      .map((p, i) => ({ p, s: suppliers[i < 200 ? 0 : i % SUPPLIERS_N]! }))
      .filter(({ p }) => packIds.includes(p.packs[0]!.id))
      .map(({ p, s }) => ({ supplierId: s.id, supplierName: s.name, packId: p.packs[0]!.id, lastPrice: "10.00", lastPriceAt: NOW.toISOString() }));
  }
  override async supplierTerms(ids: string[]): Promise<SupplierTermsRaw[]> {
    return ids.map((supplierId) => ({ supplierId, orderDays: [1], orderCutoff: "12:00:00", leadTimeHours: 24, minOrder: "5000.00", locationIds: [LOCATIONS[1]!.id] }));
  }
}

describe("pedido de un local grande desde el chat", () => {
  it("cabe en el esquema: líneas más urgentes por proveedor, avisos acotados y aviso de lo que queda fuera", async () => {
    const ctx: SessionContext = { ...fixtureContext(), products, suppliers };
    const result = await new CatalogDraftBuilder().build({
      plan: { type: "catalogo", accion: "preparar_pedido", locationId: PARADOR.id, locationOutcome: "actuar", products: [], periodo: "no_indicado" },
      message: "prepárame el pedido para el parador",
      ctx,
      source: new BigSource(NOW),
      overrides: {},
      now: NOW,
    });
    expect(result.kind).toBe("draft");
    const draft = (result as { draft: OrderDraft }).draft;
    expect(() => validateDraft(draft)).not.toThrow();
    expect(draft.orders.every((o) => o.lines.length <= MAX_ORDER_LINES)).toBe(true);
    expect(draft.checks!.length).toBeLessThanOrEqual(MAX_CHECKS);
    expect(draft.checks!.every((c) => c.detail.length <= MAX_CHECK_DETAIL)).toBe(true);
    // 204 al proveedor 0 (los 200 primeros + 200, 208, 216, 224) → 80 en el pedido y 124 fuera.
    expect(draft.checks!.find((c) => c.id === "largo")!.detail).toContain("quedan fuera 124");
    expect(draft.checks!.find((c) => c.id === "consumo")!.detail).toMatch(/ y \d+ más\. Se pide solo/);
    expect(draft.checks![0]!.id).toBe("origen");
  });

  it("nameList: todos si caben; si no, los que quepan y «y N más»", () => {
    expect(nameList(["Agua", "Coca"])).toBe("Agua, Coca");
    const long = Array.from({ length: 50 }, (_, i) => `Producto ${i}`);
    const text = nameList(long, 60);
    expect(text.length).toBeLessThan(90);
    expect(text).toMatch(/^Producto 0, Producto 1, .* y \d+ más$/);
    // Un solo nombre muy largo se muestra igualmente (el aviso lo recorta si hiciera falta).
    expect(nameList(["x".repeat(500)], 60)).toHaveLength(500);
  });
});
