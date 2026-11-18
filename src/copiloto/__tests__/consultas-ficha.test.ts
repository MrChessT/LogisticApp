// Preguntas que antes acababan en «¿De cuál de estos productos?» o no tenían respuesta: cuándo se pidió
// o llegó algo por última vez, quién trae una familia y qué nos trae un proveedor.
import { describe, expect, it } from "vitest";
import { chat, FakeJev, find, makeAgent, run } from "./helpers";

const answer = async (message: string) => {
  const jev = new FakeJev();
  const events = await run(makeAgent(jev).agent, chat(message));
  return { text: find(events, "done")?.text ?? "", clarify: find(events, "clarify"), jevCalls: jev.calls.length };
};

describe("última vez que se pidió o llegó", () => {
  it("un producto con pedido y sin llegadas", async () => {
    const r = await answer("¿cuándo pedimos Barceló por última vez?");
    expect(r.text).toBe("Ron Barceló Añejo 70 cl: el último pedido fue el 18/09 a Distribuciones Canarias (Parador); no ha llegado nada en el último año.");
    expect(r.jevCalls).toBe(0);
  });

  it("la llegada, contada como se cuenta el producto (cajas)", async () => {
    expect((await answer("¿cuándo llegó la coca cola?")).text).toBe("Coca-Cola 20 cl: no consta ningún pedido enviado; llegó por última vez el 20/09: 10 cajas en Parador.");
  });

  it("sin nada en el último año lo dice", async () => {
    expect((await answer("hace cuánto que no compramos limones")).text).toBe("No consta ningún pedido ni ninguna entrada de Limones en el último año.");
  });

  it("varios productos: uno por línea, sin preguntar cuál", async () => {
    const r = await answer("última vez que pedimos ron");
    expect(r.clarify).toBeUndefined();
    expect(r.text).toBe("Último pedido y última llegada:\n• Ron Barceló Añejo 70 cl: pedido 18/09 a Distribuciones Canarias (Parador) · llegada —\n• Otro, sin pedidos ni entradas en el último año.");
  });
});

describe("proveedores de varios productos", () => {
  it("«¿quién nos trae el ron?» agrupa por proveedor y dice cuáles no tienen", async () => {
    const r = await answer("¿quién nos trae el ron?");
    expect(r.text).toBe("Solo uno tiene proveedor:\n• Distribuciones Canarias: Ron Barceló Añejo 70 cl\n• Sin proveedor apuntado: Ron Brugal Añejo 70 cl");
    expect(r.jevCalls).toBe(0);
  });

  it("«¿qué nos trae Bebidas del Sur?»: lo que se le compra", async () => {
    expect((await answer("¿qué nos trae Bebidas del Sur?")).text).toBe("Bebidas del Sur nos trae 1 producto: Coca-Cola 20 cl.");
  });

  it("una orden sobre el proveedor no es una pregunta", async () => {
    expect((await answer("cambia el proveedor del ron a Makro")).text).not.toContain("Los trae");
  });
});

describe("precios estimados", () => {
  it("«Precio de referencia (estimado)» no es un proveedor a quien se compre", async () => {
    const { productFact } = await import("../agent/product-facts");
    const { fixtureContext, PRODUCTS } = await import("../dev/fixture");
    const { LexicalRetriever } = await import("../entities/retriever");
    const ron = PRODUCTS.filter((p) => p.name.startsWith("Ron"));
    const source = {
      supplierPrices: async () => [
        { supplierId: "x", supplierName: "Precio de referencia (estimado)", packId: ron[0]!.packs[0]!.id, lastPrice: "10", lastPriceAt: null, priceSource: true },
        { supplierId: "y", supplierName: "Makro", packId: ron[1]!.packs[0]!.id, lastPrice: "11", lastPriceAt: null },
      ],
    } as unknown as Parameters<typeof productFact>[3];
    const reply = await productFact("¿quién nos trae el ron?", fixtureContext(), new LexicalRetriever(), source);
    expect(reply!.text).toBe("Solo uno tiene proveedor:\n• Makro: Ron Brugal Añejo 70 cl\n• Sin proveedor apuntado: Ron Barceló Añejo 70 cl");
  });
});
