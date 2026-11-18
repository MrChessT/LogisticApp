// Cargar desde el chat la exportación de ventas del TPV que el navegador ya ha leído (documents.ts): un borrador con el
// día, el local, cuántos artículos e importe, y cuántos quedarían sin enlazar. Lo calcula import_sales sin aplicar
// (la misma vista previa que Ventas). Al confirmar se carga de verdad; si ese día ya estaba cargado, se sustituye.
import Decimal from "decimal.js";
import type { ChatDocument, DocumentDraft } from "../contract/index";
import { hasRole, type SessionContext } from "../domain";
import { formatMoney } from "../entities/units";
import { namedLocations } from "../entities/signals";
import { guessLocation } from "../../lib/sales-import";
import type { InfoSource } from "../tools/info";
import { draftBase, type BuildResult } from "./builder";
import { validateDraft } from "./schemas";

const fecha = (iso: string) => iso.split("-").reverse().join("/");

export async function salesImport({ doc, message, ctx, info, pageLocationId, now }: {
  doc: ChatDocument;
  message: string;
  ctx: SessionContext;
  info: InfoSource | undefined;
  pageLocationId?: string;
  now: Date;
}): Promise<BuildResult> {
  if (!hasRole(ctx.role, "manager") || !ctx.seesCosts) return { kind: "error", message: "Las ventas las ve la dirección (propiedad, administración y encargados) con el permiso «ve costes»." };
  if (!info) return { kind: "error", message: "Las ventas no están disponibles ahora mismo." };
  if (!doc.date) return { kind: "error", message: "El archivo no dice de qué día son las ventas («Fecha venta»): cárgalas desde Ventas eligiendo el día." };
  if (doc.lines.length === 0) return { kind: "error", message: "El archivo no tiene líneas de venta." };
  // El local: el que se nombra en la frase, el del centro de coste del TPV, el de la pantalla o el único que hay.
  const said = namedLocations(ctx.locations, message);
  const location = said.length === 1 ? said[0]! : guessLocation(doc.party, ctx.locations) ?? ctx.locations.find((l) => l.id === pageLocationId) ?? (ctx.locations.length === 1 ? ctx.locations[0]! : null);
  if (!location) return { kind: "error", message: `¿De qué local son estas ventas? Dímelo así: «carga estas ventas en ${ctx.locations[0]?.name ?? "el local"}».` };

  const lines = doc.lines.map((l) => ({ code: (l.code ?? l.description).slice(0, 40), name: l.description, qty: l.qty, unit: l.unit, amount: l.amount }));
  const preview = await info.salesPreview({ orgId: ctx.orgId, locationId: location.id, date: doc.date, lines, file: doc.file });
  const total = lines.reduce((s, l) => s.plus(l.amount), new Decimal(0));
  const warnings: string[] = [];
  if (preview.replaced) warnings.push(`Las ventas del ${fecha(doc.date)} en ${location.name} ya estaban cargadas: se sustituyen por estas.`);
  if (preview.unlinked > 0) warnings.push(`${preview.unlinked} ${preview.unlinked === 1 ? "artículo queda" : "artículos quedan"} sin enlazar (${formatMoney(preview.unlinkedAmount)}): no ${preview.unlinked === 1 ? "tendrá coste hasta enlazarlo" : "tendrán coste hasta enlazarlos"}.`);

  const base = draftBase("documento", `Cargar ventas del ${fecha(doc.date)}`, ctx, warnings, now);
  const draft: DocumentDraft = {
    ...base,
    requiredRole: "manager",
    canConfirm: hasRole(ctx.role, "manager"),
    kind: "documento",
    operation: "cargar_ventas",
    documentId: location.id,
    locationId: location.id,
    summary: `${location.name} · ${doc.file}`,
    lines: [
      { label: "Artículos", qty: String(lines.length) },
      { label: "Venta sin IVA", qty: formatMoney(total) },
      { label: "Enlazados a platos o productos", qty: String(preview.linked) },
      ...(preview.costedAmount !== null && preview.theoreticalCost !== null && new Decimal(preview.costedAmount).gt(0)
        ? [{ label: "Food cost de lo enlazado", qty: `${new Decimal(preview.theoreticalCost).div(preview.costedAmount).mul(100).toFixed(1).replace(".", ",")} %` }]
        : []),
    ],
    salesImport: { locationId: location.id, date: doc.date, file: doc.file, lines },
  };
  return { kind: "draft", draft: validateDraft(draft), summary: { operation: "load the point-of-sale sales of a day", document: `${location.name} ${doc.date}`, lines: `${lines.length} lines` } };
}
