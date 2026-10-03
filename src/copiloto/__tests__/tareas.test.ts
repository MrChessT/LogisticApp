import { describe, expect, it } from "vitest";
import type { OrderDraft, TransferDraft } from "../contract/index";
import { LOCATIONS, PRODUCTS } from "../dev/fixture";
import { chat, FakeJev, find, makeAgent, run } from "./helpers";

const [PARADOR, PICKELS] = LOCATIONS;

describe("tareas del asistente (sin Jev hasta el borrador)", () => {
  it("/preparar: pedidos de la semana por local y proveedor, y un botón que deja el pedido en borrador", async () => {
    const jev = new FakeJev([{ coherencia: 0.95 }]);
    const { agent } = makeAgent(jev);
    const events = await run(agent, chat("/preparar"));
    expect(jev.calls).toHaveLength(0);
    const table = find(events, "table")!;
    expect(table.columns.map((c) => c.key)).toEqual(["local", "proveedor", "productos", "importe"]);
    expect(table.rows.length).toBeGreaterThan(0);
    expect(find(events, "done")!.text).toMatch(/^Para la próxima semana hay que pedir \d+ productos? en \d+ locale?s?/);

    const actions = find(events, "actions")!.actions;
    expect(actions[0]!.label).toMatch(/^Preparar pedido · /);
    const after = await run(agent, chat(actions[0]!.label, { followUpId: actions[0]!.id }));
    const draft = find(after, "draft") as OrderDraft;
    expect(draft.kind).toBe("pedido");
    expect(draft.orders.length).toBeGreaterThan(0);
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
