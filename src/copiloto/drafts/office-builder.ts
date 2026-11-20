// Borradores de oficina sobre documentos que ya existen:
// · marcar una factura de proveedor como pagada (la de Makro, la MK-1001…);
// · validar las salidas de almacén pendientes de un local (lo que hace la pantalla de Almacén).
// Igual que el resto: se busca el documento, si hay varios se pregunta cuál, y nada se guarda hasta que el
// usuario confirma. Los permisos los decide la base de datos al confirmar.
import Decimal from "decimal.js";
import type { DocumentDraft, NavigateEvent } from "../contract/index";
import type { DocumentPlan } from "../agent/plans";
import { hasRole, type SessionContext } from "../domain";
import { mentionedSupplier } from "../entities/catalog-parser";
import { normalize } from "../entities/normalize";
import { formatMoney } from "../entities/units";
import type { InfoSource } from "../tools/info";
import type { InvoiceRaw } from "../tools/info-invoices";
import { moveLabel } from "../tools/info-warehouse";
import { parseTermChanges, TERM_LABEL, termText, type TermField } from "../agent/supplier-terms";
import { draftBase, type BuildResult } from "./builder";
import { validateDraft } from "./schemas";

interface OfficeInput {
  plan: DocumentPlan;
  message: string;
  ctx: SessionContext;
  info: InfoSource | undefined;
  overrides: Record<string, string>;
  now: Date;
}

const money = (v: string) => formatMoney(v);
const shortDate = (day: string | null) => (day ? `${day.slice(8, 10)}/${day.slice(5, 7)}` : "sin vencimiento");
const nav = (route: NavigateEvent["route"]): NavigateEvent => ({ route, filters: {}, auto: false });

function clarify(question: string, options: Array<{ id: string; label: string }>): BuildResult {
  return { kind: "clarify", plan: { type: "clarify", field: "documento", question, options: options.slice(0, 5).map((o) => ({ ...o, probability: null })) } };
}

function finish(draft: DocumentDraft, operation: string): BuildResult {
  return { kind: "draft", draft: validateDraft(draft), summary: { operation, document: draft.summary, lines: draft.lines.map((l) => `${l.label}: ${l.qty}`).join("; ") } };
}

// Facturas ------------------------------------------------------------------------------------

/** La factura que nombra el mensaje: por proveedor y, si dice un número, por su número o código. */
function namedInvoices(pending: InvoiceRaw[], message: string, ctx: SessionContext): InvoiceRaw[] {
  const supplier = mentionedSupplier(message, ctx.suppliers);
  let found = supplier ? pending.filter((i) => i.supplierName === supplier.name) : pending;
  const text = normalize(message);
  const numbered = found.filter((i) => [i.number, i.code].some((n) => n && text.includes(normalize(n))));
  if (numbered.length > 0) found = numbered;
  return found;
}

export async function invoicePayment({ plan, message, ctx, info, overrides, now }: OfficeInput): Promise<BuildResult> {
  if (!info) return { kind: "error", message: "Las facturas no están disponibles ahora mismo." };
  // Las facturas (importes de compra) solo las llevan encargados que ven costes, como su pantalla.
  if (!hasRole(ctx.role, "manager") || !ctx.seesCosts) return { kind: "error", message: "Las facturas las llevan los encargados que ven costes y la administración." };
  const pending = (await info.invoices(ctx.orgId)).filter((i) => i.status === "pendiente");
  const chosen = overrides.documento ? pending.filter((i) => i.id === overrides.documento) : namedInvoices(pending, message, ctx);
  const describe = (i: InvoiceRaw) => `${i.supplierName} · ${i.number || i.code} · ${money(i.total)} · ${i.overdue ? "vencida el" : "vence"} ${shortDate(i.due)}`;
  if (chosen.length !== 1) {
    if (pending.length === 0) return { kind: "error", message: "No hay facturas pendientes de pago.", navigate: nav("/facturas") };
    if (chosen.length === 0) return { kind: "error", message: "No encuentro esa factura entre las pendientes de pago. Pregúntame «¿qué facturas hay pendientes?» para verlas.", navigate: nav("/facturas") };
    // Varias: primero las vencidas y las que antes vencen.
    const sorted = [...chosen].sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.due ?? "9").localeCompare(b.due ?? "9"));
    return clarify("¿Qué factura marco como pagada?", sorted.map((i) => ({ id: i.id, label: describe(i) })));
  }
  const invoice = chosen[0]!;
  const warnings: string[] = [];
  if (invoice.receipts === 0) warnings.push("No tiene albaranes asociados: revisa que sea correcta antes de pagarla.");
  else if (new Decimal(invoice.difference).abs().gt(0.5)) warnings.push(`No cuadra con sus albaranes (${new Decimal(invoice.difference).gt(0) ? "+" : ""}${money(invoice.difference)}).`);
  const base = draftBase("documento", `Marcar pagada: ${invoice.supplierName} ${invoice.number || invoice.code} (${money(invoice.total)})`, ctx, warnings, now);
  return finish(
    {
      ...base,
      requiredRole: "manager",
      canConfirm: hasRole(ctx.role, "manager"),
      kind: "documento",
      operation: "pagar_factura",
      documentId: invoice.id,
      // Una factura no es de un local; el enlace de después es a Facturas.
      locationId: plan.locationIds[0] ?? ctx.locations[0]!.id,
      summary: describe(invoice),
      lines: [{ label: `Factura ${invoice.number || invoice.code} de ${invoice.supplierName}`, qty: `${money(invoice.total)} · pagada hoy` }],
    },
    "mark a supplier invoice as paid today",
  );
}

