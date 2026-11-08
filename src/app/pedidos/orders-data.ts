// Datos y utilidades compartidas de la pantalla de pedidos.
import Decimal from "decimal.js";
import { createClient } from "@/lib/supabase/client";
import { decimalText, parseDecimal } from "@/lib/format";
import type { SupplierTerms } from "@/lib/supplier-terms";

export type OrderStatus = "draft" | "sent" | "partial" | "received" | "cancelled";
export type Role = "owner" | "admin" | "manager" | "staff";

export type Location = { id: string; name: string };
export type Supplier = { id: string; name: string; email: string | null; phone: string | null; terms: SupplierTerms };
/** Línea de pedido. El nombre del producto y del formato vienen con la línea (no hace falta el catálogo). */
export type OrderLine = { id?: string; packId: string; productName?: string; packName?: string; packsQty: string; packPrice: string; receivedPacks: string };
export type Order = {
  id: string;
  /** Código legible (PED-2026-0001), 0034. */
  code: string;
  status: OrderStatus;
  locationId: string;
  locationName: string;
  supplierId: string;
  supplierName: string;
  note: string;
  expectedDate: string;
  createdAt: string;
  sentAt: string | null;
  lines: OrderLine[];
};

export type Reference = {
  orgId: string;
  orgName: string;
  userName: string;
  role: Role;
  locations: Location[];
  suppliers: Supplier[];
};

export const STATUS_LABEL: Record<OrderStatus, string> = {
  draft: "Borrador",
  sent: "Enviado",
  partial: "Recibido en parte",
  received: "Recibido",
  cancelled: "Cancelado",
};

export const canManage = (role: Role) => role !== "staff";

export function orderTotal(order: Pick<Order, "lines">): Decimal {
  return order.lines.reduce((acc, l) => acc.plus(new Decimal(parseDecimal(l.packsQty) ?? 0).mul(parseDecimal(l.packPrice) ?? 0)), new Decimal(0));
}

export async function loadReference(): Promise<Reference> {
  const supabase = createClient();
  if (!supabase) throw new Error("Configura las variables de Supabase.");
  const { data: session } = await supabase.auth.getSession();
  const user = session.session?.user;
  if (!user) throw new Error("Inicia sesión de nuevo.");
  const [membership, profile, locations, suppliers] = await Promise.all([
    supabase.from("memberships").select("org_id, role, organizations(name)").eq("user_id", user.id).limit(1).maybeSingle(),
    supabase.from("profiles").select("full_name").eq("user_id", user.id).maybeSingle(),
    supabase.from("locations").select("id, name").eq("active", true).order("name"),
    supabase.from("suppliers").select("id, name, email, phone, order_days, order_cutoff, lead_time_hours, min_order").eq("active", true).order("name"),
  ]);
  const member = membership.data as { org_id: string; role: Role; organizations: { name: string } | null } | null;
  if (!member) throw new Error("No perteneces a ninguna organización.");
  return {
    orgId: member.org_id,
    orgName: member.organizations?.name ?? "",
    userName: profile.data?.full_name?.trim() || user.email?.split("@")[0] || "",
    role: member.role,
    locations: (locations.data ?? []) as Location[],
    suppliers: (suppliers.data ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      phone: s.phone,
      terms: {
        orderDays: s.order_days?.length ? s.order_days : null,
        orderCutoff: s.order_cutoff,
        leadTimeHours: s.lead_time_hours,
        minOrder: s.min_order === null ? null : String(s.min_order),
      },
    })),
  };
}

