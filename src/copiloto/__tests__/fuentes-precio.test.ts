import { describe, expect, it } from "vitest";
import { CatalogDraftBuilder } from "../drafts/catalog-builder";
import type { OrderDraft } from "../contract/index";
import { FixtureDataSource, fixtureContext, LOCATIONS, PRODUCTS } from "../dev/fixture";
import { runTarea } from "../skills/tareas";
import type { SupplierPriceRaw } from "../tools/types";

// Una fuente de precio (escandallos importados, estimados) con el precio más reciente no puede llevarse el pedido:
// en producción «Precio de referencia (estimado)» acabó con un pedido de 168 líneas (0061).
const NOW = new Date("2026-11-16T09:00:00Z"); // lunes
const PARADOR = LOCATIONS[0]!;
const ron = PRODUCTS[0]!;
const coca = PRODUCTS[3]!;
const FUENTE = "f0000000-0000-4000-8000-000000000001";

class WithPriceSource extends FixtureDataSource {
  constructor(private readonly onlySource = false) {
    super(NOW);
  }
  override async supplierPrices(packIds: string[]): Promise<SupplierPriceRaw[]> {
    const source = [ron, coca].map((p) => ({
      supplierId: FUENTE,
      supplierName: "Precio de referencia (estimado)",
      packId: p.packs.find((k) => k.isPurchaseDefault)!.id,
      lastPrice: "1.00",
      lastPriceAt: NOW.toISOString(),
      priceSource: true,
    }));
    // La fuente va primero: es el precio más reciente, como en producción.
    return [...source, ...(this.onlySource ? [] : await super.supplierPrices(packIds))].filter((p) => packIds.includes(p.packId));
  }
}

async function order(source: FixtureDataSource) {
  const result = await new CatalogDraftBuilder().build({
    plan: { type: "catalogo", accion: "preparar_pedido", locationId: PARADOR.id, locationOutcome: "actuar", products: [], periodo: "no_indicado" },
    message: "prepárame el pedido del parador",
    ctx: fixtureContext(),
    source,
    overrides: {},
    now: NOW,
  });
  return result;
}

describe("fuentes de precio", () => {
  it("el borrador de pedido va a los proveedores reales aunque la fuente tenga el último precio", async () => {
    const result = await order(new WithPriceSource());
    expect(result.kind).toBe("draft");
    const draft = (result as { draft: OrderDraft }).draft;
    const names = draft.orders.map((o) => o.supplierName);
    expect(names).not.toContain("Precio de referencia (estimado)");
    expect(names).toEqual(expect.arrayContaining(["Distribuciones Canarias", "Bebidas del Sur"]));
  });

  it("si solo hay fuente de precio, no hay a quién pedir", async () => {
    const result = await order(new WithPriceSource(true));
    const orders = result.kind === "draft" ? (result as { draft: OrderDraft }).draft.orders : [];
    expect(orders.map((o) => o.supplierName)).not.toContain("Precio de referencia (estimado)");
  });

  it("la tarea de pedidos no agrupa por la fuente de precio", async () => {
    const result = await runTarea("pedidos", { ctx: fixtureContext(), source: new WithPriceSource(), locationIds: [PARADOR.id], now: NOW });
    const rows = result.table?.rows ?? [];
    expect(rows.map((r) => r.proveedor)).not.toContain("Precio de referencia (estimado)");
  });
});
