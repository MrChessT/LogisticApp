import { describe, expect, it } from "vitest";
import { PAGE_SIZE, readAll } from "./read-all";

describe("readAll", () => {
  it("una sola petición si caben en una página", async () => {
    const ranges: Array<[number, number]> = [];
    const result = await readAll(async (from, to) => {
      ranges.push([from, to]);
      return { data: [1, 2, 3], error: null };
    });
    expect(result).toEqual({ data: [1, 2, 3], error: null });
    expect(ranges).toEqual([[0, PAGE_SIZE - 1]]);
  });

  it("sigue pidiendo mientras la página venga llena", async () => {
    const ranges: Array<[number, number]> = [];
    const result = await readAll(async (from, to) => {
      ranges.push([from, to]);
      return { data: Array.from({ length: from === 0 ? PAGE_SIZE : 5 }, (_, i) => from + i), error: null };
    });
    expect(result.data).toHaveLength(PAGE_SIZE + 5);
    expect(ranges).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, 2 * PAGE_SIZE - 1],
    ]);
  });

  it("devuelve el error sin datos a medias", async () => {
    const result = await readAll(async (from) => (from === 0 ? { data: Array(PAGE_SIZE).fill(0), error: null } : { data: null, error: { message: "caído" } }));
    expect(result).toEqual({ data: null, error: { message: "caído" } });
  });
});
