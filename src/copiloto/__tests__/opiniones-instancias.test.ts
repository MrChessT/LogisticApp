// En producción cada mensaje puede llegar a otra instancia: la sesión (y la aclaración abierta) se lee
// de la base de datos, en JSON. Lo que funciona en memoria tiene que funcionar también así.
import { describe, expect, it } from "vitest";
import type { NewProductDraft } from "../contract/index";
import { SessionStore, type SerializedSession, type SessionPersistence } from "../agent/session";
import { LruCache } from "../cache/lru";
import { Agent } from "../agent/loop";
import { chat, FakeJev, find, makeAgent, run, type Script } from "./helpers";

class JsonPersistence implements SessionPersistence {
  readonly rows = new Map<string, string>();
  async load(id: string) {
    const raw = this.rows.get(id);
    return raw ? (JSON.parse(raw) as SerializedSession) : null;
  }
  async save(id: string, _org: string, session: SerializedSession) {
    this.rows.set(id, JSON.stringify(session));
  }
}

const route = (tipo: string): Script => ({ intent: "proponer_accion", intent_alt: "cambiar", tipo_accion: tipo });

/** El mismo agente, pero cada petición con una caché vacía (otra instancia) y la sesión guardada en JSON. */
function newInstance(jev: FakeJev, persistence: JsonPersistence): Agent {
  const { agent } = makeAgent(jev, null, { fastPath: true });
  const deps = (agent as unknown as { deps: { sessions: SessionStore } }).deps;
  deps.sessions = new SessionStore(persistence, new LruCache(10, 60_000));
  return agent;
}

describe("aclaraciones entre instancias (sesión guardada en la base de datos)", () => {
  it("«crea un nuevo producto» → nombre escrito en otra instancia: sale el borrador, sin bucle", async () => {
    const jev = new FakeJev([route("nuevo_producto"), { coherencia: 0.95, tiene_sentido: 0.97, categoria: "Refrescos", medida: "count" }]);
    const persistence = new JsonPersistence();
    const ask = find(await run(newInstance(jev, persistence), chat("crea un nuevo producto")), "clarify")!;
    expect(ask.field).toBe("nombre");
    const events = await run(newInstance(jev, persistence), chat("Coca Cola Zero Zero", { clarification: { clarifyId: ask.clarifyId, optionId: "otra", freeText: "Coca Cola Zero Zero" } }));
    expect(find(events, "clarify")).toBeUndefined();
    expect((find(events, "draft") as NewProductDraft).name).toBe("Coca Cola Zero Zero");
  });
});

describe("opinión 2026-10-16 (Oskar): el nombre no se pierde aunque se pierda la sesión", () => {
  it("si la aclaración ya no está, el nombre escrito retoma el alta (no «¿Qué quieres hacer?»)", async () => {
    // Sin la aclaración hay que volver a enrutar (2ª llamada) y después revisar el borrador (3ª).
    const jev = new FakeJev([route("nuevo_producto"), {}, { coherencia: 0.95, tiene_sentido: 0.97, categoria: "Refrescos", medida: "count" }]);
    const ask = find(await run(newInstance(jev, new JsonPersistence()), chat("crea un nuevo producto")), "clarify")!;
    // Otra instancia SIN la sesión guardada (falló al guardarse o caducó).
    const events = await run(newInstance(jev, new JsonPersistence()), chat("Fanta Limón 33 cl", { clarification: { clarifyId: ask.clarifyId, optionId: "otra", freeText: "Fanta Limón 33 cl", field: "nombre" } }));
    expect((find(events, "draft") as NewProductDraft | undefined)?.name).toBe("Fanta Limón 33 cl");
  });
});