// Salidas de almacén ---------------------------------------------------------------------------

export async function warehouseValidation({ plan, ctx, info, overrides, now }: OfficeInput): Promise<BuildResult> {
  if (!info) return { kind: "error", message: "El almacén no está disponible ahora mismo." };
  const moves = await info.areaMoves(plan.locationIds);
  const names = new Map(ctx.locations.map((l) => [l.id, l.name]));
  const where = plan.locationIds.length === 1 ? ` en ${names.get(plan.locationIds[0]!)}` : "";
  if (moves.length === 0) return { kind: "error", message: `No hay salidas de almacén pendientes de validar${where}.`, navigate: nav("/almacen") };

  const byLocation = new Map<string, typeof moves>();
  for (const m of moves) byLocation.set(m.locationId, [...(byLocation.get(m.locationId) ?? []), m]);
  const locationId = overrides.documento && byLocation.has(overrides.documento) ? overrides.documento : byLocation.size === 1 ? [...byLocation.keys()][0]! : null;
  if (!locationId) {
    return clarify("¿De qué local valido las salidas?", [...byLocation].map(([id, list]) => ({ id, label: `${names.get(id) ?? "Local"} · ${list.length} pendiente${list.length === 1 ? "" : "s"}` })));
  }
  const list = byLocation.get(locationId)!;
  const name = names.get(locationId) ?? "el local";
  const lines = list.slice(0, 40).map((m) => {
    const label = moveLabel(m, ctx);
    return { label: `${label.product} · ${label.route}${m.kind === "devolucion" ? " (devolución)" : ""}`.slice(0, 120), qty: label.qty };
  });
  const shown = list.slice(0, 40);
  const warnings = ["Se validan tal cual. Si alguna cantidad o destino no es correcto, corrígela o recházala en Almacén."];
  if (list.length > shown.length) warnings.push(`Hay ${list.length - shown.length} más: se validan en Almacén.`);
  const base = draftBase("documento", `Validar ${shown.length === 1 ? "1 salida" : `${shown.length} salidas`} de almacén en ${name}`, ctx, warnings, now);
  return finish(
    {
      ...base,
      kind: "documento",
      operation: "validar_salidas",
      // Sin documento propio: el «documento» es la cola de ese local.
      documentId: locationId,
      locationId,
      summary: `${name} · ${shown.length} pendiente${shown.length === 1 ? "" : "s"} de validar`,
      lines,
      moveIds: shown.map((m) => m.id),
    },
    "validate the pending storeroom exits of a venue (move the stock from the storeroom to the bar or kitchen)",
  );
}

// PVP de un plato ------------------------------------------------------------------------------

/** Palabras con peso de un nombre («croquetas», «jamon»), para encontrar el plato en la frase. */
const nameWords = (name: string) => normalize(name).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !["con", "del", "las", "los", "para"].includes(w));

/** El último importe de la frase: «pon el PVP de las croquetas a 9,50 €» → 9.50. */
function priceIn(message: string): Decimal | null {
  const all = [...message.matchAll(/(\d+(?:[.,]\d{1,2})?)\s*(?:€|euros?|eur)?/gi)];
  const last = all.at(-1)?.[1];
  if (!last) return null;
  const value = new Decimal(last.replace(",", "."));
  return value.gt(0) && value.lt(1000) ? value : null;
}

