import { describe, expect, it } from "vitest";
import { fixtureContext } from "../dev/fixture";
import { continueTask, resumeTask, settleTask, type PendingTask } from "./task-in-progress";

const ctx = fixtureContext();
const NOW = 1_000_000;
const merma: PendingTask = { accion: "merma", at: NOW };
const traspaso: PendingTask = { accion: "traspaso", at: NOW };

function step(task: PendingTask, text: string) {
  const s = continueTask(task, text, ctx, NOW + 1000);
  if (s.kind !== "continue") throw new Error(`esperaba continuar, salió ${s.kind}`);
  return s;
}

describe("operación a medias tras el miniformulario", () => {
  it("merma por pasos: «larios» → «2 botellas» → «en el vivero» arman la merma completa", () => {
    const a = step(merma, "larios");
    expect(a.message).toBe("merma de larios");
    expect(a.missing).toEqual(["local", "cantidad"]);
    const b = step(a.task, "2 botellas");
    expect(b.message).toBe("merma de 2 botellas de larios");
    const c = step(b.task, "en el vivero");
    expect(c.message).toBe("merma de 2 botellas de larios en Vivero");
    expect(c.overrides).toMatchObject({ intent: "proponer_accion", tipo_accion: "merma", local: "Vivero" });
    expect(c.missing).toEqual([]);
  });

  it("traspaso por pasos: los locales por su papel y luego lo que se mueve", () => {
    const a = step(traspaso, "del parador al vivero");
    expect(a.overrides).toMatchObject({ local: "Parador", local_destino: "Vivero" });
    const b = step(a.task, "4 cajas de cocacola");
    expect(b.message).toBe("traspaso de 4 cajas de cocacola desde Parador a Vivero");
    expect(b.missing).toEqual([]);
  });

  it("al revés también: «al vivero desde el parador», y un local suelto rellena el que falte", () => {
    expect(step(traspaso, "al vivero desde el parador").overrides).toMatchObject({ local: "Parador", local_destino: "Vivero" });
    const a = step({ ...traspaso, local: "Parador" }, "vivero");
    expect(a.overrides).toMatchObject({ local: "Parador", local_destino: "Vivero" });
  });

  it("erratas en el local («pardor») y el motivo de la merma («se cayeron»)", () => {
    const a = step(merma, "se cayeron 3 en el pardor");
    expect(a.task).toMatchObject({ local: "Parador", motivo: "rotura", cantidad: "3" });
    expect(a.overrides.motivo_merma).toBe("rotura");
  });

  it("cancelar, preguntar otra cosa u otra operación no completan la merma", () => {
    expect(continueTask(merma, "olvídalo", ctx, NOW).kind).toBe("cancel");
    expect(continueTask(merma, "¿cuánto ron queda en el Parador?", ctx, NOW).kind).toBe("other");
    expect(continueTask(merma, "cuanto ron queda", ctx, NOW).kind).toBe("other");
    expect(continueTask(merma, "mejor haz un traspaso", ctx, NOW).kind).toBe("other");
    expect(continueTask(merma, "hola", ctx, NOW).kind).toBe("continue");
  });

  it("caduca: pasado un rato, lo escrito es un mensaje nuevo", () => {
    const session = { task: merma };
    expect(resumeTask(session, "larios", ctx, NOW + 21 * 60 * 1000)).toBeNull();
    expect(session.task).toBeUndefined();
  });

  it("un borrador o una consulta cierran la operación; otro formulario o una pregunta la mantienen", () => {
    const session: { task?: PendingTask } = { task: merma };
    settleTask(session, { kind: "tarea", tarea: "formulario" });
    expect(session.task).toBeDefined();
    settleTask(session, { kind: "aclaracion" });
    expect(session.task).toBeDefined();
    settleTask(session, { kind: "borrador" });
    expect(session.task).toBeUndefined();
  });
});

describe("texto del formulario", () => {
  it("dice lo apuntado y lo que falta; sin nada apuntado, el de siempre", async () => {
    const { taskPrompt } = await import("./task-in-progress");
    expect(taskPrompt({ accion: "merma", producto: "larios", at: NOW })).toBe("Llevo apuntado: merma de larios. Me falta saber en qué local y cuánto: rellénalo aquí o escríbemelo.");
    expect(taskPrompt({ accion: "traspaso", local: "Parador", destino: "Vivero", at: NOW })).toBe("Llevo apuntado: traspaso desde Parador a Vivero. Me falta saber qué producto y cuánto: rellénalo aquí o escríbemelo.");
    expect(taskPrompt({ accion: "merma", at: NOW })).toBe("Me faltan unos datos: rellénalos aquí y te preparo el borrador.");
  });
});
