// Batería de decisiones (fase 0 del plan de mejora): no mide si se entiende la frase, sino si la decisión de
// reposición es la que aceptaría un encargado. Cada caso monta un mundo sintético pequeño (stock, consumo, niveles,
// proveedores con y sin condiciones) y comprueba qué se traspasa, qué se pide hoy, en qué caja y qué espera.
// Un caso por cada fallo que se arregle en la decisión (docs/copiloto/PROMPT_MEJORA_ASISTENTE.md, fase 4).
import { describe, expect, it } from "vitest";
import type { OrderDraft } from "../contract/index";
import { FixtureDataSource, fixtureContext, LOCATIONS, PRODUCTS } from "../dev/fixture";
import { CatalogDraftBuilder } from "../drafts/catalog-builder";
import { planReplenishment } from "../tools/reorder-plan";
import type { BalanceRaw, DataFilter, LocationProductRaw, MovementRaw, OpenOrderRaw, SupplierPriceRaw, SupplierTermsRaw, TransferRaw } from "../tools/types";

const MONDAY_9 = new Date("2026-11-16T08:00:00Z"); // lunes, 9:00 en Madrid
const WEDNESDAY_9 = new Date("2026-11-18T08:00:00Z");
const [A, B] = LOCATIONS as [(typeof LOCATIONS)[number], (typeof LOCATIONS)[number]];
const TONICA = PRODUCTS[4]!; // contada en unidades, caja de 24
const RON = PRODUCTS[0]!; // en ml, botella de 700, caja de 6 botellas
const DIARIO = { id: "51000000-0000-4000-8000-000000000001", name: "Distribuidor diario" };
const SEMANAL = { id: "51000000-0000-4000-8000-000000000002", name: "Distribuidor de lunes" };
const JUEVES = { id: "51000000-0000-4000-8000-000000000003", name: "Distribuidor de jueves" };
const FUENTE = { id: "51000000-0000-4000-8000-000000000004", name: "Precios de escandallo" };

interface World {
  now?: Date;
  stock: Array<[string, string, string]>; // local, producto, cantidad
  perDay: Array<[string, string, number]>; // local, producto, salidas al día
  levels: Array<[string, string, string, string]>; // local, producto, mínimo, objetivo
  prices: Array<[typeof DIARIO, string, string, boolean?]>; // proveedor, formato, precio, fuente de precio
  terms?: Array<[string, Omit<SupplierTermsRaw, "supplierId" | "locationIds">]>;
  open?: OpenOrderRaw[];
  inTransit?: TransferRaw[];
}

class WorldSource extends FixtureDataSource {
  constructor(private readonly w: World) {
    super(w.now ?? MONDAY_9);
  }
  override async balances(f: DataFilter): Promise<BalanceRaw[]> {
    return this.w.stock.filter(([l]) => f.locationIds.includes(l)).map(([locationId, productId, qty]) => ({ locationId, productId, qty, avgCost: "0.5" }));
  }
  override async locationProducts(f: DataFilter): Promise<LocationProductRaw[]> {
    return this.w.levels.filter(([l]) => f.locationIds.includes(l)).map(([locationId, productId, minQty, parQty]) => ({ locationId, productId, minQty, parQty }));
  }
  override async movements(f: DataFilter & { since: string }): Promise<MovementRaw[]> {
    const out: MovementRaw[] = [];
    for (const [locationId, productId, qty] of this.w.perDay) {
      if (!f.locationIds.includes(locationId)) continue;
      for (let d = 1; d <= 28; d += 1) {
        out.push({ locationId, productId, areaId: null, type: "consumption", qty: String(-qty), unitCost: "0.5", occurredAt: new Date(this.now.getTime() - d * 86_400_000).toISOString() });
      }
    }
    return out;
  }
  override async supplierPrices(packIds: string[]): Promise<SupplierPriceRaw[]> {
    return this.w.prices
      .filter(([, packId]) => packIds.includes(packId))
      .map(([s, packId, lastPrice, priceSource]) => ({ supplierId: s.id, supplierName: s.name, packId, lastPrice, lastPriceAt: this.now.toISOString(), priceSource: !!priceSource }));
  }
  override async supplierTerms(ids: string[]): Promise<SupplierTermsRaw[]> {
    return (this.w.terms ?? []).filter(([id]) => ids.includes(id)).map(([supplierId, t]) => ({ supplierId, locationIds: null, ...t }));
  }
  override async openOrders(f: { locationIds: string[] }): Promise<OpenOrderRaw[]> {
    return (this.w.open ?? []).filter((o) => f.locationIds.includes(o.locationId));
  }
  override async transfers(f: { locationIds: string[]; status: TransferRaw["status"][] }): Promise<TransferRaw[]> {
    return (this.w.inTransit ?? []).filter((t) => f.status.includes(t.status) && (f.locationIds.includes(t.toLocationId) || f.locationIds.includes(t.fromLocationId)));
  }
}

