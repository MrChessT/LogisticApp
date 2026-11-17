// Foco de la conversación: de qué se estaba hablando (productos, locales, periodo o un borrador
// pendiente), para heredar en el siguiente mensaje lo que no diga.
import type { Draft } from "../contract/index";
import type { Plan } from "./plans";
import type { ReportOutcome } from "./report";
import type { Focus } from "./session";

/** Productos y locales que menciona un borrador (para heredarlos en el siguiente mensaje). */
function draftRefs(draft: Draft): { locationIds: string[]; productIds: string[] } {
  const d = draft as unknown as Record<string, unknown>;
  const locationIds = [d.locationId, d.fromLocationId].filter((v): v is string => typeof v === "string");
  const lines = (Array.isArray(d.lines) ? d.lines : Array.isArray(d.orders) ? (d.orders as Array<{ lines: unknown[] }>).flatMap((o) => o.lines) : []) as Array<{ productId?: string }>;
  const productIds = [d.productId, ...lines.map((l) => l.productId)].filter((v): v is string => typeof v === "string");
  return { locationIds, productIds: [...new Set(productIds)] };
}

/** Foco tras responder: lo consultado o propuesto. Aclaraciones y charla no lo cambian. */
export function nextFocus(plan: Plan, outcome: ReportOutcome, previous: Focus | undefined, now: number): Focus | undefined {
  if (outcome.kind === "consulta" && plan.type === "consultar") {
    return {
      kind: "consulta",
      tool: plan.tool,
      locationIds: plan.locationsDefaulted ? [] : plan.locationIds,
      productIds: plan.products.map((p) => p.product.id),
      ...(plan.familia ? { familia: plan.familia } : {}),
      periodo: plan.periodo,
      at: now,
    };
  }
  // Un tema de información (lista de proveedores, ventas…) deja su herramienta: la pregunta siguiente («¿cuál es
  // el que menos información tiene?») se refiere a ella.
  if (outcome.kind === "tarea" && plan.type === "info") {
    return { kind: "consulta", tool: plan.tool, locationIds: [], productIds: [], periodo: "no_indicado", at: now };
  }
  if (outcome.kind === "resuelto") {
    // El borrador ya no está pendiente; el tema sigue siendo lo que trataba.
    if (!previous) return undefined;
    const { draftId: _draftId, draftTitle: _draftTitle, ...rest } = previous;
    void _draftId;
    void _draftTitle;
    return { ...rest, at: now };
  }
  if (outcome.kind === "borrador") {
    return {
      kind: "borrador",
      accion: outcome.draft.kind,
      ...draftRefs(outcome.draft),
      periodo: "no_indicado",
      draftId: outcome.draft.draftId,
      draftTitle: outcome.draft.title,
      at: now,
    };
  }
  // Tras una aclaración, una navegación o una charla, lo anterior sigue siendo el tema.
  return previous ? { ...previous, at: previous.at } : undefined;
}
