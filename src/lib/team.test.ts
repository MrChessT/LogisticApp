import { describe, expect, it } from "vitest";
import { assignableRoles, managesTeam, safeNext, seesAllLocations, teamErrorMessage } from "./team";

describe("equipo", () => {
  it("cada rol solo ofrece los roles que la base de datos le deja dar", () => {
    expect(assignableRoles("owner")).toEqual(["owner", "admin", "manager", "staff"]);
    expect(assignableRoles("admin")).toEqual(["manager", "staff"]);
    expect(assignableRoles("manager")).toEqual(["staff"]);
    expect(assignableRoles("staff")).toEqual([]);
    expect(assignableRoles(null)).toEqual([]);
  });

  it("el personal no gestiona equipo y solo la administración ve todos los locales", () => {
    expect([managesTeam("owner"), managesTeam("admin"), managesTeam("manager"), managesTeam("staff")]).toEqual([true, true, true, false]);
    expect([seesAllLocations("owner"), seesAllLocations("admin"), seesAllLocations("manager"), seesAllLocations("staff")]).toEqual([true, true, false, false]);
  });

  it("traduce los errores de la base de datos", () => {
    expect(teamErrorMessage({ message: "location_forbidden" })).toBe("Solo puedes dar acceso a los locales que llevas tú.");
    expect(teamErrorMessage({ message: "self" })).toMatch(/propio acceso/);
    expect(teamErrorMessage({ message: "algo raro" }, "Otro")).toBe("Otro");
  });

  it("los enlaces de acceso solo llevan a rutas de la propia app", () => {
    expect(safeNext("/cuenta?bienvenida=1")).toBe("/cuenta?bienvenida=1");
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("/\\evil.com")).toBe("/");
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});