export async function dishPrice({ message, ctx, info, overrides, now }: OfficeInput): Promise<BuildResult> {
  if (!info) return { kind: "error", message: "Los escandallos no están disponibles ahora mismo." };
  if (!hasRole(ctx.role, "manager")) return { kind: "error", message: "El PVP de los platos lo cambian los encargados y la administración." };
  const price = priceIn(message);
  if (!price) return { kind: "error", message: "Dime el precio nuevo con IVA, por ejemplo «pon el PVP de las croquetas a 9,50 €»." };
  const dishes = (await info.recipes(ctx.orgId)).filter((r) => r.active && r.kind === "plato" && r.id);
  const said = new Set(normalize(message).split(/[^a-z0-9]+/));
  // El plato cuyo nombre se dice entero; si ninguno, los que comparten más palabras (y se pregunta).
  const scored = dishes
    .map((r) => {
      const words = nameWords(r.name);
      const hits = words.filter((w) => [...said].some((s) => s.length >= 4 && (s.startsWith(w.slice(0, 5)) || w.startsWith(s.slice(0, 5))))).length;
      return { r, score: words.length ? hits / words.length : 0 };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  // Si ninguno se dice entero pero solo uno encaja a medias («las croquetas» → Croquetas de jamón), es ese.
  const full = scored.filter((x) => x.score === 1).map((x) => x.r);
  const partial = scored.filter((x) => x.score >= 0.5).map((x) => x.r);
  const chosen = overrides.documento ? dishes.filter((r) => r.id === overrides.documento) : full.length > 0 ? full : partial.length === 1 ? partial : [];
  if (chosen.length !== 1) {
    const options = (chosen.length > 1 ? chosen : scored.filter((x) => x.score >= 0.5).map((x) => x.r)).slice(0, 5);
    if (options.length === 0) return { kind: "error", message: "No encuentro ese plato en los escandallos. Dime su nombre como sale en Escandallos.", navigate: nav("/escandallos") };
    return clarify("¿De qué plato cambio el PVP?", options.map((r) => ({ id: r.id!, label: `${r.name}${r.salePrice ? ` · ahora ${money(r.salePrice)}` : " · sin PVP"}` })));
  }
  const dish = chosen[0]!;
  const old = dish.salePrice ? new Decimal(dish.salePrice) : null;
  const warnings: string[] = [];
  if (old && price.minus(old).abs().div(old).gt(0.3)) warnings.push(`Cambio grande (${price.gt(old) ? "+" : ""}${price.minus(old).div(old).mul(100).toFixed(0)} %): revisa la cifra.`);
  const lines = [{ label: "PVP con IVA", qty: `${old ? `${money(old.toString())} → ` : ""}${money(price.toString())}` }];
  // Lo que importa al decidir un precio: cómo queda el food cost (coste de la ración sobre el PVP sin IVA).
  if (ctx.seesCosts && dish.portionCost) {
    const net = (p: Decimal) => p.div(new Decimal(1).plus(new Decimal(dish.vatRate ?? "10").div(100)));
    const pct = (p: Decimal) => new Decimal(dish.portionCost!).div(net(p)).mul(100).toFixed(1).replace(".", ",");
    lines.push({ label: "Food cost", qty: `${old ? `${pct(old)} % → ` : ""}${pct(price)} % (objetivo ${dish.target} %)` });
  }
  const base = draftBase("documento", `Cambiar PVP: ${dish.name} a ${money(price.toString())}`, ctx, warnings, now);
  return finish(
    {
      ...base,
      requiredRole: "manager",
      canConfirm: hasRole(ctx.role, "manager"),
      kind: "documento",
      operation: "precio_venta",
      documentId: dish.id!,
      // Un plato no es de un local; el enlace de después es a Escandallos.
      locationId: ctx.locations[0]!.id,
      summary: `${dish.name}${dish.category ? ` · ${dish.category}` : ""}`,
      lines,
      price: price.toString(),
    },
    "change the menu sale price of a dish",
  );
}

// Condiciones de un proveedor ------------------------------------------------------------------

export async function supplierTerms({ message, ctx, info, now }: OfficeInput): Promise<BuildResult> {
  if (!info) return { kind: "error", message: "Los proveedores no están disponibles ahora mismo." };
  if (!hasRole(ctx.role, "manager")) return { kind: "error", message: "Las condiciones de los proveedores las cambian los encargados y la administración." };
  const named = mentionedSupplier(message, ctx.suppliers);
  const changes = parseTermChanges(message);
  if (changes.length === 0) return { kind: "error", message: "Dime el proveedor y lo que cambia, por ejemplo «el pedido mínimo de Makro es 200 €»." };
  if (!named) return { kind: "error", message: "No encuentro ese proveedor. Dímelo como sale en Proveedores (o pregúntame «¿qué proveedores tenemos?»).", navigate: nav("/proveedores") };
  const current = (await info.suppliers(ctx.orgId)).find((s) => s.name === named.name);
  const before: Record<TermField, string | number[] | number | null> = {
    min_order: current?.minOrder ?? null,
    order_days: current?.orderDays ?? null,
    order_cutoff: current?.cutoff ?? null,
    lead_time_hours: current?.leadHours ?? null,
    payment_terms: current?.paymentTerms ?? null,
  };
  const lines = changes.map((c) => ({ label: TERM_LABEL[c.field], qty: `${termText(c.field, before[c.field], money)} → ${termText(c.field, c.value, money)}` }));
  const base = draftBase("documento", `Condiciones de ${named.name}: ${changes.map((c) => TERM_LABEL[c.field].toLowerCase()).join(", ")}`, ctx, [], now);
  return finish(
    {
      ...base,
      requiredRole: "manager",
      canConfirm: hasRole(ctx.role, "manager"),
      kind: "documento",
      operation: "condiciones_proveedor",
      documentId: named.id,
      // Un proveedor no es de un local; el enlace de después es a Proveedores.
      locationId: ctx.locations[0]!.id,
      summary: named.name,
      lines,
      terms: changes,
    },
    "change a supplier's ordering or payment terms",
  );
}
