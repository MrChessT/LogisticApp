// Datos de las cuatro pantallas de operativa (recepciones, traspasos, inventarios, mermas): las filas
// de la lista y las cifras de resumen de cada una. La pantalla (operations-page) solo pinta y abre formularios.
import { civilToday } from "@/lib/business-day";
import Decimal from "decimal.js";
import type { createClient } from "@/lib/supabase/client";
import { readAll } from "@/lib/supabase/read-all";
import { euros as formatCurrency, quantity } from "@/lib/format";
import { formatStock, type UnitDimension } from "@/lib/units";
import { countingPacks, type PackRow } from "@/lib/packs";
import { photoUrl } from "@/lib/receipt-checks";
import { EXIT_KIND_LABEL, isExitKind, isLoss, type ExitKind } from "@/lib/exit-kinds";

export type OperationKind = "recepciones" | "traspasos" | "inventarios" | "mermas";
type StatusColor = "green" | "orange" | "purple" | "red";
export type Location = { id: string; name: string };
type RowAction = { label: string; onClick: () => void; tone: "primary" | "secondary" | "danger" };

/** Tarjeta de resumen de cada pantalla: qué se mide, la cifra y de qué periodo es. */
export type Metric = { label: string; value: string; hint: string; tone?: "warn"; small?: boolean; money?: boolean };

/** Las listas enseñan lo reciente (y lo pendiente, sea de cuando sea); las cifras, el último mes. */
const LIST_DAYS = 60;
const METRIC_DAYS = 30;

/** Lo que sale suele ser menos de un envase (una copa, un chupito): «150 ml» se lee mejor que «0,21 botellas». */
function wasteAmount(qty: number, packs: ReturnType<typeof countingPacks>) {
  const pack = packs.countPack;
  if (packs.dimension !== "count" && pack && new Decimal(qty).lt(pack.qtyBase)) {
    return quantity(qty, packs.dimension === "mass" ? "g" : "ml");
  }
  return formatStock(qty, packs);
}

