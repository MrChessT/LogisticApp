import { describe, expect, it } from "vitest";
import type { Plan } from "../agent/plans";
import { especialistaDe } from "./mapa";
import { fueraDeAlcance } from "./puerta";
import { ESPECIALISTAS, permitido, REGISTRO } from "./registro";

const consulta = (tool: string) => ({ type: "consultar", tool, locationIds: [], locationsDefaulted: true, areaId: null, products: [], periodo: "no_indicado" }) as unknown as Plan;
const info = (tool: string) => ({ type: "info", tool, locationIds: [], locationsDefaulted: true, products: [], periodo: "no_indicado" }) as unknown as Plan;

describe("registro de especialistas", () => {
  it("cada especialista tiene manifiesto con su mismo id, descripción y ejemplos", () => {
    for (const id of ESPECIALISTAS) {
      expect(REGISTRO[id].id).toBe(id);
      expect(REGISTRO[id].descripcion.length).toBeGreaterThan(10);
      expect(REGISTRO[id].ejemplos.length).toBeGreaterThan(0);
    }
  });

  it("el mismo permiso que el menú: ventas y facturas para encargados con costes, equipo para encargados", () => {
    const personal = { role: "staff" as const, seesCosts: false };
    const cocina = { role: "staff" as const, seesCosts: true };
    const encargado = { role: "manager" as const, seesCosts: true };
    expect(permitido(REGISTRO.almacen, personal)).toBe(true);
    expect(permitido(REGISTRO.facturas, cocina)).toBe(false);
    expect(permitido(REGISTRO.facturas, encargado)).toBe(true);
    expect(permitido(REGISTRO.informes, cocina)).toBe(true);
    expect(permitido(REGISTRO.informes, personal)).toBe(false);
    expect(permitido(REGISTRO.equipo, cocina)).toBe(false);
  });
});

describe("mapa de planes", () => {
  it("cada consulta va a su especialista", () => {
    expect(especialistaDe(consulta("query_stock"))).toBe("almacen");
    expect(especialistaDe(info("query_invoices"))).toBe("facturas");
    expect(especialistaDe(info("query_sales"))).toBe("ventas");
    expect(especialistaDe(consulta("query_overview"))).toBe("informes");
  });

  it("acciones, órdenes de oficina y tareas", () => {
    expect(especialistaDe({ type: "catalogo", accion: "archivar_producto", locationId: null, locationOutcome: "actuar", products: [] })).toBe("catalogo");
    expect(especialistaDe({ type: "documento", accion: "asociar_proveedor", locationIds: [] })).toBe("compras");
    expect(especialistaDe({ type: "documento", accion: "pagar_factura", locationIds: [] })).toBe("facturas");
    expect(especialistaDe({ type: "tarea", tarea: "pedidos", locationIds: [] })).toBe("compras");
  });

  it("charla, aclaraciones y avisos son de conversación", () => {
    expect(especialistaDe({ type: "conversar" })).toBe("conversacion");
    expect(especialistaDe({ type: "aviso", text: "hola" })).toBe("conversacion");
  });
});

describe("puerta de permisos", () => {
  it("sin permiso, un aviso sin cifras en vez de la consulta", () => {
    const aviso = fueraDeAlcance(info("query_invoices"), { role: "staff", seesCosts: true });
    expect(aviso?.type).toBe("aviso");
    expect(aviso?.text).toMatch(/^Las facturas las ve la dirección/);
    expect(aviso?.text).not.toMatch(/\d/);
  });

  it("con permiso, nada que hacer", () => {
    expect(fueraDeAlcance(info("query_invoices"), { role: "owner", seesCosts: true })).toBeNull();
    expect(fueraDeAlcance(consulta("query_stock"), { role: "staff", seesCosts: false })).toBeNull();
  });

  it("sin «ve costes», el motivo lo dice", () => {
    expect(fueraDeAlcance(consulta("query_overview"), { role: "manager", seesCosts: false })?.text).toMatch(/«ve costes»/);
  });

  it("los borradores no pasan por la puerta: su constructor da el mensaje de la acción", () => {
    expect(fueraDeAlcance({ type: "documento", accion: "pagar_factura", locationIds: [] }, { role: "staff", seesCosts: false })).toBeNull();
  });

  it("cada especialista con requisito tiene su texto para quien no lo cumple", () => {
    for (const e of Object.values(REGISTRO)) if (e.requiere.rol || e.requiere.costes) expect(e.sinPermiso).toBeTruthy();
  });
});
