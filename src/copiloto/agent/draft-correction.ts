// Corregir el borrador pendiente hablando: «mejor que sean 4», «cámbialo a Parador», «era por caducidad». Antes
// cada corrección se leía como una orden nueva sin producto y salía el formulario vacío (o un segundo borrador
// suelto). Aquí se toma el borrador tal cual está, se cambia solo lo que se dice y se rehace con el mismo
// constructor; Jev vuelve a comprobar la coherencia con la petición y la corrección, y el anterior se descarta.
import Decimal from "decimal.js";
import type { Draft, TransferDraft, WasteDraft } from "../contract/index";
import type { Product, SessionContext } from "../domain";
import { BASE_PACK } from "../drafts/builder";
import type { DraftStore } from "../drafts/store";
import { MOTIVOS_MERMA, type MotivoMerma } from "../jev/catalog/criteria";
import { label } from "../jev/catalog/labels";
import { normalize, tokenize } from "../entities/normalize";
import type { Retriever } from "../entities/retriever";
import { isCancel, isNewQuestion, operationOf } from "./free-text";
import type { ActionPlan, AvisoPlan, ResolvedProduct } from "./plans";
import { productsNamed } from "./product-facts";
import type { Focus } from "./session";
import { readFragment } from "./task-in-progress";

export interface Correction {
  plan: ActionPlan | AvisoPlan;
  /** La petición original: Jev comprueba el borrador nuevo contra ella y la corrección. */
  request: string;
  answers: string[];
  overrides: Record<string, string>;
  /** Borrador que se sustituye: se descarta cuando el nuevo está listo. */
  replaces: string;
}

/** Una corrección se anuncia: «mejor…», «no, …», «que sean…», «cámbialo…», «en vez de…». */
const MARKER = /^(no|mejor|perdon|perdona|espera|uy|ups|corrijo|corrige|cambia\w*|pon|ponlo|ponla|ponme|que sean|sean|son|eran|era|al final|mas bien|en realidad|me he equivocado|me equivoque)\b|\ben (vez|lugar) de\b|\bque sean\b/;
/** Palabras de la corrección en sí: no son el producto. */
const LEAD = /^((no|vale|perdon|perdona|espera|uy|ups|oye|mejor|corrijo|corrige|cambia\w*|pon\w*|que|sean|son|eran|era|es|al final|mas bien|en realidad|me he equivocado|me equivoque|lo|la|el|los|las|cantidad|local|producto|origen|destino|motivo)\b[\s,.]*)+/;
const INSTEAD = /\ben (vez|lugar) de\s+(el |la |los |las )?\S+(\s+(botellas?|cajas?|uds?|unidades?|kg|kilos?|litros?|l|packs?|barriles?|garrafas?))?/;
const MAX_WORDS = 12;

function motivoOf(draft: WasteDraft): MotivoMerma {
  if (draft.exitKind === "invitacion") return "invitacion";
  if (!draft.reason) return "no_indicado";
  return (Object.keys(MOTIVOS_MERMA) as MotivoMerma[]).find((m) => label(m).toLowerCase() === draft.reason) ?? "otro";
}

interface Line {
  productId: string;
  qtyBase: string;
  input: { amount: string; unit: string; packId?: string };
}

function linesOf(draft: WasteDraft | TransferDraft): Line[] {
  return draft.kind === "merma" ? [{ productId: draft.productId, qtyBase: draft.qtyBase, input: draft.input }] : draft.lines;
}

/**
 * Una línea que no cambia se rehace con la misma cantidad: en su formato si cuadra exacto, si no en la unidad base
 * (así el borrador nuevo no pierde lo que ya estaba bien).
 */
function keptLine(line: Line, product: Product, i: number, overrides: Record<string, string>): ResolvedProduct {
  const pack = line.input.packId ? product.packs.find((k) => k.id === line.input.packId) : undefined;
  const exact = pack && new Decimal(line.input.amount).mul(pack.qtyBase).eq(line.qtyBase);
  overrides[`unidad_${i}`] = exact ? pack.id : BASE_PACK;
  return { product, segmentIndex: i, amount: exact ? line.input.amount : line.qtyBase, unit: null, price: null, quantityOutcome: "actuar", productOutcome: "actuar" };
}

/** La cantidad nueva: con la unidad que se diga o, si no dice ninguna («que sean 4»), la que ya tenía la línea. */
function newQuantity(line: Line, product: Product, amount: string, unit: string | null, i: number, overrides: Record<string, string>): ResolvedProduct {
  const base = { product, segmentIndex: i, amount, price: null, quantityOutcome: "actuar" as const, productOutcome: "actuar" as const };
  if (unit) return { ...base, unit };
  const pack = line.input.packId ? product.packs.find((k) => k.id === line.input.packId) : undefined;
  if (pack) overrides[`unidad_${i}`] = pack.id;
  else if (line.input.unit === product.baseUnit) overrides[`unidad_${i}`] = BASE_PACK;
  return { ...base, unit: pack || line.input.unit === product.baseUnit ? null : line.input.unit };
}