const caja = (p: (typeof PRODUCTS)[number]) => p.packs.find((k) => k.isPurchaseDefault)!.id;
const DAILY_TERMS = { orderDays: null, orderCutoff: "12:00:00", leadTimeHours: 24, minOrder: null };
const MONDAY_TERMS = { orderDays: [1], orderCutoff: "12:00:00", leadTimeHours: 24, minOrder: "100.00" };
const THURSDAY_TERMS = { orderDays: [4], orderCutoff: "12:00:00", leadTimeHours: 24, minOrder: null };

const plan = (w: World, locationIds = [A.id]) => planReplenishment({ ctx: fixtureContext(), source: new WorldSource(w), locationIds, now: w.now ?? MONDAY_9 });

async function draftFor(w: World) {
  return new CatalogDraftBuilder().build({
    plan: { type: "catalogo", accion: "preparar_pedido", locationId: A.id, locationOutcome: "actuar", products: [], periodo: "no_indicado" },
    message: "prepárame el pedido",
    ctx: fixtureContext(),
    source: new WorldSource(w),
    overrides: {},
    now: w.now ?? MONDAY_9,
  });
}

describe("batería de decisiones de reposición", () => {
  it("1 · traspasar antes que comprar: lo que sobra en otro local se mueve y solo se compra el resto", async () => {
    const w: World = {
      stock: [[A.id, TONICA.id, "10"], [B.id, TONICA.id, "100"]],
      perDay: [[A.id, TONICA.id, 10]],
      levels: [[A.id, TONICA.id, "24", "48"], [B.id, TONICA.id, "12", "24"]],
      prices: [[DIARIO, caja(TONICA), "12.00"]],
      terms: [[DIARIO.id, DAILY_TERMS]],
    };
    const p = await plan(w);
    // A necesita 10·2 + 24 − 10 = 34 (o 48 − 10 = 38): B cede hasta quedarse en su objetivo (24) → 38 ud.
    expect(p.transfers.map((t) => [t.fromLocationId, t.toLocationId, t.qty.toString()])).toEqual([[B.id, A.id, "38"]]);
    expect(p.today).toEqual([]);
    const result = await draftFor(w);
    expect(result).toMatchObject({ kind: "error" });
    expect((result as { message: string }).message).toMatch(/^Hoy no toca pedir nada en Parador\. Se cubre con traspaso/);
  });

  it("2 · caja de compra: se pide en cajas enteras hacia arriba, nunca en unidades sueltas", async () => {
    const p = await plan({
      stock: [[A.id, TONICA.id, "5"]],
      perDay: [[A.id, TONICA.id, 10]],
      levels: [[A.id, TONICA.id, "24", "30"]],
      prices: [[DIARIO, caja(TONICA), "12.00"]],
      terms: [[DIARIO.id, DAILY_TERMS]],
    });
    // 10·2 + 24 − 5 = 39 ud → 2 cajas de 24.
    expect(p.today[0]!.lines.map((l) => l.packs.toString())).toEqual(["2"]);
    expect(p.today[0]!.total.toString()).toBe("24");
  });

  it("3 · día de pedido: a un proveedor que hoy no admite pedidos no se le pide; espera a su día", async () => {
    const p = await plan({
      stock: [[A.id, TONICA.id, "60"]],
      perDay: [[A.id, TONICA.id, 10]],
      levels: [[A.id, TONICA.id, "24", "48"]],
      prices: [[JUEVES, caja(TONICA), "12.00"]],
      terms: [[JUEVES.id, THURSDAY_TERMS]],
    });
    expect(p.today).toEqual([]);
    expect(p.later.map((b) => [b.supplierName, b.cycle!.next.orderDate])).toEqual([["Distribuidor de jueves", "2026-11-19"]]);
  });

  it("4 · horizonte del proveedor: se cubre hasta que llega su pedido siguiente, no una semana fija", async () => {
    const base = { stock: [[A.id, TONICA.id, "0"]] as World["stock"], perDay: [[A.id, TONICA.id, 12]] as World["perDay"], levels: [[A.id, TONICA.id, "12", "12"]] as World["levels"] };
    const diario = await plan({ ...base, prices: [[DIARIO, caja(TONICA), "12.00"]], terms: [[DIARIO.id, DAILY_TERMS]] });
    const semanal = await plan({ ...base, prices: [[SEMANAL, caja(TONICA), "12.00"]], terms: [[SEMANAL.id, MONDAY_TERMS]] });
    // Diario: llega mañana y el siguiente pasado mañana → 2 días: 12·2 + 12 = 36 → 2 cajas.
    expect(diario.today[0]!.coverDays).toBe(2);
    expect(diario.today[0]!.lines[0]!.packs.toString()).toBe("2");
    // Lunes: llega el martes y el siguiente el martes que viene → 8 días: 12·8 + 12 = 108 → 5 cajas.
    expect(semanal.today[0]!.coverDays).toBe(8);
    expect(semanal.today[0]!.lines[0]!.packs.toString()).toBe("5");
  });

  it("5 · pedido mínimo: se avisa de lo que falta, sin inventar más cantidad", async () => {
    const p = await plan({
      stock: [[A.id, TONICA.id, "20"]],
      perDay: [[A.id, TONICA.id, 1]],
      levels: [[A.id, TONICA.id, "24", "30"]],
      prices: [[SEMANAL, caja(TONICA), "12.00"]],
      terms: [[SEMANAL.id, MONDAY_TERMS]],
    });
    expect(p.today[0]!.lines[0]!.packs.toString()).toBe("1");
    expect(p.today[0]!.minShortfall?.toString()).toBe("88");
  });

  it("6 · lo que ya está pedido cuenta: no se vuelve a pedir ni sale como urgente", async () => {
    const p = await plan({
      stock: [[A.id, TONICA.id, "5"]],
      perDay: [[A.id, TONICA.id, 10]],
      levels: [[A.id, TONICA.id, "24", "48"]],
      prices: [[DIARIO, caja(TONICA), "12.00"]],
      terms: [[DIARIO.id, DAILY_TERMS]],
      open: [{ locationId: A.id, productId: TONICA.id, qtyBase: "96" }],
    });
    expect(p.today).toEqual([]);
    expect(p.urgent).toEqual([]);
  });

  it("7 · se acaba antes de que llegue el pedido y nadie puede cederlo: urgente, sin arreglo en ruta", async () => {
    const p = await plan({
      now: WEDNESDAY_9,
      stock: [[A.id, TONICA.id, "10"]],
      perDay: [[A.id, TONICA.id, 10]],
      levels: [[A.id, TONICA.id, "24", "48"]],
      prices: [[JUEVES, caja(TONICA), "12.00"]],
      terms: [[JUEVES.id, THURSDAY_TERMS]],
    });
    // Un día de stock; lo próximo se pide el jueves y llega el viernes.
    expect(p.urgent.map((u) => [u.product.name, u.fix, u.arrives])).toEqual([[TONICA.name, "ninguno", "2026-11-20"]]);
  });

  it("7b · sin consumo no se acaba: a cero y sin salidas no es urgente (se repone hasta el mínimo, sin alarma)", async () => {
    const p = await plan({
      stock: [[A.id, TONICA.id, "0"]],
      perDay: [],
      levels: [[A.id, TONICA.id, "24", "24"]],
      prices: [[DIARIO, caja(TONICA), "12.00"]],
      terms: [[DIARIO.id, DAILY_TERMS]],
    });
    expect(p.urgent).toEqual([]);
    expect(p.today[0]!.lines[0]!.packs.toString()).toBe("1");
  });

  it("7c · se acaba y no tiene proveedor: se dice que hay que comprarlo fuera", async () => {
    const p = await plan({
      stock: [[A.id, TONICA.id, "0"]],
      perDay: [[A.id, TONICA.id, 10]],
      levels: [[A.id, TONICA.id, "24", "48"]],
      prices: [],
    });
    expect(p.urgent.map((u) => u.fix)).toEqual(["sin_proveedor"]);
    expect(p.noSupplier.map((x) => x.product.name)).toEqual([TONICA.name]);
  });

  it("8 · urgente con stock en otro local: el traspaso lo arregla y va primero", async () => {
    const p = await plan({
      now: WEDNESDAY_9,
      stock: [[A.id, TONICA.id, "10"], [B.id, TONICA.id, "200"]],
      perDay: [[A.id, TONICA.id, 10]],
      levels: [[A.id, TONICA.id, "24", "48"]],
      prices: [[JUEVES, caja(TONICA), "12.00"]],
      terms: [[JUEVES.id, THURSDAY_TERMS]],
    });
    expect(p.urgent.map((u) => u.fix)).toEqual(["traspaso"]);
    expect(p.transfers[0]!.fromLocationId).toBe(B.id);
  });

  it("9 · una fuente de precio nunca recibe el pedido", async () => {
    const p = await plan({
      stock: [[A.id, TONICA.id, "0"]],
      perDay: [[A.id, TONICA.id, 10]],
      levels: [[A.id, TONICA.id, "24", "48"]],
      prices: [[FUENTE, caja(TONICA), "1.00", true], [DIARIO, caja(TONICA), "12.00"]],
      terms: [[DIARIO.id, DAILY_TERMS]],
    });
    expect(p.today.map((b) => b.supplierName)).toEqual(["Distribuidor diario"]);
  });

  it("10 · sin condiciones en la ficha: una semana, y se dice qué proveedor no las tiene", async () => {
    const p = await plan({
      stock: [[A.id, RON.id, "0"]],
      perDay: [[A.id, RON.id, 700]],
      levels: [[A.id, RON.id, "700", "1400"]],
      prices: [[DIARIO, caja(RON), "60.00"]],
    });
    // 700·7 + 700 = 5.600 ml → 2 cajas de 4.200 ml.
    expect(p.today[0]!.coverDays).toBe(7);
    expect(p.today[0]!.lines[0]!.packs.toString()).toBe("2");
    expect(p.missingTerms).toEqual(["Distribuidor diario"]);
  });

  it("11 · el borrador de hoy solo lleva lo de hoy y explica lo demás", async () => {
    const result = await draftFor({
      stock: [[A.id, TONICA.id, "0"], [A.id, RON.id, "0"]],
      perDay: [[A.id, TONICA.id, 10], [A.id, RON.id, 700]],
      levels: [[A.id, TONICA.id, "24", "48"], [A.id, RON.id, "700", "1400"]],
      prices: [[DIARIO, caja(TONICA), "12.00"], [JUEVES, caja(RON), "60.00"]],
      terms: [[DIARIO.id, DAILY_TERMS], [JUEVES.id, THURSDAY_TERMS]],
    });
    expect(result.kind).toBe("draft");
    const draft = (result as { draft: OrderDraft }).draft;
    expect(draft.orders.map((o) => o.supplierName)).toEqual(["Distribuidor diario"]);
    expect(draft.checks!.find((c) => c.id === "espera")!.detail).toMatch(/Distribuidor de jueves el jueves 19/);
  });
});
