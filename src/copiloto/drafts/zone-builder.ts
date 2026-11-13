// Zona nueva desde el chat («crea la zona Terraza en el Vivero», «añade una cámara al Parador»). El tipo
// sale del nombre (barra, cocina, terraza → servicio; cámara, congelador, bodega → almacén) o se pregunta;
// el local, el nombrado, el de la página o se pregunta. Solo encargados; decide la base de datos.
import type { DocumentDraft } from "../contract/index";
import { hasRole, type SessionContext } from "../domain";
import { normalize } from "../entities/normalize";
import { namedLocations } from "../entities/signals";
import type { DocumentPlan } from "../agent/plans";
import { draftBase, type BuildResult } from "./builder";
import { validateDraft } from "./schemas";

type Kind = "almacen" | "servicio";
const SERVICE = /\b(barra|cocina|terraza|sala|comedor|servicio|office|pase|reservado|salon)\b/;
const STORE = /\b(almacen|camara|congelador|bodega|nevera|despensa|trastero|cuarto frio|economato|deposito)\b/;

/** El nombre de la zona en la frase: lo que sigue a «zona»/«sección» (o el sustantivo tras «añade una»). */
export function zoneName(message: string, locationNames: string[]): string | null {
  const cut = message.replace(/[«»"'“”]/g, "").trim();
  const m =
    /\b(?:zona|secci[oó]n|espacio)\s+(?:nueva\s+)?(?:llamada\s+|que se llame\s+|de nombre\s+)?(.+)$/i.exec(cut) ??
    /\b(?:crea|crear|cr[eé]ame|a[ñn]ade|a[ñn]adir|nueva|da de alta)\s+(?:una?\s+)?(?:nueva\s+)?(.+)$/i.exec(cut);
  if (!m) return null;
  let name = m[1]!;
  // Fuera el local y el tipo dichos detrás («… en el Vivero», «… de servicio»).
  for (const loc of locationNames) name = name.replace(new RegExp(`\\s+(?:en|del|de|al|a|para)\\s+(?:el\\s+|la\\s+)?${loc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*$`, "i"), "");
  name = name.replace(/\s+(?:de|como)\s+(?:servicio|almac[eé]n)\s*$/i, "").replace(/[.!]+$/, "").trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : null;
}

export async function newZone({ plan, message, ctx, overrides, now }: { plan: DocumentPlan; message: string; ctx: SessionContext; overrides: Record<string, string>; now: Date }): Promise<BuildResult> {
  if (!hasRole(ctx.role, "manager")) return { kind: "error", message: "Las zonas las crean los encargados y la administración." };
  const name = zoneName(message, ctx.locations.map((l) => l.name));
  if (!name) return { kind: "error", message: "Dime el nombre de la zona, por ejemplo «crea la zona Terraza en el Vivero»." };

  const chosenLocation = overrides.documento?.startsWith("local:") ? overrides.documento.slice(6) : undefined;
  const named = namedLocations(ctx.locations, message);
  const locationIds = chosenLocation ? [chosenLocation] : named.length > 0 ? named.map((l) => l.id) : plan.locationIds;
  if (locationIds.length !== 1) {
    return { kind: "clarify", plan: { type: "clarify", field: "documento", question: "¿En qué local?", options: ctx.locations.map((l) => ({ id: `local:${l.id}`, label: l.name, probability: null })) } };
  }
  const locationId = locationIds[0]!;
  const local = ctx.locations.find((l) => l.id === locationId)?.name ?? "el local";
  if (ctx.areas.some((a) => a.locationId === locationId && normalize(a.name) === normalize(name))) {
    return { kind: "error", message: `${local} ya tiene una zona «${name}».` };
  }

  const text = normalize(message);
  const said: Kind | undefined = overrides.documento?.startsWith("tipo:") ? (overrides.documento.slice(5) as Kind) : /\bde servicio\b/.test(text) ? "servicio" : /\bde almacen\b/.test(text) ? "almacen" : undefined;
  const kind: Kind | undefined = said ?? (SERVICE.test(normalize(name)) ? "servicio" : STORE.test(normalize(name)) ? "almacen" : undefined);
  if (!kind) {
    return {
      kind: "clarify",
      plan: {
        type: "clarify",
        field: "documento",
        question: `¿«${name}» es para guardar o para servir?`,
        options: [
          { id: "tipo:almacen", label: "Para guardar (almacén)", probability: null },
          { id: "tipo:servicio", label: "Para servir (barra, cocina)", probability: null },
        ],
      },
    };
  }

  const base = draftBase("documento", `Zona nueva en ${local}: ${name}`, ctx, [], now);
  const draft: DocumentDraft = {
    ...base,
    requiredRole: "manager",
    canConfirm: hasRole(ctx.role, "manager"),
    kind: "documento",
    operation: "crear_zona",
    documentId: locationId,
    locationId,
    summary: `${local} · ${kind === "servicio" ? "de servicio (se usa: barra, cocina…)" : "de almacén (se guarda)"}`,
    lines: [{ label: name, qty: kind === "servicio" ? "servicio" : "almacén" }],
    zone: { name, kind },
  };
  return { kind: "draft", draft: validateDraft(draft), summary: { operation: "create a storage or service area in a venue", document: draft.summary, lines: name } };
}
