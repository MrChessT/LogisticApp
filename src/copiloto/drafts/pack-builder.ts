// Formato nuevo de un producto desde el chat («la coca también viene en caja de 12», «el Barceló viene en
// caja de 6 botellas», «el hielo viene en saco de 5 kg»). La cantidad del formato se calcula en unidad
// base: unidades del producto (su formato de conteo: 6 botellas de 70 cl = 4.200 ml) o peso y volumen
// dichos tal cual (5 kg = 5.000 g), siempre que encajen con cómo se mide el producto.
import Decimal from "decimal.js";
import type { DocumentDraft } from "../contract/index";
import { hasRole, type Product, type SessionContext } from "../domain";
import { normalize, tokenize } from "../entities/normalize";
import type { Retriever } from "../entities/retriever";
import { formatBase } from "../entities/units";
import { productsNamed } from "../agent/product-facts";
import { draftBase, type BuildResult } from "./builder";
import { validateDraft } from "./schemas";

const CONTAINER = "caja|pack|bandeja|garrafa|barril|saco|fardo|paquete|bolsa|bidon|retractil";
export const PACK_RE = new RegExp(`\\b(${CONTAINER})s? de (\\d+(?:[.,]\\d+)?)(?:\\s+(botellas?|latas?|unidades|uds?|piezas?|kg|kilos?|g|gramos|l|litros?|cl|ml))?\\b`);
const MASS: Record<string, number> = { kg: 1000, kilo: 1000, kilos: 1000, g: 1, gramos: 1 };
const VOLUME: Record<string, number> = { l: 1000, litro: 1000, litros: 1000, cl: 10, ml: 1 };

/** Nombre y cantidad en unidad base del formato dicho, o un motivo por el que no encaja. */
export function packFrom(message: string, product: Product): { name: string; qtyBase: Decimal } | { error: string } | null {
  const m = PACK_RE.exec(normalize(message));
  if (!m) return null;
  const container = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1);
  const n = new Decimal(m[2]!.replace(",", "."));
  const unit = m[3];
  if (unit && (MASS[unit] || VOLUME[unit])) {
    const factor = product.dimension === "mass" ? MASS[unit] : product.dimension === "volume" ? VOLUME[unit] : undefined;
    if (!factor) return { error: `${product.name} no se mide en ${unit}: dime cuántas unidades lleva el formato.` };
    return { name: `${container} ${m[2]} ${unit}`, qtyBase: n.mul(factor) };
  }
  // Unidades: del formato con el que se cuenta (botella, lata…) o, si se cuenta por unidades, tal cual.
  const count = product.packs.find((k) => k.isCountDefault && !k.isServing);
  const each = product.dimension === "count" ? new Decimal(count?.qtyBase ?? 1) : count ? new Decimal(count.qtyBase) : null;
  if (!each) return { error: `Dime cuánto lleva el formato de ${product.name} en peso o volumen, por ejemplo «${m[1]} de 5 kg».` };
  const inner = unit && !/^(unidades|uds?|piezas?)$/.test(unit) ? unit.replace(/s$/, "") + (n.eq(1) ? "" : "s") : product.dimension === "count" ? "ud" : (count?.name.split(" ")[0]?.toLowerCase() ?? "ud") + (n.eq(1) ? "" : "s");
  return { name: `${container} ${m[2]} ${inner}`, qtyBase: n.mul(each) };
}

const NOT_PRODUCT = new Set(`el la los las lo de del en y tambien viene vienen ahora nuevo formato anade anadir agrega se vende venden traen trae nos lo ${CONTAINER.replace(/\|/g, " ")} cajas packs botella botellas lata latas unidades ud uds kg kilos g gramos l litros cl ml`.split(" "));

export async function newPack({ message, ctx, overrides, now, retriever }: { message: string; ctx: SessionContext; overrides: Record<string, string>; now: Date; retriever: Retriever | undefined }): Promise<BuildResult> {
  if (!retriever) return { kind: "error", message: "El catálogo no está disponible ahora mismo." };
  if (!hasRole(ctx.role, "manager")) return { kind: "error", message: "Los formatos los cambian los encargados y la administración." };
  const phrase = tokenize(message).filter((w) => !NOT_PRODUCT.has(w) && !/^\d/.test(w)).join(" ");
  const picked = overrides.documento?.startsWith("producto:") ? ctx.products.find((p) => p.id === overrides.documento!.slice(9)) : undefined;
  const products = picked ? [picked] : await productsNamed(phrase, ctx, retriever, 6);
  if (products.length === 0) return { kind: "error", message: `No encuentro «${phrase}» en el catálogo. Dímelo como sale en Productos.` };
  if (products.length > 1) {
    return { kind: "clarify", plan: { type: "clarify", field: "documento", question: "¿De cuál de estos productos?", options: products.slice(0, 6).map((p) => ({ id: `producto:${p.id}`, label: p.name, probability: null })) } };
  }
  const product = products[0]!;
  const pack = packFrom(message, product);
  if (!pack) return { kind: "error", message: "Dime el formato con su cantidad, por ejemplo «la coca también viene en caja de 12»." };
  if ("error" in pack) return { kind: "error", message: pack.error };
  const same = product.packs.find((k) => normalize(k.name) === normalize(pack.name) || new Decimal(k.qtyBase).eq(pack.qtyBase));
  if (same) return { kind: "error", message: `${product.name} ya tiene el formato «${same.name}» (${formatBase(same.qtyBase, product.baseUnit)}).` };

  const base = draftBase("documento", `Formato nuevo de ${product.name}: ${pack.name}`, ctx, [], now);
  const draft: DocumentDraft = {
    ...base,
    requiredRole: "manager",
    canConfirm: hasRole(ctx.role, "manager"),
    kind: "documento",
    operation: "formato_producto",
    documentId: product.id,
    locationId: ctx.locations[0]!.id,
    summary: `${product.name} · ahora: ${product.packs.map((k) => k.name).join(", ") || "sin formatos"}`,
    lines: [{ label: pack.name, qty: formatBase(pack.qtyBase, product.baseUnit) }],
    pack: { productId: product.id, name: pack.name, qtyBase: pack.qtyBase.toString() },
  };
  return { kind: "draft", draft: validateDraft(draft), summary: { operation: "add a pack size to a product", document: draft.summary, lines: pack.name } };
}
