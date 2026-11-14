import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("separador punto y coma (Excel en español)", () => {
    expect(parseCsv("Producto;Precio\nCoca-Cola;1,20\n")).toEqual([["Producto", "Precio"], ["Coca-Cola", "1,20"]]);
  });

  it("coma, tabulador y comillas con comas y saltos dentro", () => {
    expect(parseCsv('a,b\n"x, y",2\n')).toEqual([["a", "b"], ["x, y", "2"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv('a;b\n"línea\ndos";"di ""hola"""')).toEqual([["a", "b"], ["línea\ndos", 'di "hola"']]);
  });

  it("sin BOM, sin filas vacías y con CRLF", () => {
    expect(parseCsv("﻿a;b\r\n\r\n1;2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
});
