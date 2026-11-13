// Apuntar una salida de almacén desde el chat («saca 2 cajas de coca a la barra 1», «sube 3 botellas de
// Barceló del almacén a la barra»), o una devolución («devuelve 1 botella de ron de la barra al almacén»).
// Lo mismo que la pantalla de Almacén: queda pendiente de validar y el stock no se mueve hasta entonces.
// Las zonas salen de su tipo (migración 0022): una salida va de un almacén a una zona de servicio.
import type { Area, SessionContext } from "../domain";
import type { DocumentDraft } from "../contract/index";
import type { DocumentPlan } from "../agent/plans";
import { productsNamed } from "../agent/product-facts";
import { normalize, tokenize } from "../entities/normalize";
import { parseQuantities } from "../entities/quantity-parser";
import type { Retriever } from "../entities/retriever";
import { formatStock } from "../entities/units";
import { draftBase, resolveQuantity, type BuildResult } from "./builder";
import { validateDraft } from "./schemas";

interface MoveInput {
  plan: DocumentPlan;
  message: string;
  ctx: SessionContext;
  overrides: Record<string, string>;
  now: Date;
  retriever: Retriever | undefined;
}

/** «devuelve», «devolución»: de la zona de servicio al almacén. */
function isReturn(message: string): boolean {
  return /\b(devuelve|devolver|devolvemos|devolucion|devuelto|devueltas?|devueltos)\b/.test(normalize(message));
}

/**
 * La zona que nombra el mensaje entre las de ese tipo del local («barra 1», «cocina»): la que se dice
 * entera; si solo se dice a medias y encajan varias («la barra» con Barra 1 y Barra 2), ninguna (se
 * pregunta: en una escritura no se adivina).
 */
function namedArea(message: string, areas: Area[]): Area | undefined {
  // Entera = el nombre seguido en la frase («a la barra 2»), con sus cifras: el «2» de «2 cajas» no
  // hace que se nombre «Barra 2».
  const flat = (text: string) => ` ${normalize(text).split(/[^a-z0-9]+/).filter(Boolean).join(" ")} `;
  const said = flat(message);
  const full = areas.filter((a) => said.includes(flat(a.name))).sort((x, y) => y.name.length - x.name.length);
  if (full.length > 0) return full[0];
  const words = new Set(tokenize(message));
  const partial = areas.filter((a) => tokenize(a.name).some((t) => words.has(t)));
  return partial.length === 1 ? partial[0] : undefined;
}

function clarify(question: string, options: Array<{ id: string; label: string }>): BuildResult {
  return { kind: "clarify", plan: { type: "clarify", field: "documento", question, options: options.slice(0, 6).map((o) => ({ ...o, probability: null })) } };
}

