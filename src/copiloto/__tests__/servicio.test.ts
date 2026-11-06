// Formatos de servicio en el asistente: «2 copas» usa la copa; «5 de ron» siguen siendo botellas.
import { describe, expect, it } from "vitest";
import { toBase, unitReadings } from "../entities/units";
import { parseQuantities } from "../entities/quantity-parser";
import type { Product } from "../domain";

const rum: Product = {
  id: "ron", name: "Ron Barceló Añejo 70 cl", dimension: "volume", baseUnit: "ml", categoryId: null, categoryName: null, notes: null,
  packs: [
    { id: "b", name: "Botella 70 cl", qtyBase: "700", isCountDefault: true, isPurchaseDefault: false },
    { id: "c", name: "Caja 6 botellas", qtyBase: "4200", isCountDefault: false, isPurchaseDefault: true },
    { id: "s", name: "Copa combinado 50 ml", qtyBase: "50", isCountDefault: false, isPurchaseDefault: false, isServing: true },
  ],
} as unknown as Product;

describe("formatos de servicio", () => {
  it("«2 copas» y «3 chupitos» se leen como unidad", () => {
    const [seg] = parseQuantities("se han roto 2 copas de ron");
    expect(seg?.unit).toBe("copa");
    expect(parseQuantities("3 chupitos de ron")[0]?.unit).toBe("chupito");
    expect(parseQuantities("2 cañas")[0]?.unit).toBe("cana");
  });

  it("«2 copas» de un producto con copa son 100 ml; sin copa definida, no se inventa", () => {
    expect(toBase("2", "copa", rum)).toMatchObject({ ok: true, pack: { id: "s" } });
    expect((toBase("2", "copa", rum) as { qtyBase: { toString(): string } }).qtyBase.toString()).toBe("100");
    const noServing = { ...rum, packs: rum.packs.filter((p) => !p.isServing) } as Product;
    expect(toBase("2", "copa", noServing)).toMatchObject({ ok: false, reason: "unknown_unit" });
  });

  it("sin unidad, la copa no es una lectura: «5 de ron» son botellas", () => {
    expect(unitReadings(rum).map((p) => (p === "base" ? p : p.id))).toEqual(["b", "c"]);
    expect(toBase("5", null, rum)).toMatchObject({ ok: true, pack: { id: "b" } });
  });
});
