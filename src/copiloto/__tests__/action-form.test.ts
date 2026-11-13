// Miniformulario: con la operación clara y dos datos o más por saber, se piden juntos. Al enviarlo, el
// servidor valida cada campo y sale el borrador de siempre (que hay que confirmar).
import { describe, expect, it } from "vitest";
import type { WasteDraft } from "../contract/index";
import { readForm } from "../agent/action-form";
import { fixtureContext } from "../dev/fixture";
import { chat, FakeJev, find, makeAgent, run, type Script } from "./helpers";

const route = (tipo: string, extra: Script = {}): Script => ({ intent: "proponer_accion", intent_alt: "cambiar", tipo_accion: tipo, ...extra });
const ctx = fixtureContext();

describe("cuándo sale", () => {
  it("«registra una merma»: local, producto, cantidad y motivo, sin nada rellenado", async () => {
    const form = find(await run(makeAgent(new FakeJev([route("merma")])).agent, chat("registra una merma")), "form")!;
    expect(form).toMatchObject({ accion: "merma", title: "Registrar merma" });
    expect(form.fields.map((f) => [f.key, f.kind, f.required])).toEqual([
      ["local", "select", true],
      ["producto", "product", true],
      ["cantidad", "text", true],
      ["motivo", "select", false],
    ]);
    expect(form.fields[0]!.options!.map((o) => o.label)).toEqual(ctx.locations.map((l) => l.name));
  });

  it("lo entendido viene puesto: «merma en el Parador» rellena el local", async () => {
    const form = find(await run(makeAgent(new FakeJev([route("merma", { local: "Parador" })])).agent, chat("merma en el Parador")), "form")!;
    expect(form.fields.find((f) => f.key === "local")!.value).toBe("Parador");
  });

  it("con un solo dato por saber sigue siendo una pregunta", async () => {
    const jev = new FakeJev([route("merma", { producto_0: "Ron Barceló Añejo 70 cl", cantidad_ok_0: 0.95 })]);
    const events = await run(makeAgent(jev).agent, chat("merma de 2 botellas de barceló"));
    expect(find(events, "form")).toBeUndefined();
    expect(find(events, "clarify")!.field).toBe("local");
  });
});

describe("al enviarlo", () => {
  it("merma completa: borrador con producto, cantidad, local y motivo", async () => {
    const jev = new FakeJev([route("merma"), { cantidad_ok_0: 0.95 }, { coherencia: 0.95 }]);
    const { agent } = makeAgent(jev);
    await run(agent, chat("registra una merma"));
    const events = await run(agent, chat("Merma", { form: { accion: "merma", values: { local: "Vivero", producto: "Ron Barceló Añejo 70 cl", cantidad: "2 botellas", motivo: "rotura" } } }));
    const draft = find(events, "draft") as WasteDraft;
    expect(draft).toMatchObject({ kind: "merma", locationName: "Vivero", productName: "Ron Barceló Añejo 70 cl", qtyBase: "1400" });
    // Las decisiones van fijadas: Jev no tiene que volver a adivinar local, producto ni motivo.
    expect((jev.calls[1]!.state as { message: string }).message).toBe("merma de 2 botellas de Ron Barceló Añejo 70 cl en Vivero por rotura");
  });

  it("valida cada campo y dice qué corregir", () => {
    expect(readForm({ accion: "merma", values: { local: "Madrid", producto: "x", cantidad: "2" } }, ctx)).toEqual({ error: "Elige el local en el formulario." });
    expect(readForm({ accion: "traspaso", values: { local: "Parador", destino: "Parador", producto: "x", cantidad: "2" } }, ctx)).toEqual({ error: "Elige a qué local va (distinto del de salida)." });
    expect(readForm({ accion: "merma", values: { local: "Parador", producto: "", cantidad: "2" } }, ctx)).toEqual({ error: "Escribe el producto." });
    expect(readForm({ accion: "merma", values: { local: "Parador", producto: "x", cantidad: "unas pocas" } }, ctx)).toEqual({ error: "Escribe la cantidad con una cifra, por ejemplo «3 botellas»." });
  });

  it("un nombre exacto del catálogo fija el producto; uno escrito a mano lo decide Jev", () => {
    const exact = readForm({ accion: "recepcion", values: { local: "parador", producto: "coca-cola 20 cl", cantidad: "3 cajas" } }, ctx);
    expect(exact).toMatchObject({ message: "han llegado 3 cajas de Coca-Cola 20 cl a Parador", overrides: { tipo_accion: "recepcion", local: "Parador", producto_0: "Coca-Cola 20 cl" } });
    const typed = readForm({ accion: "recepcion", values: { local: "Parador", producto: "cocacola", cantidad: "3 cajas" } }, ctx);
    expect("overrides" in typed && typed.overrides.producto_0).toBeFalsy();
  });
});

describe("producto ambiguo sin preguntar aún por él (batería en producción)", () => {
  it("«merma de 2 botellas de ron» sin local: desplegable con los rones y la cantidad ya puesta", async () => {
    const form = find(await run(makeAgent(new FakeJev([route("merma", { producto_0: "varios" })])).agent, chat("merma de 2 botellas de ron")), "form")!;
    const product = form.fields.find((f) => f.key === "producto")!;
    expect(product.kind).toBe("select");
    expect(product.options!.map((o) => o.label).sort()).toEqual(["Ron Barceló Añejo 70 cl", "Ron Brugal Añejo 70 cl"]);
    expect(form.fields.find((f) => f.key === "cantidad")!.value).toBe("2 botellas");
  });
});
