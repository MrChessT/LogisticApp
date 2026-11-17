// Un borrador que ya se confirmó (con el botón), se descartó o caducó deja de ser el foco de la conversación:
// «sí, adelante» ya no puede referirse a él.
import type { SessionContext } from "../domain";
import type { DraftStore } from "../drafts/store";
import type { Session } from "./session";

export async function dropStaleDraft(session: Session, ctx: SessionContext, drafts: DraftStore, now: Date): Promise<void> {
  const draftId = session.focus?.draftId;
  if (!draftId || !session.focus) return;
  const stored = await drafts.get(draftId, ctx.userId, ctx.orgId).catch(() => undefined);
  if (stored && stored.status === "pendiente" && new Date(stored.draft.expiresAt).getTime() >= now.getTime()) return;
  const { draftId: _draftId, draftTitle: _draftTitle, ...rest } = session.focus;
  void _draftId;
  void _draftTitle;
  session.focus = rest;
}
