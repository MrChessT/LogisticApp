import { describe, expect, it } from "vitest";
import type { DecisionReport } from "../agent/report";
import type { SseEvent } from "../contract/index";
import { Metrics } from "../metrics/metrics";
import { renderTemplate } from "../writer/templates";
import { allowedNumbers, interpretations, verifyNumbers } from "../writer/verifier";
import { Writer } from "../writer/writer";
import { FakeProvider } from "./helpers";

function stockReport(): DecisionReport {
  return {
    version: 1,
    messageId: "m1",
    catalogVersion: "test",
    jevModel: "jev-fake",
    intent: "consultar",
    decisions: [],
    outcome: {
      kind: "consulta",
      tool: "query_stock",
      scope: { locales: ["Parador"], espacio: null, productos: ["Ron Barceló Añejo 70 cl"], periodo: null },
      result: {
        tool: "query_stock",
        rows: [{ producto: "Ron Barceló Añejo 70 cl", local: "Parador", espacio: null, cantidad: "2,1 l", valor: "45,00 €", minimo: "2,8 l", bajo_minimo: true }],
        totals: { productos: "1", valor_total: "45,00 €", bajo_minimo: "1" },
        count: 1,
        truncated: false,
        evalItems: [],
      },
      evaluations: [],
      notices: [],
    },
  };
}

/** Gasto: una consulta que la LLM redacta (las simples, stock, precios y ficha, van con plantilla). */
function spendReport(): DecisionReport {
  return {
    ...stockReport(),
    outcome: {
      kind: "consulta",
      tool: "query_spend",
      scope: { locales: ["Parador"], espacio: null, productos: [], periodo: "los últimos 30 días" },
      result: {
        tool: "query_spend",
        rows: [{ proveedor: "Bebidas del Sur", albaranes: "1", importe: "132,00 €", porcentaje: "71,4 %" }, { proveedor: "Distribuciones Canarias", albaranes: "1", importe: "52,80 €", porcentaje: "28,6 %" }],
        totals: { total: "184,80 €", albaranes: "2", desde: "25/08/2026", hasta: "23/09/2026" },
        count: 2,
        truncated: false,
        evalItems: [],
      },
      evaluations: [],
      notices: [],
    },
  };
}

describe("verificador de cifras", () => {
  it("acepta las cifras del informe en formato es-ES o en", () => {
    const allowed = allowedNumbers({ a: "1.400 ml", b: "12,5 %", c: "Barra 1" });
    expect(verifyNumbers("Quedan 1.400 ml (12,5 %) en Barra 1.", allowed).ok).toBe(true);
    expect(verifyNumbers("Quedan 1400 ml.", allowed).ok).toBe(true);
    expect(interpretations("1.400")).toContain("1400");
  });

  it("rechaza cifras inventadas o recalculadas", () => {
    const allowed = allowedNumbers({ a: "2,1 l", b: "45,00 €" });
    expect(verifyNumbers("Quedan 2,1 l, unas 3 botellas.", allowed)).toEqual({ ok: false, unknown: ["3"] });
    expect(verifyNumbers("Valen 90 €.", allowed).ok).toBe(false);
  });
});

describe("plantillas", () => {
  it("sin nada que reponer, el horizonte se dice una sola vez", () => {
    const report = stockReport();
    if (report.outcome.kind !== "consulta") throw new Error("consulta");
    report.outcome = {
      ...report.outcome,
      tool: "query_reorder",
      scope: { locales: ["Parador"], espacio: null, productos: [], periodo: "el fin de semana" },
      result: { tool: "query_reorder", rows: [], totals: { horizonte: "el fin de semana" }, count: 0, truncated: false, evalItems: [] },
    };
    expect(renderTemplate(report)).toBe("No falta nada en Parador para el fin de semana.");
  });
});

describe("redactor", () => {
  async function write(provider: FakeProvider | null, report = stockReport()) {
    const events: SseEvent[] = [];
    const metrics = new Metrics("0.042");
    const result = await new Writer(provider, metrics, { timeoutMs: 1000, attempts: 2 }).write(report, (e) => {
      events.push(e);
    });
    return { result, events, metrics };
  }

  it("emite frase a frase el texto verificado de la LLM", async () => {
    const provider = new FakeProvider([["En Parador se han comprado ", "184,80 € en 2 albaranes. ", "Bebidas del Sur es el 71,4 %."]]);
    const { result, events } = await write(provider, spendReport());
    expect(result).toEqual({ source: "llm", text: "En Parador se han comprado 184,80 € en 2 albaranes. Bebidas del Sur es el 71,4 %." });
    expect(events.map((e) => e.event)).toEqual(["text", "text"]);
    expect(provider.prompts[0]!.user).toContain("<informe>");
    expect(provider.prompts[0]!.user).not.toContain("productId");
  });

  it("regenera si aparece una cifra que no está en el informe y usa la plantilla como último recurso", async () => {
    const provider = new FakeProvider([
      ["Compras: 184,80 €. ", "Son 3 botellas."],
      ["Unas 3 botellas."],
    ]);
    const { result, events, metrics } = await write(provider, spendReport());
    expect(result.source).toBe("plantilla");
    expect(provider.prompts).toHaveLength(2);
    const last = events.at(-1)!;
    expect(last.event === "text" && last.data.reset).toBe(true);
    expect(metrics.writer).toEqual({ llm: 0, plantilla: 1, regenerado: 1 });
    expect(events.some((e) => e.event === "text" && e.data.delta.includes("3 botellas"))).toBe(false);
  });

  it("sigue funcionando sin LLM o si la LLM cae", async () => {
    const down = new FakeProvider([]);
    down.fail = true;
    const { result } = await write(down);
    expect(result.source).toBe("plantilla");
    expect(result.text).toBe(renderTemplate(stockReport()));
    const none = await write(null);
    expect(none.result.text).toContain("2,1 l");
  });

  it("las consultas simples (stock, precios, ficha) van con plantilla aunque haya LLM", async () => {
    const provider = new FakeProvider([["texto libre"]]);
    const { result } = await write(provider);
    expect(result).toEqual({ source: "plantilla", text: renderTemplate(stockReport()) });
    expect(provider.prompts).toHaveLength(0);
  });

  it("las aclaraciones y los bloqueos siempre usan plantilla", async () => {
    const provider = new FakeProvider([["texto libre"]]);
    const report: DecisionReport = { ...stockReport(), outcome: { kind: "bloqueado" } };
    const { result } = await write(provider, report);
    expect(result.source).toBe("plantilla");
    expect(provider.prompts).toHaveLength(0);
  });
});
