// Tipos de salida: una invitación o el consumo del personal no es pérdida (especificación A, hoja Mermas).
import { describe, expect, it } from "vitest";
import { Analytics } from "../analytics/analytics";
import { FixtureDataSource, fixtureContext, LOCATIONS, PRODUCTS } from "../dev/fixture";
import type { DataFilter, MovementRaw } from "../tools/types";
import { InventoryTools } from "../tools/tools";
import { ConfirmService } from "../drafts/confirm";
import { FixtureWriter } from "../dev/fixture-writer";
import type { WasteDraft } from "../contract/index";
import { chat, FakeJev, find, makeAgent, NOW, run } from "./helpers";
import { ORG_ID } from "../dev/fixture";

const [PARADOR] = LOCATIONS;
const BARCELO = "Ron Barceló Añejo 70 cl";

/** El fixture con una invitación de 10 cocas (5,50 €) en el Parador, ayer. */
class WithInvitation extends FixtureDataSource {
  override async movements(filter: DataFilter & { since: string }): Promise<MovementRaw[]> {
    const base = await super.movements(filter);
    const extra: MovementRaw = {
      locationId: PARADOR!.id, productId: PRODUCTS[4]!.id, areaId: null, type: "waste", qty: "-10", unitCost: "0.55",
      occurredAt: new Date(NOW.getTime() - 26 * 3_600_000).toISOString(), exitKind: "invitacion",
    };
    return filter.locationIds.includes(extra.locationId) ? [...base, extra] : base;
  }
}

const ctx = fixtureContext();
const analytics = new Analytics(new WithInvitation(NOW));
const q = { ctx, locationIds: [PARADOR!.id], productIds: [], days: 7, now: NOW };

describe("tipos de salida", () => {
  it("Informes › Mermas: la invitación no suma a las mermas; va aparte y en la gráfica por tipo", async () => {
    const r = await analytics.view("mermas", q);
    expect(r.kpis.map((k) => k.id)).toEqual(["consumo", "mermas", "otras_salidas"]);
    expect(r.kpis.find((k) => k.id === "mermas")!.value).toBe("30,00 €");
    expect(r.kpis.find((k) => k.id === "otras_salidas")!.value).toBe("5,50 €");
    const byKind = r.charts.find((c) => c.id === "salidas-tipo")!;
    expect(byKind.series[0]!.points.map((p) => `${p.label}=${p.display}`)).toEqual(["Merma=30,00 €", "Invitación=5,50 €"]);
    const top = r.charts.find((c) => c.id === "mermas-producto")!;
    expect(top.series[0]!.points.map((p) => p.label)).not.toContain(PRODUCTS[4]!.name);
  });

  it("Jev: «¿qué mermas y salidas hubo?» separa la invitación por su nombre", async () => {
    const tools = new InventoryTools(new WithInvitation(NOW));
    const result = await tools.run("query_movements", {
      locationIds: [PARADOR!.id], productIds: [], movementTypes: ["waste"], now: NOW,
      period: { from: "2026-09-01", to: "2026-12-31", label: "este trimestre" },
    } as never, ctx);
    expect(result.rows.map((r) => r.tipo)).toEqual(expect.arrayContaining(["merma", "invitación"]));
    expect(result.totals).toMatchObject({ valor_merma: "30,00 €", valor_invitación: "5,50 €" });
  });

  it("Jev: una invitación se prepara y se registra como invitación, no como pérdida", async () => {
    const jev = new FakeJev([
      { intent: "proponer_accion", intent_alt: "cambiar", tipo_accion: "merma", local: "Parador", espacio: "Parador · Barra 1", producto_0: BARCELO, cantidad_ok_0: 0.97, motivo_merma: "invitacion" },
      { coherencia: 0.95 },
    ]);
    const { agent, drafts, audit } = makeAgent(jev);
    const draft = find(await run(agent, chat("hemos invitado a 2 botellas de ron en barra 1")), "draft") as WasteDraft;
    expect(draft).toMatchObject({ kind: "merma", exitKind: "invitacion", reason: null });
    expect(draft.title).toMatch(/^Invitación: /);
    const writer = new FixtureWriter();
    const result = await new ConfirmService(drafts, audit, () => NOW).confirm(
      { orgId: ORG_ID, draftId: draft.draftId, idempotencyKey: "00000009-0000-4000-8000-000000000000", edits: { acknowledged: true } },
      fixtureContext("manager"),
      writer,
    );
    expect(result).toMatchObject({ ok: true, message: "Invitación registrada." });
    expect(writer.calls[0]).toMatchObject({ method: "registerWaste", args: { exitKind: "invitacion" } });
  });
});
