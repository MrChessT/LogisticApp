// El informe PDF se genera en el servidor con las mismas cifras que la pantalla. Aquí se comprueba que el
// documento es un PDF válido, que una vista sin datos no lo rompe y que el informe completo tiene más páginas.
import { describe, expect, it } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ANALYTICS_VIEWS } from "../contract/index";
import { buildReportPdf, type ReportView } from "../reports/pdf-report";
import { FixtureDataSource, fixtureContext, LOCATIONS } from "../dev/fixture";
import { NOW } from "./helpers";

const pages = (pdf: Buffer) => Number(/\/Count (\d+)/.exec(pdf.toString("latin1"))?.[1] ?? 0);

async function viewsFor(ids: readonly string[]): Promise<ReportView[]> {
  const ctx = fixtureContext();
  const analytics = new Analytics(new FixtureDataSource(NOW));
  const q = { ctx, locationIds: LOCATIONS.map((l) => l.id), productIds: [], days: 30, now: NOW };
  const out: ReportView[] = [];
  for (const id of ids as ReportView["id"][]) {
    const r = await analytics.view(id, q);
    out.push({ id, title: r.title, periodLabel: r.periodLabel, locationName: r.locationName, kpis: r.kpis, charts: r.charts });
  }
  return out;
}

describe("informe en PDF", () => {
  it("una vista genera un PDF válido de tamaño A4", async () => {
    const pdf = await buildReportPdf({ organization: "Restaurante Demo", generatedAt: NOW, views: await viewsFor(["compras"]) });
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.toString("latin1")).toContain("/MediaBox [0 0 595.28 841.89]");
    expect(pages(pdf)).toBeGreaterThanOrEqual(1);
  });

  it("una vista sin datos no rompe el documento", async () => {
    const empty: ReportView = { id: "compras", title: "Compras", periodLabel: "últimos 30 días", locationName: null, kpis: [], charts: [{ id: "x", kind: "bar", title: "Vacía", subtitle: "", format: "money", series: [{ key: "k", name: "k", points: [] }] }] };
    const pdf = await buildReportPdf({ organization: "", generatedAt: NOW, views: [empty] });
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("el informe completo (todas las vistas) tiene más páginas que una sola vista", async () => {
    const one = await buildReportPdf({ organization: "Restaurante Demo", generatedAt: NOW, views: await viewsFor(["compras"]) });
    const all = await buildReportPdf({ organization: "Restaurante Demo", generatedAt: NOW, views: await viewsFor(ANALYTICS_VIEWS) });
    expect(pages(all)).toBeGreaterThan(pages(one));
  }, 60000);
});
