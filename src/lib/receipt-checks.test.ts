import { describe, expect, it } from "vitest";
import { describeDiff, isIncident, photoPath, photoProblem, priceCheck } from "./receipt-checks";

const money = (v: number) => `${v.toFixed(2).replace(".", ",")} €`;

describe("recepción blindada", () => {
  it("compara lo cobrado con lo pactado", () => {
    const up = priceCheck("71.50", "70.20")!;
    expect(up.status).toBe("sube");
    expect(up.diff.toString()).toBe("1.3");
    expect(describeDiff(up, money)).toBe("+1,30 € (+1,9 %)");
    expect(priceCheck("68", "70")!.status).toBe("baja");
    expect(describeDiff(priceCheck("68", "70")!, money)).toBe("−2,00 € (−2,9 %)");
    expect(priceCheck("70.204", "70.20")!.status).toBe("igual");
  });

  it("sin precio pactado o con un precio no válido no compara", () => {
    expect(priceCheck("10", null)).toBeNull();
    expect(priceCheck("", "10")).toBeNull();
    expect(priceCheck("abc", "10")).toBeNull();
    expect(priceCheck("-1", "10")).toBeNull();
    expect(priceCheck("5", "0")!.pct).toBeNull();
  });

  it("incidencias conocidas", () => {
    expect(isIncident("roto")).toBe(true);
    expect(isIncident("perdido")).toBe(false);
  });

  it("foto: tipo, tamaño y ruta en su carpeta", () => {
    expect(photoProblem({ size: 1000, type: "image/jpeg" })).toBeNull();
    expect(photoProblem({ size: 1000, type: "image/gif" })).toMatch(/JPG/);
    expect(photoProblem({ size: 11 * 1024 * 1024, type: "application/pdf" })).toMatch(/10 MB/);
    expect(photoPath("org", "loc", "rec", "Foto Albarán.JPEG")).toMatch(/^org\/loc\/rec\/albaran-\d+\.jpeg$/);
    expect(photoPath("org", "loc", "rec", "sin-extension")).toMatch(/\.jpg$/);
  });
});
