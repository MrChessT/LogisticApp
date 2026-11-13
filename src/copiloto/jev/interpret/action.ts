// Operaciones de stock (merma, traspaso, recepción, inventario): operación, locales, productos y
// cantidades, cada dato con su umbral. Las de catálogo y documentos están en documents.ts.
import type { GateOutcome } from "../../contract/index";
import { asNoul, gateChoice, gateNoulNo, type RankedOption } from "../gates/gate";
import { label, NO_APLICA, NO_INDICADO, TODOS, type Accion, type MotivoMerma } from "../catalog";
import { mentionsWaste, venueRoles } from "../../entities/signals";
import { relevant, type ContextKey } from "../gates/policy";
import { operationOf } from "../../agent/free-text";
import { CATALOG_ACCIONES, DOCUMENT_ACCIONES, type CatalogAccion, type DocumentAccion, type Plan } from "../../agent/plans";
import { locationLabel, type JevReading } from "./reading";
import { catalogAction, documentAction } from "./documents";
import { resolveProducts } from "./products";

/** ¿Jev está seguro de una operación concreta (no «ninguna»)? Nunca para cerrar inventario. */
export function actionCorroborates(r: JevReading): boolean {
  const answer = r.choice("tipo_accion");
  if (!answer || answer.choice === "ninguna" || answer.choice === "cierre_inventario") return false;
  return gateChoice(answer, r.thresholds.tipo_accion).outcome === "actuar";
}

/**
 * Merma o traspaso («tírame 1 bolsa de hielo del parador»: merma 0,71, traspaso 0,29): un traspaso
 * necesita un local de destino distinto del de origen. Si Jev está seguro de que no se nombra ninguno
 * y ya se inclina por la merma, es merma; si nombra otro local y se inclina por el traspaso, traspaso.
 * Si no, null (se pregunta como siempre).
 */
function wasteOrTransfer(r: JevReading, ranked: RankedOption[]): "merma" | "traspaso" | null {
  const [first, second] = ranked;
  if (!first || !second) return null;
  const pair = new Set([first.option, second.option]);
  if (!pair.has("merma") || !pair.has("traspaso") || first.probability + second.probability < 0.85) return null;
  const dest = r.choice("local_destino");
  if (!dest) return null;
  const p = (dest.probabilities as Record<string, number>)[dest.choice] ?? 0;
  const origin = r.choice("local")?.choice;
  const sure = p >= r.thresholds.local_borrador.act;
  // «caducaron 3 packs de agua en la oliva»: un «destino» igual al origen es que no hay destino.
  const otherVenue = sure && r.meta.locationKeys.has(dest.choice) && dest.choice !== origin;
  const noDestination = (sure && dest.choice === NO_APLICA) || dest.choice === origin;
  const waste = !!r.meta.message && mentionsWaste(r.meta.message);
  // Solo confirma hacia donde Jev ya se inclina: «quita 6 cocas del vivero» (merma 0,55, traspaso
  // 0,40, sin palabras de merma) sigue siendo dudoso aunque no diga destino, y se pregunta.
  if (first.option === "merma" && !otherVenue && (waste || (noDestination && first.probability >= 0.65))) return "merma";
  return first.option === "traspaso" && otherVenue ? "traspaso" : null;
}

