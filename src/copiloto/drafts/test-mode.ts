// Modo pruebas del asistente (memberships.assistant_test, migración 0025): se puede probar todo con los
// datos reales, pero lo que se confirma no se guarda. Solo afecta al asistente.
import type { SupabaseClient } from "@supabase/supabase-js";
import { FixtureWriter } from "../dev/fixture-writer";
import type { SessionContext } from "../domain";
import type { ConfirmResponse } from "./confirm";
import { SupabaseInventoryWriter, type InventoryWriter } from "./writer-port";

/** En modo pruebas, una escritura simulada (registra las llamadas y no toca la base de datos). */
export function writerFor(ctx: Pick<SessionContext, "testMode">, db: SupabaseClient): InventoryWriter {
  return ctx.testMode ? new FixtureWriter() : new SupabaseInventoryWriter(db);
}

/** El resultado lo dice y no enlaza a un documento que no existe. */
export function markTest(result: ConfirmResponse, ctx: Pick<SessionContext, "testMode">): ConfirmResponse {
  if (!ctx.testMode || !result.ok) return result;
  return { ...result, navigate: undefined, documentId: null, movementIds: [], message: `${result.message} (Modo pruebas: no se ha guardado nada.)` };
}