/**
 * ¿Lo escrito corrige el borrador pendiente? Devuelve el plan del borrador rehecho (o un aviso si no se sabe qué
 * línea cambiar). null si no es una corrección: el mensaje sigue su camino normal.
 */
export async function draftCorrection(text: string, focus: Focus | undefined, drafts: DraftStore, ctx: SessionContext, retriever: Retriever, now: Date): Promise<Correction | null> {
  if (!focus?.draftId) return null;
  const norm = normalize(text).trim();
  const words = tokenize(text);
  if (!MARKER.test(norm) || words.length > MAX_WORDS || isNewQuestion(text) || isCancel(text)) return null;
  // Precios, PVP o importes son otra orden («pon el pvp del gin tonic a 9 euros»), no esta corrección.
  if (/\b(euros?|eur|pvp|precio|cuesta|vale)\b|€/.test(norm) && !/^vale\b/.test(norm)) return null;
  const stored = await drafts.get(focus.draftId, ctx.userId, ctx.orgId);
  if (!stored || stored.status !== "pendiente" || new Date(stored.draft.expiresAt).getTime() < now.getTime()) return null;
  const draft: Draft = stored.draft;
  if (draft.kind !== "merma" && draft.kind !== "traspaso") return null;
  // Si nombra una operación («pon una merma de…»), es una orden nueva, no un retoque de esta.
  if (operationOf(text) !== null) return null;

  const said = norm.replace(INSTEAD, " ").replace(LEAD, "").trim();
  const f = readFragment(said, ctx);
  const lines = linesOf(draft);
  const byId = (id: string) => ctx.products.find((p) => p.id === id);
  if (lines.some((l) => !byId(l.productId))) return null;

  // Producto: el de una línea («que sean 4 de cocacola») o, en una sola línea, el producto nuevo.
  let target = lines.length === 1 ? 0 : -1;
  let replacement: Product | undefined;
  if (f.producto) {
    const named = await productsNamed(f.producto, ctx, retriever, 6);
    const inDraft = lines.findIndex((l) => named.some((p) => p.id === l.productId));
    if (inDraft >= 0) target = inDraft;
    else if (lines.length === 1 && named.length === 1) replacement = named[0];
    else return null;
  }

  const locationChange = f.locations.length > 0;
  if (!locationChange && !f.amount && !replacement && !f.motivo) return null;
  if ((f.amount || replacement) && target < 0) {
    return {
      plan: { type: "aviso", text: "¿Qué línea cambio? Dímelo con el producto, por ejemplo «que sean 4 de Coca-Cola»." },
      request: stored.request,
      answers: [],
      overrides: {},
      replaces: focus.draftId,
    };
  }

  // Locales: con su papel si se marca («del vivero», «al parador»); uno suelto en una merma es el local.
  let locationId = draft.kind === "merma" ? draft.locationId : draft.fromLocationId;
  let toLocationId = draft.kind === "traspaso" ? draft.toLocationId : null;
  const idOf = (name: string) => ctx.locations.find((l) => l.name === name)?.id;
  for (const l of f.locations) {
    const id = idOf(l.name);
    if (!id) continue;
    if (draft.kind === "merma") locationId = id;
    else if (l.role === "origen") locationId = id;
    else if (l.role === "destino") toLocationId = id;
    // Un local sin «de» ni «a» en un traspaso no dice cuál cambia: no se adivina.
    else return null;
  }
  if (draft.kind === "traspaso" && locationId === toLocationId) return null;

  const overrides: Record<string, string> = { intent: "proponer_accion", tipo_accion: draft.kind };
  const products = lines.map((line, i) => {
    const product = (i === target && replacement) || byId(line.productId)!;
    if (i === target && f.amount) return newQuantity(line, product, f.amount, f.unit ?? null, i, overrides);
    if (i === target && replacement) return { product, segmentIndex: i, amount: line.input.amount, unit: line.input.packId ? null : line.input.unit, price: null, quantityOutcome: "actuar" as const, productOutcome: "actuar" as const };
    return keptLine(line, product, i, overrides);
  });

  const plan: ActionPlan = {
    type: "accion",
    accion: draft.kind,
    locationId,
    locationOutcome: "actuar",
    toLocationId,
    toLocationOutcome: "actuar",
    areaId: draft.kind === "merma" && locationId === draft.locationId ? draft.areaId : null,
    products,
    motivo: draft.kind === "merma" ? ((f.motivo as MotivoMerma | undefined) ?? motivoOf(draft)) : "no_indicado",
    ambiguous: 0,
  };
  return { plan, request: stored.request, answers: [`corrección: ${text.trim()}`], overrides, replaces: focus.draftId };
}