export async function warehouseMove({ plan, message, ctx, overrides, now, retriever }: MoveInput): Promise<BuildResult> {
  if (!retriever) return { kind: "error", message: "El almacén no está disponible ahora mismo." };
  const returning = isReturn(message);
  const servicio = ctx.areas.filter((a) => a.kind === "servicio");

  // Local: el elegido al aclarar, el nombrado, el de la zona de servicio nombrada o el de la página.
  const chosen = overrides.documento?.startsWith("local:") ? overrides.documento.slice(6) : undefined;
  const byArea = namedArea(message, servicio)?.locationId;
  const candidates = chosen ? [chosen] : plan.locationIds.length === 1 ? plan.locationIds : byArea ? [byArea] : plan.locationIds;
  const usable = candidates.filter((id) => ctx.areas.some((a) => a.locationId === id && a.kind === "almacen") && servicio.some((a) => a.locationId === id));
  if (usable.length === 0) return { kind: "error", message: "Ese local no tiene zonas de almacén y de servicio. Se configuran en Gestión › Zonas." };
  if (usable.length > 1) {
    return clarify("¿En qué local?", usable.map((id) => ({ id: `local:${id}`, label: ctx.locations.find((l) => l.id === id)?.name ?? "Local" })));
  }
  const locationId = usable[0]!;
  const local = ctx.locations.find((l) => l.id === locationId)?.name ?? "el local";
  const stores = ctx.areas.filter((a) => a.locationId === locationId && a.kind === "almacen");
  const services = servicio.filter((a) => a.locationId === locationId);
  // Zona de servicio: la nombrada; si solo hay una, esa; si no, se pregunta.
  const pickedService = overrides.documento?.startsWith("zona:") ? services.find((a) => a.id === overrides.documento!.slice(5)) : undefined;
  const service = pickedService ?? namedArea(message, services) ?? (services.length === 1 ? services[0] : undefined);
  if (!service) return clarify(returning ? "¿De qué zona vuelve?" : "¿A qué zona va?", services.map((a) => ({ id: `zona:${a.id}`, label: a.name })));
  // Almacén: el nombrado, o el único; con varios (almacén, cámara, congelador) se pregunta.
  const pickedStore = overrides.documento?.startsWith("almacen:") ? stores.find((a) => a.id === overrides.documento!.slice(8)) : undefined;
  const store = pickedStore ?? namedArea(message, stores) ?? (stores.length === 1 ? stores[0] : undefined);
  if (!store) return clarify(returning ? "¿A qué almacén vuelve?" : "¿De qué almacén sale?", stores.map((a) => ({ id: `almacen:${a.id}`, label: a.name })));

  // Producto y cantidad: del trozo de la frase con la cifra («2 cajas de coca»).
  const segment = parseQuantities(message)[0];
  if (!segment?.amount) return { kind: "error", message: "Dime la cantidad y el producto, por ejemplo «saca 2 cajas de coca a la barra»." };
  const placeWords = new Set([...ctx.areas, ...ctx.locations].flatMap((x) => tokenize(x.name)));
  const phrase = tokenize(segment.productText || segment.text).filter((w) => !placeWords.has(w)).join(" ");
  const pickedProduct = overrides.documento?.startsWith("producto:") ? ctx.products.find((p) => p.id === overrides.documento!.slice(9)) : undefined;
  const products = pickedProduct ? [pickedProduct] : await productsNamed(phrase, ctx, retriever, 6);
  if (products.length === 0) return { kind: "error", message: `No encuentro «${phrase}» en el catálogo. Dímelo como sale en Productos.` };
  if (products.length > 1) return clarify("¿Cuál de estos productos?", products.map((p) => ({ id: `producto:${p.id}`, label: p.name })));
  const product = products[0]!;
  const quantity = resolveQuantity({ product, segmentIndex: 0, amount: segment.amount, unit: segment.unit, price: null, quantityOutcome: "actuar", productOutcome: "actuar" }, {});
  if ("type" in quantity) return { kind: "error", message: `Dime el formato de ${product.name}, por ejemplo «2 cajas» o «3 botellas».` };

  const from = returning ? service : store;
  const to = returning ? store : service;
  const what = formatStock(quantity.qtyBase, product);
  const base = draftBase("documento", `${returning ? "Devolución" : "Salida"} en ${local}: ${what} de ${product.name}`, ctx, quantity.warnings, now);
  const draft: DocumentDraft = {
    ...base,
    kind: "documento",
    operation: "salida_almacen",
    documentId: locationId,
    locationId,
    summary: `${local} · ${from.name} → ${to.name} · queda pendiente de validar`,
    lines: [{ label: product.name, qty: what }],
    move: { productId: product.id, qtyBase: quantity.qtyBase.toString(), fromAreaId: from.id, toAreaId: to.id, kind: returning ? "devolucion" : "salida", input: quantity.input },
  };
  return { kind: "draft", draft: validateDraft(draft), summary: { operation: "record a move from the storeroom to the bar or kitchen", document: draft.summary, lines: `${product.name}: ${what}` } };
}