export function action(r: JevReading): Plan {
  const accionAnswer = r.choice("tipo_accion");
  const spec = accionAnswer?.choice === "cierre_inventario" ? r.thresholds.cierre_inventario : r.thresholds.tipo_accion;
  const g = r.gate("tipo_accion", "Operación", spec);
  let chosen = g && g.outcome === "actuar" && g.choice !== "ninguna" ? g.choice : null;
  // La frase nombra la operación y Jev la pone primera («prepárame el pedido para el parador»: pedido 0,55):
  // es esa. Solo prepara un borrador, que hay que confirmar. Nunca para cerrar inventario.
  const named = r.meta.message ? operationOf(r.meta.message) : null;
  if (g && !chosen && named && g.ranked[0]?.option === named && g.probability >= 0.45) {
    chosen = named;
    r.markActed("tipo_accion");
  }
  if (g && !chosen) {
    chosen = wasteOrTransfer(r, g.ranked);
    // Lo que se enseña en «Entendido» debe ser lo que se decidió.
    const decision = chosen ? r.decisions.find((d) => d.id === "tipo_accion") : undefined;
    if (decision && chosen) Object.assign(decision, { value: chosen, valueLabel: label(chosen), gate: "actuar" });
  }
  if (!chosen) {
    return r.clarify("tipo_accion", "¿Qué operación quieres registrar?", g?.ranked ?? [], ["ninguna"]);
  }
  if ((CATALOG_ACCIONES as readonly string[]).includes(chosen)) return catalogAction(r, chosen as CatalogAccion);
  if ((DOCUMENT_ACCIONES as readonly string[]).includes(chosen)) return documentAction(r, chosen as DocumentAccion);
  const accion = chosen as Exclude<Accion, "ninguna" | CatalogAccion | DocumentAccion>;
  const t = r.thresholds;
  const context: ContextKey = `accion:${accion}`;

  const area = r.readArea(context);
  const areaId = area.outcome === "actuar" ? area.id : null;
  const areaLocation = areaId ? r.ctx.areas.find((a) => a.id === areaId)?.locationId ?? null : null;
  const locationName = (key: string) => key;

  // Local de origen: donde se mueve el stock. Por debajo de ask → se pregunta.
  const locGate = r.gateSlot(context, "local", "local", "Local");
  let resolvedLocation = locGate ? r.meta.locationKeys.get(locGate.choice) ?? null : null;
  let locationOutcome: GateOutcome = resolvedLocation ? locGate!.outcome : "preguntar";
  // «pásame 4 tónicas del Pickels al Parador»: Jev duda entre los dos locales nombrados (0,65 / 0,35),
  // pero la preposición dice cuál es el origen. Si Jev ya lo pone primero, se confirma.
  const roles = accion === "traspaso" && r.meta.message ? venueRoles(r.meta.message, [...r.meta.locationKeys.keys()]) : null;
  if (roles && locGate && resolvedLocation && locationOutcome !== "actuar" && roles.origin === locGate.choice) {
    locationOutcome = "actuar";
    r.markActed("local");
  }
  // «pasa ron al Vivero»: el único local nombrado va con «al», es el destino. Jev lo ponía también de
  // origen (Vivero → Vivero) y se preguntaba el destino; la respuesta («Parador») acababa al revés.
  const namedDestination = roles?.destination ? r.meta.locationKeys.get(roles.destination) ?? null : null;
  if (accion === "traspaso" && namedDestination && !roles?.origin && resolvedLocation === namedDestination && r.overrides.local === undefined) {
    resolvedLocation = null;
    locationOutcome = "preguntar";
  }
  if (!resolvedLocation && r.onlyLocation()) {
    resolvedLocation = r.onlyLocation();
    locationOutcome = "actuar";
  } else if (!resolvedLocation && areaLocation) {
    resolvedLocation = areaLocation;
    locationOutcome = "actuar";
  } else if (!resolvedLocation && r.pageLocationId) {
    resolvedLocation = r.pageLocationId;
    locationOutcome = "confirmar";
  }
  // Sin local claro se pregunta; el habitual solo se ofrece como primera opción.
  if (!resolvedLocation || locationOutcome === "preguntar") {
    const question = accion === "traspaso" ? (namedDestination ? `¿Desde qué local sale la mercancía hacia ${locationLabel(r.ctx, namedDestination)}?` : "¿Desde qué local sale la mercancía?") : "¿En qué local?";
    const options = r.locationOptions(locGate?.ranked ?? []).filter((o) => !namedDestination || r.meta.locationKeys.get(o.option) !== namedDestination);
    return r.clarify("local", question, options, [TODOS, NO_INDICADO], locationName);
  }

  let toLocationId: string | null = null;
  let toLocationOutcome: GateOutcome = "actuar";
  if (accion === "traspaso") {
    const toGate = r.gateSlot(context, "local_destino", "local_destino", "Local destino");
    toLocationId = toGate && toGate.choice !== NO_APLICA ? r.meta.locationKeys.get(toGate.choice) ?? null : null;
    toLocationOutcome = toLocationId && toLocationId !== resolvedLocation ? toGate!.outcome : "preguntar";
    // El destino dicho con «al/a» manda si Jev no da otro distinto del origen.
    if (toLocationOutcome === "preguntar" && namedDestination && namedDestination !== resolvedLocation) {
      toLocationId = namedDestination;
      toLocationOutcome = "actuar";
    }
    if (roles && toGate && toLocationOutcome === "confirmar" && roles.destination === toGate.choice) {
      toLocationOutcome = "actuar";
      r.markActed("local_destino");
    }
    if (toLocationOutcome === "preguntar") {
      const ranked = (toGate?.ranked ?? []).filter((o) => r.meta.locationKeys.get(o.option) !== resolvedLocation);
      return r.clarify("local_destino", "¿A qué local va la mercancía?", ranked, [NO_APLICA], locationName);
    }
  }

  const products = resolveProducts(r, context, true);
  if ("type" in products) return products;
  if (products.length === 0 && relevant(context, "producto")) {
    return { type: "clarify", field: "producto", question: "¿Qué producto y qué cantidad?", options: [] };
  }
  for (const p of products) {
    if (relevant(context, "cantidad") && (p.amount === null || p.quantityOutcome === "preguntar")) {
      const options = p.amount !== null ? [{ id: "si", label: `Sí, ${p.amount} ${p.unit ?? ""}${p.loose ? ` y ${p.loose} sueltas` : ""}`.trim(), probability: null }] : [];
      return { type: "clarify", field: "cantidad", question: `¿Qué cantidad de ${p.product.name}?`, options, segmentIndex: p.segmentIndex };
    }
  }

  // Mucha ambigüedad percibida. Si algún dato era dudoso, se pide repetir la orden. Si todos estaban
  // claros (operación, locales, productos y cantidades), una pregunta genérica no ayuda: se prepara
  // el borrador con un aviso (nada se ejecuta sin confirmarlo) y el formato, si falta, se pregunta aparte.
  const ambiguo = asNoul(r.answers.ambiguo);
  const allClear =
    locationOutcome === "actuar" &&
    toLocationOutcome === "actuar" &&
    products.every((p) => (p.productOutcome ?? "actuar") === "actuar" && (p.quantityOutcome ?? "actuar") === "actuar");
  const tooAmbiguous = !!ambiguo && accion !== "cierre_inventario" && Object.keys(r.overrides).length === 0 && gateNoulNo(ambiguo, t.ambiguo) === "preguntar";
  if (tooAmbiguous && !allClear) {
    return {
      type: "clarify",
      field: "tipo_accion",
      question: "No tengo claro qué quieres registrar. ¿Puedes indicarme la operación, el producto, la cantidad y el local?",
      options: [],
      restart: true,
    };
  }

  const motivo = (relevant(context, "motivo") ? r.choice("motivo_merma")?.choice ?? NO_INDICADO : NO_INDICADO) as MotivoMerma;
  const ambiguous = asNoul(r.answers.ambiguo)?.noul ?? 0;
  return {
    type: "accion",
    accion,
    locationId: resolvedLocation,
    locationOutcome,
    toLocationId,
    toLocationOutcome,
    areaId: areaId && areaLocation === resolvedLocation ? areaId : null,
    products,
    motivo,
    ambiguous,
    ...(tooAmbiguous ? { reviewAll: true } : {}),
  };
}
