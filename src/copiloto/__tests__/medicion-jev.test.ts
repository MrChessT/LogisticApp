// Fallos encontrados midiendo con Jev REAL (npm run copiloto:eval y copiloto:conversaciones -- --real).
// Cada caso queda aquí con Jev simulado para que no vuelva a pasar.
import { describe, expect, it } from "vitest";
import type { Product } from "../domain";
import { levelQuantity } from "../entities/catalog-parser";
import { familyOf } from "../entities/family";
import { unexplainedWords } from "../entities/mentions";
import { isUnitWord, parseQuantities } from "../entities/quantity-parser";
import { bareCountNeedsWeight } from "../entities/units";
import { pastPeriod } from "../tools/periods";
import { movementTypesIn } from "../tools/types";
import { chat, FakeJev, find, makeAgent, run, type Script } from "./helpers";

const route = (tipo: string, extra: Script = {}): Script => ({ intent: "proponer_accion", intent_alt: "cambiar", tipo_accion: tipo, ...extra });

describe("medición con Jev real (2026-10-16)", () => {
  it("la comprobación del borrador incluye lo respondido a las preguntas (no avisa de «revisa los datos» por ello)", async () => {
    const jev = new FakeJev([route("merma", { producto_0: { winner: "Ron Barceló Añejo 70 cl", p: 0.97 }, cantidad_ok_0: 0.95 }), { coherencia: 0.95 }]);
    const { agent } = makeAgent(jev);
    const ask = find(await run(agent, chat("merma de 2 botellas de barceló")), "clarify")!;
    expect(ask.field).toBe("local");

    const events = await run(agent, chat("Parador", { clarification: { clarifyId: ask.clarifyId, optionId: "Parador" } }));
    expect(find(events, "draft")).toBeDefined();
    const request = (jev.calls[1]!.state as { request: string }).request;
    expect(request).toContain("merma de 2 botellas de barceló");
    expect(request).toContain("local: Parador");
  });

  it("palabras de estado y erratas de la unidad no hacen dudar del producto; un nombre distinto sí", () => {
    const ignore = (w: string) => isUnitWord(w);
    expect(unexplainedWords("limones pochos", { name: "Limón" }, ignore)).toEqual([]);
    expect(unexplainedWords("barceló contadas", { name: "Ron Barceló Añejo 70 cl" }, ignore)).toEqual([]);
    expect(unexplainedWords("votellas de tanqueray", { name: "Tanqueray" }, ignore)).toEqual([]);
    expect(unexplainedWords("prubea luis", { name: "Luis Latour" }, ignore)).toEqual(["prubea"]);
    expect(unexplainedWords("helado de vainilla", { name: "Sirope Vainilla" }, ignore)).toEqual(["helado"]);
  });

  it("reconoce unidades con una letra cambiada, pero no nombres", () => {
    expect(isUnitWord("botellas")).toBe(true);
    expect(isUnitWord("votellas")).toBe(true);
    expect(isUnitWord("kajas")).toBe(true);
    expect(isUnitWord("tanquerai")).toBe(false);
    expect(isUnitWord("larios")).toBe(false);
  });
});

describe("batería en producción (2026-10-16)", () => {
  const P = (name: string, category: string, dimension: "count" | "weight" = "count", packs: Array<{ name: string; qtyBase: string }> = []) => ({
    id: name,
    name,
    dimension,
    baseUnit: dimension === "weight" ? "g" : "ud",
    category,
    packs: packs.map((k, i) => ({ id: `${name}-${i}`, isCountDefault: i === 0, isPurchaseDefault: i === 0, ...k })),
  });
  const catalog = [P("Font Vella 1 L", "Refrescos › Aguas"), P("Solán 50 cl", "Refrescos › Aguas"), P("Coca-Cola", "Refrescos › Colas"), P("Brugal Añejo", "Destilados › Ron"), P("Mahou 33 cl", "Cervezas")] as Product[];

  it("una familia del catálogo trae todos sus productos (no solo los que la llevan en el nombre)", () => {
    expect(familyOf("cervezas", catalog)?.products.map((p) => p.name)).toEqual(["Mahou 33 cl"]);
    expect(familyOf("ron", catalog)).toMatchObject({ label: "Ron" });
    expect(familyOf("agua", catalog, { exact: true })?.products).toHaveLength(2);
    // «agua Font Vella» es un producto concreto, no la familia.
    expect(familyOf("agua font vella", catalog, { exact: true })).toBeNull();
    expect(familyOf("coca", catalog)).toBeNull();
  });

  it("«la semana pasada» y «el mes pasado» son la anterior entera, no los últimos días otra vez", () => {
    expect(pastPeriod("semana", "2026-10-16", "¿y la semana pasada?", "mes")).toMatchObject({ from: "2026-10-05", to: "2026-10-11" });
    expect(pastPeriod("semana", "2026-10-16", "esta semana", "mes")).toMatchObject({ from: "2026-10-10", to: "2026-10-16" });
    expect(pastPeriod("mes", "2026-10-16", "el mes pasado", "mes")).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("los tipos de movimiento que nombra el mensaje", () => {
    expect(movementTypesIn("cuánta merma hemos tenido este mes")).toEqual(["waste"]);
    expect(movementTypesIn("roturas del vivero")).toEqual(["waste"]);
    expect(movementTypesIn("compras de la semana")).toEqual(["purchase"]);
    expect(movementTypesIn("movimientos del vivero")).toEqual([]);
  });

  it("«3 limones» de un producto al peso pide el peso; «2 de ron» (botella) no", () => {
    expect(bareCountNeedsWeight(null, P("Limones", "Fruta", "weight", [{ name: "Kg", qtyBase: "1000" }]) as Product)).toBe("g");
    expect(bareCountNeedsWeight("kg", P("Limones", "Fruta", "weight", [{ name: "Kg", qtyBase: "1000" }]) as Product)).toBeNull();
    expect(bareCountNeedsWeight(null, { ...P("Ron", "Destilados", "count"), dimension: "volume", baseUnit: "ml", packs: [{ id: "b", name: "Botella 70 cl", qtyBase: "700", isCountDefault: true, isPurchaseDefault: true }] } as Product)).toBeNull();
  });

  it("el dinero no es una cantidad de producto y el mínimo se lee de un número suelto al final", () => {
    expect(parseQuantities("el larios ahora nos cuesta 11 euros la botella")).toEqual([]);
    expect(levelQuantity("pon el mínimo de coca del vivero en 48")).toEqual({ amount: "48", unit: null });
    expect(levelQuantity("el objetivo del larios a 12 botellas")).toEqual({ amount: "12", unit: "botella" });
    expect(levelQuantity("mínimo del vivero")).toBeNull();
  });
});
