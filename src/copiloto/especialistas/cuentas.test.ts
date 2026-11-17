import { describe, expect, it } from "vitest";
import type { QueryPlan } from "../agent/plans";
import { fueraDeTusCuentas, palabrasOcultas } from "./cuentas";

const consulta = (products: QueryPlan["products"] = []): QueryPlan => ({
  type: "consultar", tool: "query_stock", locationIds: [], locationsDefaulted: true, areaId: null, products, periodo: "no_indicado",
});
const oculta = (compartida = false) => ({ cuenta: "Bebida", compartida });
const ctx = { cuentas: ["Comida"], palabrasOcultas: { ginebra: oculta(), beefeater: oculta(), vino: oculta(true) } };
const ninguno = [{ id: "producto_0", label: "Producto", value: "ninguno", valueLabel: "Ninguno de estos", probability: 0.9, confidence: 0.9, gate: "actuar" as const }];

describe("alcance por cuentas en el asistente", () => {
  it("marca las palabras que también salen en lo que sí ve", () => {
    const rows = [{ word: "ginebra", account: "Bebida" }, { word: "naranja", account: "Bebida" }];
    expect(palabrasOcultas(rows, ["Naranja de zumo", "Tomate pera"])).toEqual({ ginebra: oculta(), naranja: oculta(true) });
  });

  it("una palabra compartida solo cuenta si Jev descartó sus productos", () => {
    expect(fueraDeTusCuentas(consulta(), "¿cuánto vino tinto hay?", ctx)).toBeNull();
    expect(fueraDeTusCuentas(consulta(), "¿cuánto vino tinto hay?", ctx, ninguno)?.text).toMatch(/^«vino» es de Bebida/);
  });

  it("una consulta sin productos que nombra algo de otra cuenta recibe un aviso", () => {
    const aviso = fueraDeTusCuentas(consulta(), "¿cuántas ginebras quedan?", ctx);
    expect(aviso?.text).toBe("«ginebras» es de Bebida, y tú solo ves Comida. Si lo necesitas, pídeselo a quien lleva el equipo.");
  });

  it("sin cuentas asignadas no se toca", () => {
    expect(fueraDeTusCuentas(consulta(), "¿cuánta ginebra queda?", { palabrasOcultas: ctx.palabrasOcultas })).toBeNull();
  });

  it("aunque se haya encontrado un producto parecido de lo suyo («cervezas» → cereza)", () => {
    const cereza = { product: { id: "p", name: "Cereza" }, segmentIndex: 0, amount: null, unit: null, price: null, quantityOutcome: null } as unknown as QueryPlan["products"][number];
    expect(fueraDeTusCuentas(consulta([cereza]), "¿cuántas ginebras quedan?", ctx)?.text).toMatch(/^«ginebras» es de Bebida/);
  });

  it("y en la pregunta «¿de qué producto?»", () => {
    const clarify = { type: "clarify" as const, field: "producto" as const, question: "¿De qué producto?", options: [] };
    expect(fueraDeTusCuentas(clarify, "¿a cuánto compramos el Beefeater?", ctx)?.text).toMatch(/^«beefeater» es de Bebida/);
  });

  it("el plural de lo dicho cuenta: «vino» encuentra «vinos»", () => {
    const vinos = { ...ctx, palabrasOcultas: { vinos: oculta() } };
    expect(fueraDeTusCuentas(consulta(), "¿cuánto vino hay?", vinos)?.text).toMatch(/^«vino» es de Bebida/);
  });

  it("las preguntas generales siguen igual", () => {
    expect(fueraDeTusCuentas(consulta(), "¿qué falta en La Oliva?", ctx)).toBeNull();
    expect(fueraDeTusCuentas(consulta(), "¿cuánto vale el stock?", ctx)).toBeNull();
  });
});