export async function loadOrders(statuses: OrderStatus[], locationId: string): Promise<Order[]> {
  const supabase = createClient();
  if (!supabase) throw new Error("Configura las variables de Supabase.");
  let query = supabase
    .from("purchase_orders")
    .select("id, code, status, location_id, supplier_id, note, expected_date, created_at, sent_at, suppliers(name), locations(name), lines:purchase_order_lines(id, pack_id, packs_qty, pack_price, received_packs, pack:product_packs(name, product:products(name)))")
    .in("status", statuses)
    .order("created_at", { ascending: false })
    .limit(200);
  if (locationId) query = query.eq("location_id", locationId);
  const { data, error } = await query;
  if (error) {
    throw new Error("No se pudieron cargar los pedidos.");
  }
  type Row = {
    id: string; code: string | null; status: OrderStatus; location_id: string; supplier_id: string; note: string | null; expected_date: string | null;
    created_at: string; sent_at: string | null; suppliers: { name: string } | null; locations: { name: string } | null;
    lines: Array<{ id: string; pack_id: string; packs_qty: number; pack_price: number | null; received_packs: number; pack: { name: string; product: { name: string } | null } | null }>;
  };
  return ((data ?? []) as unknown as Row[]).map((o) => ({
    id: o.id,
    status: o.status,
    locationId: o.location_id,
    locationName: o.locations?.name ?? "",
    code: o.code ?? "",
    supplierId: o.supplier_id,
    supplierName: o.suppliers?.name ?? "",
    note: o.note ?? "",
    expectedDate: o.expected_date ?? "",
    createdAt: o.created_at,
    sentAt: o.sent_at,
    lines: o.lines.map((l) => ({
      id: l.id,
      packId: l.pack_id,
      productName: l.pack?.product?.name,
      packName: l.pack?.name,
      packsQty: String(l.packs_qty),
      packPrice: l.pack_price === null ? "" : String(l.pack_price),
      receivedPacks: String(l.received_packs),
    })),
  }));
}

/** Guarda un borrador: cabecera y líneas (en borrador no hay recepciones, se reemplazan todas). */
export async function saveDraft(ref: Reference, order: Omit<Order, "id" | "code" | "status" | "createdAt" | "sentAt" | "locationName" | "supplierName"> & { id?: string }): Promise<string> {
  const supabase = createClient();
  if (!supabase) throw new Error("Configura las variables de Supabase.");
  const header = { supplier_id: order.supplierId, note: order.note.trim() || null, expected_date: order.expectedDate || null };
  let id = order.id;
  if (id) {
    const { data, error } = await supabase.from("purchase_orders").update(header).eq("id", id).select("id");
    if (error || !data?.length) throw new Error("No se pudo guardar: el pedido ya no está en borrador o no tienes acceso.");
    const { error: delError } = await supabase.from("purchase_order_lines").delete().eq("order_id", id);
    if (delError) throw new Error("No se pudieron actualizar las líneas.");
  } else {
    const { data, error } = await supabase.from("purchase_orders").insert({ org_id: ref.orgId, location_id: order.locationId, ...header }).select("id").single();
    if (error || !data) throw new Error("No se pudo crear el pedido.");
    id = data.id;
  }
  const lines = order.lines
    .filter((l) => (parseDecimal(l.packsQty) ?? new Decimal(0)).gt(0))
    .map((l) => ({ order_id: id!, pack_id: l.packId, packs_qty: parseDecimal(l.packsQty)!.toNumber(), pack_price: parseDecimal(l.packPrice)?.toNumber() ?? null }));
  if (lines.length > 0) {
    const { error } = await supabase.from("purchase_order_lines").insert(lines);
    if (error) throw new Error(error.code === "23505" ? "Hay un formato repetido en el pedido." : "No se pudieron guardar las líneas.");
  }
  return id!;
}

/** Texto del pedido para email o WhatsApp. */
export function orderText(ref: Reference, order: Order): string {
  const lines = order.lines.map((l) => {
    return `• ${decimalText(l.packsQty)} × ${l.packName ?? "formato"} — ${l.productName ?? "producto"}`;
  });
  const when = order.expectedDate ? `, con entrega el ${new Date(`${order.expectedDate}T12:00:00`).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}` : "";
  return [
    `Hola ${order.supplierName}:`,
    "",
    `Os hacemos el siguiente pedido para ${order.locationName}${when}:`,
    "",
    ...lines,
    ...(order.note ? ["", order.note] : []),
    "",
    "Gracias.",
    [ref.userName, ref.orgName].filter(Boolean).join(" · "),
  ].join("\n");
}
