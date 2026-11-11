import { describe, expect, it } from "vitest";
import { COMMANDS, localCommandOf, matchCommands } from "./assistant-home";

describe("comandos del asistente", () => {
  it("«/» lista todos; lo escrito filtra por nombre y luego por lo que hacen", () => {
    expect(matchCommands("/")).toHaveLength(COMMANDS.length);
    expect(matchCommands("/fi").map((c) => c.name)[0]).toBe("ficha");
    expect(matchCommands("/pre").map((c) => c.name).slice(0, 2)).toEqual(["preparar", "precios"]);
    expect(matchCommands("/albaran").map((c) => c.name)).toContain("foto");
    expect(matchCommands("hola")).toEqual([]);
    // Con espacio ya se está escribiendo el argumento («/ficha tónica»): sin lista.
    expect(matchCommands("/ficha tónica")).toEqual([]);
  });

  it("los comandos del panel se reconocen escritos enteros", () => {
    expect(localCommandOf("/ayuda")).toBe("ayuda");
    expect(localCommandOf(" /Nueva ")).toBe("nueva");
    expect(localCommandOf("/parte")).toBeNull();
    expect(localCommandOf("/ayuda con stock")).toBeNull();
  });
});
