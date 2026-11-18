import { describe, expect, it } from "vitest";
import type { OrderDraft, TransferDraft } from "../contract/index";
import { LOCATIONS, PRODUCTS } from "../dev/fixture";
import { chat, FakeJev, find, makeAgent, run } from "./helpers";

const [PARADOR, PICKELS] = LOCATIONS;

describe("tareas del asistente (sin Jev hasta el borrador)", () => {
  it("/preparar: traspasos primero, lo que toca pedir hoy según la ficha del proveedor y lo que espera a su día", async () => {
    // Miércoles 23/09 a las 14:00: Bebidas del Sur (lunes y jueves hasta las 14:00, 48 h) ya no admite pedidos hoy.
    const jev = new FakeJev([{ coherencia: 0.95 }]);
    const { agent } = makeAgent(jev);
    const events = await run(agent, chat("/preparar"));
    expect(jev.calls).toHaveLength(0);
    const table = find(events, "table")!;
    expect(table.columns.map((c) => c.key)).toEqual(["local", "proveedor", "productos", "importe", "entrega"]);
    expect(table.rows).toEqual([{ local: "Parador", proveedor: "Distribuciones Canarias", productos: "1", importe: "92,40 €", entrega: "—" }]);
    const text = find(events, "done")!.text;
    // La coca se acaba antes de que llegue su próximo pedido (sábado) y nadie puede cederla: va lo primero.
    expect(text).toMatch(/^Se acaba antes de que llegue un pedido: Coca-Cola 20 cl en Parador \(da para 1,5 días; lo próximo llega el sábado 26/);
    expect(text).toContain("Antes de comprar: 1 producto se cubre con stock de otro local");
    expect(text).toContain("Hoy toca pedir 1 producto a 1 proveedor en 1 local, unos 92,40 € sin IVA.");
    expect(text).toMatch(/Esperan a su día de pedido: Bebidas del Sur el jueves 24/);
    expect(text).toContain("Sin días de pedido en su ficha (se cubre una semana): Distribuciones Canarias.");

    // Primero el traspaso del ron desde Pickels; luego el pedido de hoy de Parador.
    const actions = find(events, "actions")!.actions;
    expect(actions.map((a) => a.label)).toEqual([`Pasar 1 botella de ${PRODUCTS[0]!.name} · Pickels → Parador`, "Preparar pedido · Parador"]);
    const after = await run(agent, chat(actions[1]!.label, { followUpId: actions[1]!.id }));
    const draft = find(after, "draft") as OrderDraft;
    expect(draft).toMatchObject({ kind: "pedido", horizonLabel: "hasta el próximo pedido" });
    // El ron que cede Pickels no se compra: 3.500 ml menos los 700 del traspaso, en cajas de 6 → 1 caja.
    expect(draft.orders.map((o) => [o.supplierName, o.lines.map((l) => [l.productName, l.packsQty])])).toEqual([["Distribuciones Canarias", [[PRODUCTS[0]!.name, "1"]]]]);
    expect(draft.checks!.map((c) => c.id)).toEqual(expect.arrayContaining(["traspaso", "espera", "urgente"]));
  });

  it("/equilibrar: lo que sobra en un local cubre lo que falta en otro, en botellas enteras", async () => {
    const jev = new FakeJev([{ coherencia: 0.95 }]);
    const { agent } = makeAgent(jev);
    const events = await run(agent, chat("/equilibrar"));
    const table = find(events, "table")!;
    const ron = PRODUCTS[0]!;
    const row = table.rows.find((r) => r.producto === ron.name)!;
    expect(row).toMatchObject({ de: PICKELS!.name, a: PARADOR!.name, cantidad: "1 botella" });

    const actions = find(events, "actions")!.actions;
    const button = actions.find((a) => a.label.includes(ron.name))!;
    const draft = find(await run(agent, chat(button.label, { followUpId: button.id })), "draft") as TransferDraft;
    expect(draft).toMatchObject({ kind: "traspaso", fromLocationId: PICKELS!.id, toLocationId: PARADOR!.id });
    expect(draft.lines[0]).toMatchObject({ productName: ron.name, qtyBase: "700", baseUnit: "ml" });
  });

  it("/revisar: errores primero, con su local, y enlace al catálogo", async () => {
    const events = await run(makeAgent(new FakeJev([])).agent, chat("/revisar"));
    const table = find(events, "table")!;
    expect(table.rows[0]).toMatchObject({ gravedad: "Error", problema: "Stock negativo", local: PARADOR!.name });
    expect(table.flagged).toEqual([0]);
    expect(find(events, "done")!.text).toContain("1 problema que da cifras falsas");
    expect(find(events, "navigate")).toMatchObject({ route: "/productos", auto: false });
  });

  it("/parte: el día de ayer por local, con alertas y atajos a las otras tareas", async () => {
    const events = await run(makeAgent(new FakeJev([])).agent, chat("/parte"));
    const table = find(events, "table")!;
    expect(table.rows.map((r) => r.local).sort()).toEqual(LOCATIONS.map((l) => l.name).sort());
    const text = find(events, "done")!.text;
    expect(text).toMatch(/^Ayer \(\d{2}\/\d{2}\/\d{4}\) se consumieron/);
    expect(text).toContain("pedidos con retraso en Parador");
    expect(find(events, "actions")!.actions.map((a) => a.label)).toContain("Preparar pedidos");
  });

  it("un local nombrado acota la tarea («/preparar vivero»)", async () => {
    const events = await run(makeAgent(new FakeJev([])).agent, chat("/parte pickels"));
    expect(find(events, "table")!.rows.map((r) => r.local)).toEqual([PICKELS!.name]);
  });
});