function daysAgo(days: number) {
  const d = new Date(`${civilToday()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export type DisplayRow = {
  id: string;
  /** Si la fila lleva a su ficha (los albaranes). */
  href?: string;
  title: string;
  detail: string;
  status: string;
  rawStatus: string;
  statusColor: StatusColor;
  date: string;
  actions: RowAction[];
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export interface LoadDeps {
  supabase: NonNullable<ReturnType<typeof createClient>>;
  /** Locales del usuario (o la promesa que los trae, en la carga inicial). */
  locations: Location[] | Promise<Location[]>;
  onSendTransfer: (id: string) => void;
  onDeleteTransfer: (id: string) => void;
  onReceiveTransfer: (id: string) => void;
  onCancelTransfer: (id: string) => void;
  onCount: (count: { id: string; locationId: string }) => void;
}

export async function loadOperations(kind: OperationKind, deps: LoadDeps): Promise<{ rows: DisplayRow[]; metrics: Metric[] } | { error: string }> {
  const { supabase } = deps;
  let rows: DisplayRow[] = [];
  let metrics: Metric[] = [];

  if (kind === "recepciones") {
    const { data, error } = await readAll((from, to) =>
      supabase
        .from("goods_receipts")
        .select("id, code, doc_number, doc_date, status, attachment_path, suppliers(name), locations(name), receipt_lines(packs_qty, pack_price, expected_price, incident)")
        .gte("doc_date", daysAgo(LIST_DAYS))
        .order("doc_date", { ascending: false })
        .order("id")
        .range(from, to),
    );
    if (error) {
      return { error: "No se pudieron cargar las recepciones." };
    }
    const records = (data ?? []) as unknown as Array<{
      id: string; code: string | null; doc_number: string | null; doc_date: string; status: "open" | "closed" | "cancelled";
      suppliers: { name: string } | null; locations: { name: string } | null;
      attachment_path: string | null;
      receipt_lines: Array<{ packs_qty: number; pack_price: number; expected_price: number | null; incident: string | null }>;
    }>;
    // Lo cobrado de más frente a lo pactado (solo subidas) y las incidencias de cada albarán.
    const overcharge = (r: (typeof records)[number]) =>
      r.receipt_lines.reduce((sum, l) => (l.expected_price !== null && l.pack_price > l.expected_price + 0.005 ? sum + (l.pack_price - l.expected_price) * l.packs_qty : sum), 0);
    const incidents = (r: (typeof records)[number]) => r.receipt_lines.filter((l) => l.incident).length;
    rows = records.map((r) => ({
      id: r.id,
      href: `/recepciones/${r.id}`,
      title: `${r.code ? `${r.code} · ` : ""}${r.doc_number ? `Albarán ${r.doc_number}` : "albarán sin número"}`,
      detail: [
        r.suppliers?.name ?? "Proveedor sin asignar",
        overcharge(r) > 0 ? `${formatCurrency(overcharge(r))} por encima de lo pactado` : null,
        incidents(r) > 0 ? `${incidents(r)} ${incidents(r) === 1 ? "incidencia" : "incidencias"}` : null,
        r.attachment_path ? null : "sin foto",
      ].filter(Boolean).join(" · "),
      status: r.locations?.name ?? "Local sin asignar",
      rawStatus: r.status,
      statusColor: overcharge(r) > 0 || incidents(r) > 0 ? "orange" : r.status === "closed" ? "green" : r.status === "cancelled" ? "red" : "orange",
      date: formatDate(r.doc_date),
      actions: r.attachment_path
        ? [{
            label: "Ver albarán",
            tone: "secondary" as const,
            onClick: () => {
              // La ventana se abre en el clic (los navegadores bloquean las que se abren después de esperar).
              const win = window.open("", "_blank");
              void photoUrl(supabase, r.attachment_path!).then((url) => {
                if (url && win) win.location.href = url;
                else win?.close();
              });
            },
          }]
        : [],
    }));
    // Solo cuentan las recepciones registradas: una abierta o anulada no es una compra.
    const month = records.filter((r) => r.status === "closed" && r.doc_date >= daysAgo(METRIC_DAYS));
    const total = month.reduce((sum, r) => sum + r.receipt_lines.reduce((s, l) => s + l.packs_qty * l.pack_price, 0), 0);
    const overcharged = month.filter((r) => overcharge(r) > 0);
    const extra = overcharged.reduce((sum, r) => sum + overcharge(r), 0);
    const incidentCount = month.reduce((sum, r) => sum + incidents(r), 0);
    const withoutPhoto = month.filter((r) => !r.attachment_path).length;
    metrics = [
    { label: "Albaranes", value: String(month.length), hint: `últimos ${METRIC_DAYS} días` },
    { label: "Compras", money: true, value: formatCurrency(total), hint: `sin IVA · ${METRIC_DAYS} días` },
    { label: "Cobrado de más", money: true, value: formatCurrency(extra), hint: overcharged.length ? `en ${overcharged.length} ${overcharged.length === 1 ? "albarán" : "albaranes"} · reclamar` : "todo según lo pactado", tone: extra > 0 ? "warn" : undefined },
    { label: "Incidencias", value: String(incidentCount), hint: withoutPhoto ? `${withoutPhoto} sin foto del albarán` : "todos con foto", tone: incidentCount > 0 ? "warn" : undefined },
  ];
  }

  if (kind === "traspasos") {
    const { data, error } = await supabase
      .from("transfers")
      .select("id, code, status, created_at, from_location_id, to_location_id, transfer_lines(id, qty_sent)")
      .or(`status.in.(draft,in_transit),created_at.gte.${daysAgo(LIST_DAYS)}`)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      return { error: "No se pudieron cargar los traspasos." };
    }
    const records = (data ?? []) as unknown as Array<{
      id: string; code: string | null; status: "draft" | "in_transit" | "received" | "cancelled"; created_at: string;
      from_location_id: string; to_location_id: string; transfer_lines: Array<{ id: string; qty_sent: number }>;
    }>;
    const knownLocations = await deps.locations;
    const locationName = (id: string) => knownLocations.find((loc) => loc.id === id)?.name ?? "?";
    const statusLabel: Record<"draft" | "in_transit" | "received" | "cancelled", string> = { draft: "Borrador", in_transit: "En tránsito", received: "Recibido", cancelled: "Cancelado" };
    const statusColor: Record<"draft" | "in_transit" | "received" | "cancelled", StatusColor> = { draft: "purple", in_transit: "orange", received: "green", cancelled: "red" };
    rows = records.map((t) => {
      const actions: RowAction[] = [];
      if (t.status === "draft") {
        actions.push({ label: "Enviar", tone: "primary", onClick: () => deps.onSendTransfer(t.id) });
        actions.push({ label: "Eliminar", tone: "danger", onClick: () => deps.onDeleteTransfer(t.id) });
      } else if (t.status === "in_transit") {
        actions.push({ label: "Recibir", tone: "primary", onClick: () => deps.onReceiveTransfer(t.id) });
        actions.push({ label: "Cancelar", tone: "danger", onClick: () => deps.onCancelTransfer(t.id) });
      }
      return {
        id: t.id,
        title: `${t.code ? `${t.code} · ` : ""}${locationName(t.from_location_id)} → ${locationName(t.to_location_id)}`,
        detail: `${t.transfer_lines.length} producto${t.transfer_lines.length === 1 ? "" : "s"}`,
        status: statusLabel[t.status],
        rawStatus: t.status,
        statusColor: statusColor[t.status],
        date: formatDate(t.created_at),
        actions,
      };
    });
    const drafts = records.filter((t) => t.status === "draft").length;
    const inTransit = records.filter((t) => t.status === "in_transit").length;
    const received = records.filter((t) => t.status === "received" && t.created_at >= daysAgo(METRIC_DAYS)).length;
    metrics = [
    { label: "Por enviar", value: String(drafts), hint: drafts ? "borradores sin enviar" : "nada pendiente", tone: drafts ? "warn" : undefined },
    { label: "En tránsito", value: String(inTransit), hint: inTransit ? "pendientes de recibir" : "nada en camino", tone: inTransit ? "warn" : undefined },
    { label: "Recibidos", value: String(received), hint: `últimos ${METRIC_DAYS} días` },
  ];
  }

  if (kind === "inventarios") {
    const { data, error } = await supabase
      .from("inventory_counts")
      .select("id, code, status, started_at, closed_at, close_reason, location_id, locations(name), count_lines(id)")
      .or(`status.eq.open,started_at.gte.${daysAgo(365)}`)
      .order("started_at", { ascending: false })
      .limit(300);
    if (error) {
      return { error: "No se pudieron cargar los inventarios." };
    }
    const records = (data ?? []) as unknown as Array<{
      id: string; code: string | null; status: "open" | "closed" | "cancelled"; started_at: string; closed_at: string | null; close_reason: string | null; location_id: string;
      locations: { name: string } | null; count_lines: Array<{ id: string }>;
    }>;
    const statusLabel: Record<"open" | "closed" | "cancelled", string> = { open: "En progreso", closed: "Cerrado", cancelled: "Cancelado" };
    const statusColor: Record<"open" | "closed" | "cancelled", StatusColor> = { open: "orange", closed: "green", cancelled: "red" };
    rows = records.map((c) => {
      const actions: RowAction[] = [];
      if (c.status === "open") {
        actions.push({
          label: "Contar",
          tone: "primary",
          onClick: () => {
            deps.onCount({ id: c.id, locationId: c.location_id });
          },
        });
      }
      return {
        id: c.id,
        title: `${c.code ? `${c.code} · ` : ""}Inventario ${c.locations?.name ?? "?"}`,
        detail: `${c.count_lines.length} línea${c.count_lines.length === 1 ? "" : "s"} contadas`,
        status: statusLabel[c.status],
        rawStatus: c.status,
        statusColor: statusColor[c.status],
        date: formatDate(c.started_at),
        actions,
      };
    });
    const openCount = records.filter((c) => c.status === "open").length;
    // El último cerrado es el de cierre más reciente, que no siempre es el que empezó más tarde.
    const lastClosed = records.filter((c) => c.status === "closed" && c.closed_at).sort((a, b) => b.closed_at!.localeCompare(a.closed_at!))[0];
    const daysSince = lastClosed?.closed_at ? Math.floor((Date.now() - new Date(lastClosed.closed_at).getTime()) / 86_400_000) : null;
    metrics = [
    { label: "En curso", value: String(openCount), hint: openCount ? "se pueden seguir contando" : "ninguno abierto" },
    { label: "Último cerrado", value: lastClosed?.closed_at ? formatDate(lastClosed.closed_at) : "Ninguno", hint: lastClosed ? `${lastClosed.locations?.name ?? "?"} · hace ${daysSince} ${daysSince === 1 ? "día" : "días"}` : "aún no se ha cerrado ninguno", tone: daysSince !== null && daysSince > 31 ? "warn" : undefined },
    { label: "Cerrados", value: String(records.filter((c) => c.status === "closed").length), hint: "último año" },
  ];
  }

  if (kind === "mermas") {
    const { data, error } = await supabase
      .from("stock_movements")
      .select("id, qty, unit_cost, reason, exit_kind, occurred_at, products(name, base_unit, dimension, product_packs(name, qty_base, is_count_default, is_purchase_default, active)), locations(name)")
      .eq("type", "waste")
      .gte("occurred_at", daysAgo(METRIC_DAYS))
      .order("occurred_at", { ascending: false })
      .limit(1000);
    if (error) {
      return { error: "No se pudieron cargar las mermas." };
    }
    const records = (data ?? []) as unknown as Array<{
      id: number; qty: number; unit_cost: number | null; reason: string | null; exit_kind: string | null; occurred_at: string;
      products: { name: string; base_unit: string; dimension: UnitDimension; product_packs: PackRow[] | null } | null; locations: { name: string } | null;
    }>;
    const kindOf = (m: { exit_kind: string | null }): ExitKind => (isExitKind(m.exit_kind) ? m.exit_kind : "merma");
    rows = records.map((m) => ({
      id: String(m.id),
      title: m.products?.name ?? "Producto",
      detail: `${EXIT_KIND_LABEL[kindOf(m)]} · ${m.products ? wasteAmount(Math.abs(m.qty), countingPacks(m.products.dimension, m.products.product_packs ?? [])) : new Decimal(String(Math.abs(m.qty))).toFixed(2)}${m.reason ? ` · ${m.reason}` : ""}`,
      status: m.locations?.name ?? "Local",
      rawStatus: "registrada",
      // Rojo solo lo que es pérdida; una invitación o el consumo del personal no lo es.
      statusColor: isLoss(kindOf(m)) ? "red" : "orange",
      date: formatDate(m.occurred_at),
      actions: [],
    }));
    const valueOf = (m: { qty: number; unit_cost: number | null }) => Math.abs(m.qty) * (m.unit_cost ?? 0);
    const lossRows = records.filter((m) => isLoss(kindOf(m)));
    const losses = lossRows.reduce((sum, m) => sum + valueOf(m), 0);
    const others = records.filter((m) => !isLoss(kindOf(m))).reduce((sum, m) => sum + valueOf(m), 0);
    const byProduct = new Map<string, number>();
    for (const m of lossRows) byProduct.set(m.products?.name ?? "Producto", (byProduct.get(m.products?.name ?? "Producto") ?? 0) + valueOf(m));
    const worst = [...byProduct.entries()].sort((a, b) => b[1] - a[1])[0];
    metrics = [
    { label: "Pérdidas", money: true, value: formatCurrency(losses), hint: `roturas, caducados y errores · ${METRIC_DAYS} días`, tone: losses > 0 ? "warn" : undefined },
    { label: "Otras salidas", money: true, value: formatCurrency(others), hint: "invitaciones, personal, catas y eventos" },
    { label: "Registros", value: String(records.length), hint: `últimos ${METRIC_DAYS} días` },
    { label: "Más pérdida", money: true, value: worst ? worst[0] : "—", hint: worst ? formatCurrency(worst[1]) : "sin pérdidas", small: true },
  ];
  }

  return { rows, metrics };
}
