import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FixtureWriter } from "../dev/fixture-writer";
import { markTest, writerFor } from "../drafts/test-mode";
import { SupabaseInventoryWriter } from "../drafts/writer-port";

const db = {} as SupabaseClient;
const ok = { ok: true as const, kind: "merma" as const, documentId: "d1", movementIds: ["7"], message: "Merma registrada.", navigate: { route: "/mermas" as const, filters: {}, auto: false } };

describe("modo pruebas del asistente", () => {
  it("usa la escritura simulada solo en modo pruebas", () => {
    expect(writerFor({ testMode: true }, db)).toBeInstanceOf(FixtureWriter);
    expect(writerFor({ testMode: false }, db)).toBeInstanceOf(SupabaseInventoryWriter);
    expect(writerFor({}, db)).toBeInstanceOf(SupabaseInventoryWriter);
  });

  it("avisa de que no se ha guardado y no enlaza al documento", () => {
    const marked = markTest(ok, { testMode: true });
    expect(marked).toMatchObject({ ok: true, documentId: null, movementIds: [], navigate: undefined });
    expect(marked.message).toBe("Merma registrada. (Modo pruebas: no se ha guardado nada.)");
  });

  it("no toca los resultados reales ni los errores", () => {
    expect(markTest(ok, { testMode: false })).toBe(ok);
    const failed = { ok: false as const, code: "forbidden" as const, message: "No" };
    expect(markTest(failed, { testMode: true })).toBe(failed);
  });
});
