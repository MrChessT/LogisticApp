import { describe, expect, it } from "vitest";
import { describeQty, enqueue, flushQueue, isNetworkError, qtyFromInput, readQueue, warehouseError, type QueuedMove } from "./warehouse";

const rum = [
  { name: "Botella 70 cl", qty: "700", count: true, purchase: false },
  { name: "Caja 6", qty: "4200", count: false, purchase: true },
];
const cola = [
  { name: "Botella", qty: "1", count: true, purchase: false },
  { name: "Caja 24", qty: "24", count: false, purchase: true },
];

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}
const move = (n: number): QueuedMove => ({
  clientRef: `ref-${n}`,
  locationId: "loc",
  fromArea: "a",
  toArea: "b",
  productId: "p",
  qty: "700",
  input: { loose: "1" },
  kind: "salida",
  label: `salida ${n}`,
  queuedAt: "2026-10-03T10:00:00Z",
});

describe("cantidades del almacén", () => {
  it("cajas y sueltas pasan a unidad base", () => {
    expect(qtyFromInput("volume", rum, "1", "2")?.toString()).toBe("5600");
    expect(qtyFromInput("count", cola, "3", "5")?.toString()).toBe("77");
    expect(qtyFromInput("volume", rum, "", "0,5")?.toString()).toBe("350");
  });

  it("nada, cero o texto no son una cantidad", () => {
    expect(qtyFromInput("volume", rum, "", "")).toBeNull();
    expect(qtyFromInput("volume", rum, "0", "0")).toBeNull();
    expect(qtyFromInput("volume", rum, "dos", "")).toBeNull();
    expect(qtyFromInput("volume", rum, "1,5", "")).toBeNull();
  });

  it("se describe como se cuenta en el almacén", () => {
    expect(describeQty("5600", "volume", rum)).toBe("8 botellas");
    expect(describeQty("77", "count", cola)).toBe("3 cajas + 5 ud");
  });
});

describe("cola sin cobertura", () => {
  it("guarda sin duplicar el mismo envío", () => {
    const store = memory();
    enqueue(move(1), store);
    enqueue(move(1), store);
    enqueue(move(2), store);
    expect(readQueue(store).map((m) => m.clientRef)).toEqual(["ref-1", "ref-2"]);
  });

  it("sin red se queda todo; con red se envía y se vacía", async () => {
    const store = memory();
    enqueue(move(1), store);
    enqueue(move(2), store);
    const offline = await flushQueue(async () => ({ message: "TypeError: Failed to fetch" }), store);
    expect(offline).toEqual({ sent: 0, failed: [], left: 2 });
    const online = await flushQueue(async () => null, store);
    expect(online).toEqual({ sent: 2, failed: [], left: 0 });
  });

  it("un rechazo de la base de datos no se reintenta y se explica", async () => {
    const store = memory();
    enqueue(move(1), store);
    const result = await flushQueue(async () => ({ message: "invalid_area", code: "22023" }), store);
    expect(result.left).toBe(0);
    expect(result.failed[0]?.message).toBe("Revisa de dónde sale y a dónde va.");
  });

  it("distingue la red de un error de datos", () => {
    expect(isNetworkError({ message: "TypeError: Failed to fetch" })).toBe(true);
    expect(isNetworkError({ message: "forbidden", code: "42501" })).toBe(false);
    expect(warehouseError({ message: "cannot_cancel" })).toMatch(/Ya no se puede deshacer/);
  });
});
