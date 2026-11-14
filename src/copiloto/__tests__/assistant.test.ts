import { describe, expect, it } from "vitest";
import { loadConfig } from "../config";
import type { AnalyticsResponse } from "../contract/index";
import { Metrics } from "../metrics/metrics";
import { Assistant, summaryView } from "../writer/assistant";
import { chat, FakeJev, FakeProvider, makeAgent, run } from "./helpers";

const report: Omit<AnalyticsResponse, "locations" | "departments"> = {
  view: "precios",
  title: "Precios",
  periodLabel: "últimos 30 días",
  locationName: "Parador",
  kpis: [
    { id: "subidas", label: "Productos que suben", value: "12", delta: { display: "+3 vs. periodo anterior", direction: "up", good: false } },
    { id: "impacto", label: "Impacto en compras", value: "184,20 €" },
  ],
  charts: [
    {
      id: "top",
      kind: "bar",
      title: "Mayores subidas",
      subtitle: "Precio medio de compra",
      format: "percent",
      series: [{ key: "s", name: "Subida", points: [{ x: "a", label: "Aceite de oliva", value: "18", display: "18,0 %" }, { x: "b", label: "Pulpo", value: "12", display: "12,0 %" }] }],
    },
  ],
  generatedAt: "2026-11-11T10:00:00Z",
};

describe("ayudante: resumen de informes", () => {
  it("devuelve el texto si todas sus cifras están en el informe", async () => {
    const provider = new FakeProvider([["El aceite de oliva sube un 18,0 % y el pulpo un 12,0 %. ", "Hay 12 productos al alza con un impacto de 184,20 €: revisa proveedores."]]);
    const text = await new Assistant(provider, new Metrics("0")).summary(report);
    expect(text).toContain("184,20 €");
    expect(provider.prompts[0]!.user).toContain("Aceite de oliva: 18,0 %");
  });

  it("descarta el resumen si inventa o calcula una cifra", async () => {
    const provider = new FakeProvider([["Las compras suben un 47 % en total."]]);
    expect(await new Assistant(provider, new Metrics("0")).summary(report)).toBeNull();
  });

  it("sin modelo, sin datos o con error no hay resumen", async () => {
    expect(await new Assistant(null, new Metrics("0")).summary(report)).toBeNull();
    const empty = { ...report, kpis: [], charts: [] };
    expect(await new Assistant(new FakeProvider([["Nada."]]), new Metrics("0")).summary(empty)).toBeNull();
    const failing = new FakeProvider([["x"]]);
    failing.fail = true;
    expect(await new Assistant(failing, new Metrics("0")).summary(report)).toBeNull();
  });

  it("de una evolución larga solo pasa inicio, final, máximo y mínimo", () => {
    const points = Array.from({ length: 30 }, (_, i) => ({ x: `d${i}`, label: `día ${i}`, value: String(i === 10 ? 99 : i === 20 ? -5 : 1), display: `${i} €` }));
    const view = summaryView({ ...report, charts: [{ ...report.charts[0]!, kind: "line", series: [{ key: "s", name: "Gasto", points }] }] });
    const puntos = (view.graficos as Array<{ series: Array<{ puntos: string[] }> }>)[0]!.series[0]!.puntos;
    expect(puntos).toEqual(["día 0: 0 €", "día 10: 10 €", "día 20: 20 €", "día 29: 29 €"]);
  });
});

describe("ayudante: preguntas fuera de ámbito", () => {
  it("responde preguntas generales y respeta FUERA", async () => {
    const ok = new Assistant(new FakeProvider([["Guárdalo en cámara bien tapado y úsalo primero (FIFO)."]]), new Metrics("0"));
    expect(await ok.general("¿Cómo conservo el pulpo cocido?")).toContain("FIFO");
    const out = new Assistant(new FakeProvider([["FUERA"]]), new Metrics("0"));
    expect(await out.general("¿Quién ganó el mundial de 2010?")).toBeNull();
  });

  it("Jev fuera de ámbito: respuesta general marcada como tal, o la de siempre si no procede", async () => {
    const question = "¿Qué significa trabajar con FIFO en cocina?";
    const jev = () => new FakeJev([{ intent: "fuera_de_ambito", intent_alt: "ninguno" }]);
    const withAnswer = makeAgent(jev(), null, { assistant: new Assistant(new FakeProvider([["Es usar primero lo que entró antes: lo más antiguo delante, lo nuevo detrás."]]), new Metrics("0")) });
    const text = (await run(withAnswer.agent, chat(question))).filter((e) => e.event === "text").map((e) => (e.data as { delta: string }).delta).join("");
    expect(text).toContain("lo que entró antes");
    expect(text).toContain("no he consultado los datos");

    const refused = makeAgent(jev(), null, { assistant: new Assistant(new FakeProvider([["FUERA"]]), new Metrics("0")) });
    const fallback = (await run(refused.agent, chat(question))).filter((e) => e.event === "text").map((e) => (e.data as { delta: string }).delta).join("");
    expect(fallback).toContain("Solo puedo ayudarte con el negocio");
  });
});

describe("ayudante: configuración", () => {
  it("se activa en Vercel (OIDC) o con clave del gateway, y se puede apagar", () => {
    expect(loadConfig({}).assist.enabled).toBe(false);
    expect(loadConfig({ VERCEL: "1" }).assist).toMatchObject({ enabled: true, oidc: true, url: "https://ai-gateway.vercel.sh" });
    expect(loadConfig({ AI_GATEWAY_API_KEY: "vck" }).assist).toMatchObject({ enabled: true, oidc: false, apiKey: "vck" });
    expect(loadConfig({ VERCEL: "1", ASSIST_ENABLED: "false" }).assist.enabled).toBe(false);
  });
});

describe("ayudante: modelos de respaldo", () => {
  it("si el gateway no da acceso a un modelo (403), pasa al siguiente y se queda con él", async () => {
    const denied = new FakeProvider([["x"]]);
    denied.stream = async function* () {
      throw new Error("LLM respondió 403: Free tier users do not have access to this model");
    };
    const second = new FakeProvider([["Usa primero lo que entró antes."], ["Otra vez."]]);
    Object.defineProperty(second, "model", { value: "google/segundo" });
    const assistant = new Assistant([denied, second], new Metrics("0"));
    expect(await assistant.general("¿Qué es el FIFO en cocina?")).toContain("entró antes");
    expect(assistant.model).toBe("google/segundo");
    expect(await assistant.general("¿Y el FEFO en cocina?")).toBe("Otra vez.");
  });

  it("la lista de modelos se lee separada por comas", () => {
    expect(loadConfig({ VERCEL: "1", ASSIST_MODEL: "a/x, b/y" }).assist.models).toEqual(["a/x", "b/y"]);
  });
});
