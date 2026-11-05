"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  CirclePlus,
  ClipboardList,
  Filter,
  Package,
  Plus,
  Search,
  Trash2,
  Truck,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import Decimal from "decimal.js";
import { createClient } from "@/lib/supabase/client";
import { euros as formatCurrency } from "@/lib/format";
import { formatStock, type UnitDimension } from "@/lib/units";
import { countingPacks, toBaseQty, unitChoices, type PackRow, type UnitChoice } from "@/lib/packs";
import { clearLookupCache, lookupPackRows, purchasePack, type LookupProduct } from "@/lib/product-lookup";
import { ProductPicker } from "@/components/product-picker/product-picker";
import { attachReceiptPhoto, describeDiff, INCIDENT_LABEL, INCIDENTS, photoUrl, priceCheck, type Incident } from "@/lib/receipt-checks";
import { EXIT_KIND_LABEL, EXIT_KIND_REASONS, EXIT_KINDS, isExitKind, isLoss, type ExitKind } from "@/lib/exit-kinds";
import "./operations.css";
import "./operations-modal.css";
import { CountModal } from "./count-modal";

type OperationKind = "recepciones" | "traspasos" | "inventarios" | "mermas";
type StatusColor = "green" | "orange" | "purple" | "red";

type Location = { id: string; name: string };
/** Formatos en los que se puede escribir la cantidad de un producto elegido en el buscador. */
const unitsOf = (product: LookupProduct | null): UnitChoice[] => (product ? unitChoices(product.dimension, lookupPackRows(product)) : []);
type SupplierOption = { id: string; name: string };
type Reference = { orgId: string; locations: Location[]; suppliers: SupplierOption[] };
type TransferLine = { product: LookupProduct | null; qty: string; unit: string };
type ReceiptLine = { product: LookupProduct | null; packId: string; qty: string; price: string; incident: Incident | "" };

/** Locales y proveedores compartidos por las cuatro pantallas de operativa (el catálogo ya no se
 *  descarga: cada formulario busca en el servidor solo lo que se escribe). */
const NO_PRICES = new Map<string, number>();

let referenceCache: (Reference & { userId: string }) | null = null;

type RowAction = { label: string; onClick: () => void; tone: "primary" | "secondary" | "danger" };

type DisplayRow = {
  id: string;
  title: string;
  detail: string;
  status: string;
  rawStatus: string;
  statusColor: StatusColor;
  date: string;
  actions: RowAction[];
};

const icons = { recepciones: Package, traspasos: Truck, inventarios: ClipboardList, mermas: XCircle };
const eyebrows: Record<OperationKind, string> = {
  recepciones: "Operativa · Compras",
  traspasos: "Operativa · Multilocal",
  inventarios: "Operativa · Conteos",
  mermas: "Operativa · Control",
};
const titles: Record<OperationKind, string> = {
  recepciones: "Recepciones",
  traspasos: "Traspasos",
  inventarios: "Inventarios",
  mermas: "Mermas",
};
const descriptions: Record<OperationKind, string> = {
  recepciones: "Registra mercancía y actualiza el coste real del stock.",
  traspasos: "Mueve producto entre locales con trazabilidad completa.",
  inventarios: "Cuenta por zonas y detecta diferencias antes de cerrar.",
  mermas: "Registra pérdidas, invitaciones y consumo del personal por separado y entiende dónde se escapa el margen.",
};
const actionLabels: Record<OperationKind, string> = {
  recepciones: "Nueva recepción",
  traspasos: "Nuevo traspaso",
  inventarios: "Abrir inventario",
  mermas: "Registrar merma",
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function newRef() {
  return crypto.randomUUID();
}

export function OperationsPage({ kind }: { kind: OperationKind }) {
  const Icon = icons[kind];
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [rows, setRows] = useState<DisplayRow[]>([]);
  const [metrics, setMetrics] = useState<[string, string, string, string]>(["—", "—", "—", "—"]);
  const [busyId, setBusyId] = useState("");
  const [orgId, setOrgId] = useState("");
  const [locations, setLocations] = useState<Location[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // Traspasos
  const [trFrom, setTrFrom] = useState("");
  const [trTo, setTrTo] = useState("");
  const [trLines, setTrLines] = useState<TransferLine[]>([{ product: null, qty: "", unit: "" }]);

  // Mermas
  const [wLocation, setWLocation] = useState("");
  const [wProduct, setWProduct] = useState<LookupProduct | null>(null);
  const [wQty, setWQty] = useState("");
  const [wUnit, setWUnit] = useState("");
  const [wReason, setWReason] = useState("");
  const [wKind, setWKind] = useState<ExitKind>("merma");

  // Recepciones
  const [rLocation, setRLocation] = useState("");
  const [rSupplier, setRSupplier] = useState("");
  const [rDocNumber, setRDocNumber] = useState("");
  const [rDocDate, setRDocDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rPhoto, setRPhoto] = useState<File | null>(null);
  /** Último precio de cada formato con el proveedor elegido: lo pactado con lo que se compara el albarán. */
  const [agreedBySupplier, setAgreedBySupplier] = useState<{ supplierId: string; prices: Map<string, number> } | null>(null);
  const agreed = agreedBySupplier && agreedBySupplier.supplierId === rSupplier ? agreedBySupplier.prices : NO_PRICES;
  const [rLines, setRLines] = useState<ReceiptLine[]>([{ product: null, packId: "", qty: "", price: "", incident: "" }]);

  // Inventarios
  const [ivLocation, setIvLocation] = useState("");
  const [countModal, setCountModal] = useState<{ id: string; locationId: string } | null>(null);

  function applyReference(ref: Reference) {
    setOrgId(ref.orgId);
    setLocations(ref.locations);
    setSuppliers(ref.suppliers);
  }

  async function loadReference() {
    const supabase = createClient();
    if (!supabase) return null;
    // La sesión se lee del navegador (sin red): la caché nunca se enseña a otro usuario.
    const userId = (await supabase.auth.getSession()).data.session?.user.id ?? "";
    // Lo último que se cargó se pinta al instante (al volver a esta pantalla o pasar a otra
    // operativa) y se refresca igualmente en segundo plano.
    if (referenceCache?.userId === userId) applyReference(referenceCache);
    const [{ data: membership }, { data: locationRows }, { data: supplierRows }] = await Promise.all([
      supabase.from("memberships").select("org_id").limit(1).maybeSingle(),
      supabase.from("locations").select("id, name").eq("active", true).order("name"),
      supabase.from("suppliers").select("id, name").eq("active", true).order("name"),
    ]);
    const ref: Reference = {
      orgId: membership?.org_id ?? "",
      locations: (locationRows ?? []) as Location[],
      suppliers: (supplierRows ?? []) as SupplierOption[],
    };
    referenceCache = { ...ref, userId };
    applyReference(ref);
    return { supabase, locations: ref.locations };
  }

  async function loadRows(locationsOverride?: Location[] | Promise<Location[]>) {
    setLoading(true);
    setLoadError("");
    const supabase = createClient();
    if (!supabase) {
      setLoadError("Configura las variables de Supabase para continuar.");
      setLoading(false);
      return;
    }

    if (kind === "recepciones") {
      const { data, error } = await supabase
        .from("goods_receipts")
        .select("id, doc_number, doc_date, status, attachment_path, suppliers(name), locations(name), receipt_lines(packs_qty, pack_price, expected_price, incident)")
        .order("doc_date", { ascending: false });
      if (error) {
        setLoadError("No se pudieron cargar las recepciones.");
        setLoading(false);
        return;
      }
      const records = (data ?? []) as unknown as Array<{
        id: string; doc_number: string | null; doc_date: string; status: "open" | "closed" | "cancelled";
        suppliers: { name: string } | null; locations: { name: string } | null;
        attachment_path: string | null;
        receipt_lines: Array<{ packs_qty: number; pack_price: number; expected_price: number | null; incident: string | null }>;
      }>;
      // Lo cobrado de más frente a lo pactado (solo subidas) y las incidencias de cada albarán.
      const overcharge = (r: (typeof records)[number]) =>
        r.receipt_lines.reduce((sum, l) => (l.expected_price !== null && l.pack_price > l.expected_price + 0.005 ? sum + (l.pack_price - l.expected_price) * l.packs_qty : sum), 0);
      const incidents = (r: (typeof records)[number]) => r.receipt_lines.filter((l) => l.incident).length;
      setRows(
        records.map((r) => ({
          id: r.id,
          title: r.doc_number ? `Albarán ${r.doc_number}` : "Albarán sin número",
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
        })),
      );
      const openCount = records.filter((r) => r.status === "open").length;
      const total = records.reduce((sum, r) => sum + r.receipt_lines.reduce((s, l) => s + l.packs_qty * l.pack_price, 0), 0);
      const extra = records.reduce((sum, r) => sum + overcharge(r), 0);
      setMetrics([String(openCount), formatCurrency(total), extra > 0 ? `${formatCurrency(extra)} de más` : "Sin cobros de más", "—"]);
    }

    if (kind === "traspasos") {
      const { data, error } = await supabase
        .from("transfers")
        .select("id, status, created_at, from_location_id, to_location_id, transfer_lines(id, qty_sent)")
        .order("created_at", { ascending: false });
      if (error) {
        setLoadError("No se pudieron cargar los traspasos.");
        setLoading(false);
        return;
      }
      const records = (data ?? []) as unknown as Array<{
        id: string; status: "draft" | "in_transit" | "received" | "cancelled"; created_at: string;
        from_location_id: string; to_location_id: string; transfer_lines: Array<{ id: string; qty_sent: number }>;
      }>;
      const knownLocations = await (locationsOverride ?? locations);
      const locationName = (id: string) => knownLocations.find((loc) => loc.id === id)?.name ?? "?";
      const statusLabel: Record<"draft" | "in_transit" | "received" | "cancelled", string> = { draft: "Borrador", in_transit: "En tránsito", received: "Recibido", cancelled: "Cancelado" };
      const statusColor: Record<"draft" | "in_transit" | "received" | "cancelled", StatusColor> = { draft: "purple", in_transit: "orange", received: "green", cancelled: "red" };
      setRows(
        records.map((t) => {
          const actions: RowAction[] = [];
          /* eslint-disable react-hooks/immutability -- los handlers se definen más abajo y se llaman mutuamente con loadRows */
          if (t.status === "draft") {
            actions.push({ label: "Enviar", tone: "primary", onClick: () => void handleSendTransfer(t.id) });
            actions.push({ label: "Eliminar", tone: "danger", onClick: () => void handleDeleteTransfer(t.id) });
          } else if (t.status === "in_transit") {
            actions.push({ label: "Recibir", tone: "primary", onClick: () => void handleReceiveTransfer(t.id) });
            actions.push({ label: "Cancelar", tone: "danger", onClick: () => void handleCancelTransfer(t.id) });
          }
          /* eslint-enable react-hooks/immutability */
          return {
            id: t.id,
            title: `${locationName(t.from_location_id)} → ${locationName(t.to_location_id)}`,
            detail: `${t.transfer_lines.length} producto${t.transfer_lines.length === 1 ? "" : "s"}`,
            status: statusLabel[t.status],
            rawStatus: t.status,
            statusColor: statusColor[t.status],
            date: formatDate(t.created_at),
            actions,
          };
        }),
      );
      const pending = records.filter((t) => t.status === "draft" || t.status === "in_transit").length;
      const inTransit = records.filter((t) => t.status === "in_transit").length;
      setMetrics([String(pending), `${inTransit} en tránsito`, "—", "—"]);
    }

    if (kind === "inventarios") {
      const { data, error } = await supabase
        .from("inventory_counts")
        .select("id, status, started_at, location_id, locations(name), count_lines(id)")
        .order("started_at", { ascending: false });
      if (error) {
        setLoadError("No se pudieron cargar los inventarios.");
        setLoading(false);
        return;
      }
      const records = (data ?? []) as unknown as Array<{
        id: string; status: "open" | "closed" | "cancelled"; started_at: string; location_id: string;
        locations: { name: string } | null; count_lines: Array<{ id: string }>;
      }>;
      const statusLabel: Record<"open" | "closed" | "cancelled", string> = { open: "En progreso", closed: "Cerrado", cancelled: "Cancelado" };
      const statusColor: Record<"open" | "closed" | "cancelled", StatusColor> = { open: "orange", closed: "green", cancelled: "red" };
      setRows(
        records.map((c) => {
          const actions: RowAction[] = [];
          if (c.status === "open") {
            actions.push({
              label: "Contar",
              tone: "primary",
              onClick: () => {
                setCountModal({ id: c.id, locationId: c.location_id });
              },
            });
          }
          return {
            id: c.id,
            title: `Inventario ${c.locations?.name ?? "?"}`,
            detail: `${c.count_lines.length} línea${c.count_lines.length === 1 ? "" : "s"} contadas`,
            status: statusLabel[c.status],
            rawStatus: c.status,
            statusColor: statusColor[c.status],
            date: formatDate(c.started_at),
            actions,
          };
        }),
      );
      const openCount = records.filter((c) => c.status === "open").length;
      setMetrics([String(openCount), "—", "—", "—"]);
    }

    if (kind === "mermas") {
      const { data, error } = await supabase
        .from("stock_movements")
        .select("id, qty, unit_cost, reason, exit_kind, occurred_at, products(name, base_unit, dimension, product_packs(name, qty_base, is_count_default, is_purchase_default, active)), locations(name)")
        .eq("type", "waste")
        .order("occurred_at", { ascending: false })
        .limit(100);
      if (error) {
        setLoadError("No se pudieron cargar las mermas.");
        setLoading(false);
        return;
      }
      const records = (data ?? []) as unknown as Array<{
        id: number; qty: number; unit_cost: number | null; reason: string | null; exit_kind: string | null; occurred_at: string;
        products: { name: string; base_unit: string; dimension: UnitDimension; product_packs: PackRow[] | null } | null; locations: { name: string } | null;
      }>;
      const kindOf = (m: { exit_kind: string | null }): ExitKind => (isExitKind(m.exit_kind) ? m.exit_kind : "merma");
      setRows(
        records.map((m) => ({
          id: String(m.id),
          title: m.products?.name ?? "Producto",
          detail: `${EXIT_KIND_LABEL[kindOf(m)]} · ${m.products ? formatStock(Math.abs(m.qty), countingPacks(m.products.dimension, m.products.product_packs ?? [])) : new Decimal(String(Math.abs(m.qty))).toFixed(2)}${m.reason ? ` · ${m.reason}` : ""}`,
          status: m.locations?.name ?? "Local",
          rawStatus: "registrada",
          // Rojo solo lo que es pérdida; una invitación o el consumo del personal no lo es.
          statusColor: isLoss(kindOf(m)) ? "red" : "orange",
          date: formatDate(m.occurred_at),
          actions: [],
        })),
      );
      const valueOf = (m: { qty: number; unit_cost: number | null }) => Math.abs(m.qty) * (m.unit_cost ?? 0);
      const losses = records.filter((m) => isLoss(kindOf(m))).reduce((sum, m) => sum + valueOf(m), 0);
      const others = records.filter((m) => !isLoss(kindOf(m))).reduce((sum, m) => sum + valueOf(m), 0);
      setMetrics([String(records.length), formatCurrency(losses), others > 0 ? `${formatCurrency(others)} sin pérdida` : "—", "—"]);
    }

    setLoading(false);
  }

  useEffect(() => {
    if (kind !== "recepciones" || !rSupplier) return;
    let cancelled = false;
    void (async () => {
      const { data } = (await createClient()?.from("supplier_prices").select("pack_id, last_price").eq("supplier_id", rSupplier).not("last_price", "is", null)) ?? { data: null };
      if (!cancelled) setAgreedBySupplier({ supplierId: rSupplier, prices: new Map((data ?? []).map((r) => [r.pack_id as string, Number(r.last_price)])) });
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, rSupplier]);

  useEffect(() => {
    async function bootstrap() {
      // Referencia y listado a la vez; el listado solo espera a los locales si los necesita (traspasos).
      const ref = loadReference();
      await Promise.all([ref, loadRows(ref.then((r) => r?.locations ?? []))]);
    }
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  function resetForms() {
    setFormError("");
    setTrFrom("");
    setTrTo("");
    setTrLines([{ product: null, qty: "", unit: "" }]);
    setWLocation("");
    setWProduct(null);
    setWQty("");
    setWUnit("");
    setWReason("");
    setWKind("merma");
    setRLocation("");
    setRSupplier("");
    setRDocNumber("");
    setRDocDate(new Date().toISOString().slice(0, 10));
    setRLines([{ product: null, packId: "", qty: "", price: "", incident: "" }]);
    setRPhoto(null);
    setIvLocation("");
  }

  function openModal() {
    resetForms();
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
  }

  async function handleCreateTransfer() {
    setFormError("");
    if (!trFrom || !trTo) { setFormError("Elige local de origen y destino."); return; }
    if (trFrom === trTo) { setFormError("El origen y el destino deben ser distintos."); return; }
    const validLines = trLines
      .filter((line) => line.product && Number(line.qty) > 0)
      .map((line) => ({ productId: line.product!.id, qty: toBaseQty(unitsOf(line.product), line.qty, line.unit) }));
    if (validLines.length === 0) { setFormError("Añade al menos una línea con cantidad."); return; }

    setSaving(true);
    const supabase = createClient();
    if (!supabase) { setFormError("Supabase no está configurado."); setSaving(false); return; }

    const { data: transfer, error: transferError } = await supabase
      .from("transfers")
      .insert({ org_id: orgId, from_location_id: trFrom, to_location_id: trTo })
      .select("id")
      .single();
    if (transferError || !transfer) {
      setFormError("No se pudo crear el traspaso.");
      setSaving(false);
      return;
    }

    const { error: linesError } = await supabase.from("transfer_lines").insert(
      validLines.map((line) => ({ transfer_id: transfer.id, product_id: line.productId, qty_sent: line.qty })),
    );
    if (linesError) {
      setFormError("El traspaso se creó pero no se pudieron guardar las líneas.");
      setSaving(false);
      return;
    }

    setSaving(false);
    setModalOpen(false);
    clearLookupCache();
    await loadRows();
  }

  async function handleSendTransfer(id: string) {
    setBusyId(id);
    const supabase = createClient();
    if (!supabase) { setBusyId(""); return; }
    const { error } = await supabase.rpc("send_transfer", { p_transfer: id });
    if (error) setLoadError("No se pudo enviar el traspaso.");
    setBusyId("");
    await loadRows();
  }

  async function handleReceiveTransfer(id: string) {
    setBusyId(id);
    const supabase = createClient();
    if (!supabase) { setBusyId(""); return; }
    const { error } = await supabase.rpc("receive_transfer", { p_transfer: id });
    if (error) setLoadError("No se pudo recibir el traspaso.");
    setBusyId("");
    await loadRows();
  }

  async function handleCancelTransfer(id: string) {
    setBusyId(id);
    const supabase = createClient();
    if (!supabase) { setBusyId(""); return; }
    const { error } = await supabase.rpc("cancel_transfer", { p_transfer: id });
    if (error) setLoadError("No se pudo cancelar el traspaso.");
    setBusyId("");
    await loadRows();
  }

  async function handleDeleteTransfer(id: string) {
    setBusyId(id);
    const supabase = createClient();
    if (!supabase) { setBusyId(""); return; }
    const { error } = await supabase.from("transfers").delete().eq("id", id);
    if (error) setLoadError("No se pudo eliminar el traspaso.");
    setBusyId("");
    await loadRows();
  }

  async function handleRegisterWaste() {
    setFormError("");
    if (!wLocation || !wProduct || !(Number(wQty) > 0)) {
      setFormError("Elige local, producto y una cantidad mayor que cero.");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    if (!supabase) { setFormError("Supabase no está configurado."); setSaving(false); return; }
    const { error } = await supabase.rpc("register_movement", {
      p_location: wLocation,
      p_product: wProduct.id,
      p_type: "waste",
      p_qty: toBaseQty(unitsOf(wProduct), wQty, wUnit),
      p_reason: wReason.trim() || null,
      p_exit_kind: wKind,
      p_client_ref: newRef(),
    });
    if (error) {
      setFormError("No se pudo registrar la merma. Revisa que tengas acceso a ese local.");
      setSaving(false);
      return;
    }
    setSaving(false);
    setModalOpen(false);
    clearLookupCache();
    await loadRows();
  }

  async function handleCreateReceipt() {
    setFormError("");
    if (!rLocation) { setFormError("Elige un local."); return; }
    const validLines = rLines.filter((line) => line.packId && Number(line.qty) > 0 && Number(line.price) >= 0);
    if (validLines.length === 0) { setFormError("Añade al menos una línea con cantidad y precio."); return; }

    setSaving(true);
    const supabase = createClient();
    if (!supabase) { setFormError("Supabase no está configurado."); setSaving(false); return; }

    const { data: receipt, error: receiptError } = await supabase
      .from("goods_receipts")
      .insert({
        org_id: orgId,
        location_id: rLocation,
        supplier_id: rSupplier || null,
        doc_number: rDocNumber.trim() || null,
        doc_date: rDocDate,
      })
      .select("id")
      .single();
    if (receiptError || !receipt) {
      setFormError("No se pudo crear la recepción.");
      setSaving(false);
      return;
    }

    const { error: linesError } = await supabase.from("receipt_lines").insert(
      validLines.map((line) => ({ receipt_id: receipt.id, pack_id: line.packId, packs_qty: Number(line.qty), pack_price: Number(line.price), incident: line.incident || null })),
    );
    if (linesError) {
      setFormError("La recepción se creó pero no se pudieron guardar las líneas.");
      setSaving(false);
      return;
    }

    const { error: postError } = await supabase.rpc("post_receipt", { p_receipt: receipt.id });
    if (postError) {
      setFormError("La recepción se guardó pero no se pudo confirmar el stock.");
      setSaving(false);
      return;
    }
    if (rPhoto) {
      const photoError = await attachReceiptPhoto(supabase, { id: receipt.id, orgId, locationId: rLocation }, rPhoto);
      if (photoError) {
        // La recepción ya está registrada: se avisa y se cierra igualmente para no duplicarla.
        setLoadError(`Recepción registrada, pero ${photoError.charAt(0).toLowerCase()}${photoError.slice(1)}`);
      }
    }

    setSaving(false);
    setModalOpen(false);
    clearLookupCache();
    await loadRows();
  }

  async function handleOpenCount() {
    setFormError("");
    if (!ivLocation) { setFormError("Elige un local."); return; }
    setSaving(true);
    const supabase = createClient();
    if (!supabase) { setFormError("Supabase no está configurado."); setSaving(false); return; }
    const { error } = await supabase.from("inventory_counts").insert({ org_id: orgId, location_id: ivLocation });
    if (error) {
      setFormError(error.code === "23505" ? "Ya hay un inventario abierto en ese local." : "No se pudo abrir el inventario.");
      setSaving(false);
      return;
    }
    setSaving(false);
    setModalOpen(false);
    clearLookupCache();
    await loadRows();
  }

  const statusOptions: Record<OperationKind, Array<{ value: string; label: string }>> = {
    recepciones: [
      { value: "open", label: "Abierta" },
      { value: "closed", label: "Cerrada" },
      { value: "cancelled", label: "Cancelada" },
    ],
    traspasos: [
      { value: "draft", label: "Borrador" },
      { value: "in_transit", label: "En tránsito" },
      { value: "received", label: "Recibido" },
      { value: "cancelled", label: "Cancelado" },
    ],
    inventarios: [
      { value: "open", label: "En progreso" },
      { value: "closed", label: "Cerrado" },
    ],
    mermas: [],
  };
  const filteredRows = rows
    .filter((row) => `${row.title} ${row.detail} ${row.status}`.toLowerCase().includes(query.toLowerCase()))
    .filter((row) => !statusFilter || row.rawStatus === statusFilter);

  return (
    <main className="operations-page">
      <header className="operations-topbar">
        <Link href="/" className="back-link"><ArrowLeft size={16} /> Resumen</Link>
        <span className="operations-brand"><span>LogisticApp</span> · {titles[kind]}</span>
        <span />
      </header>
      <div className="operations-content">
        <div className="operations-heading">
          <div>
            <p className="operation-eyebrow">{eyebrows[kind]}</p>
            <h1>{titles[kind]}</h1>
            <p>{descriptions[kind]}</p>
          </div>
          <button className="operation-primary" onClick={openModal}>
            <CirclePlus size={17} /> {actionLabels[kind]}
          </button>
        </div>
        <div className="operation-metrics">
          <div><span>Pendientes</span><strong>{metrics[0]}</strong><small>requieren atención</small></div>
          <div><span>Valor asociado</span><strong>{metrics[1]}</strong><small>movimientos registrados</small></div>
          <div><span>Principal alerta</span><strong>{metrics[2]}</strong><small>revisar esta semana</small></div>
          <div><span>Periodo</span><strong>{metrics[3]}</strong><small>día de negocio</small></div>
        </div>
        <section className="operations-panel">
          <div className="operations-toolbar">
            <div className="operations-search">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por producto, local o documento" />
            </div>
            {statusOptions[kind].length > 0 && (
              <div className="operations-filter">
                <Filter size={14} />
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  aria-label="Filtrar por estado"
                  style={{ border: 0, outline: 0, background: "transparent", color: "inherit", font: "inherit", appearance: "none", WebkitAppearance: "none", paddingRight: 4 }}
                >
                  <option value="">Todos los estados</option>
                  {statusOptions[kind].map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <ChevronDown size={14} />
              </div>
            )}
          </div>
          <div className="operation-table-head">
            <span>Referencia</span><span>Detalle</span><span>Local / estado</span><span>Fecha</span><span />
          </div>
          {loading && (
            <div className="operation-row"><div className="operation-reference"><span className={`operation-icon purple`}><Icon size={16} /></span><strong>Cargando...</strong></div><span>Consultando Supabase</span><span /><span /><span /></div>
          )}
          {!loading && loadError && (
            <div className="operation-row"><div className="operation-reference"><span className="operation-icon red"><Icon size={16} /></span><strong>No se pudo cargar</strong></div><span>{loadError}</span><span /><span /><span /></div>
          )}
          {!loading && !loadError && filteredRows.length === 0 && (
            <div className="operation-row"><div className="operation-reference"><span className="operation-icon purple"><Icon size={16} /></span><strong>Sin resultados</strong></div><span>Todavía no hay registros.</span><span /><span /><span /></div>
          )}
          {!loading && !loadError && filteredRows.map((row) => (
            <div className="operation-row" key={row.id}>
              <div className="operation-reference">
                <span className={`operation-icon ${row.statusColor}`}><Icon size={16} /></span>
                <strong>{row.title}</strong>
              </div>
              <span>{row.detail}</span>
              <span className={`operation-status ${row.statusColor}`}>{row.status}</span>
              <span>{row.date}</span>
              <div className="op-row-actions">
                {row.actions.map((action) => (
                  <button
                    key={action.label}
                    className={`op-action-${action.tone}`}
                    disabled={busyId === row.id}
                    onClick={action.onClick}
                  >
                    {busyId === row.id ? "..." : action.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      </div>

      {modalOpen && (
        <div className="op-modal-layer" onClick={closeModal}>
          <section className="op-modal" onClick={(event) => event.stopPropagation()}>
            <div className="op-modal-heading">
              <div><p className="operation-eyebrow">{eyebrows[kind]}</p><h2>{actionLabels[kind]}</h2></div>
              <button className="op-modal-close" onClick={closeModal} aria-label="Cerrar"><X size={18} /></button>
            </div>

            {kind === "traspasos" && (
              <>
                <div className="op-modal-grid">
                  <label>Local origen
                    <select value={trFrom} onChange={(e) => setTrFrom(e.target.value)}>
                      <option value="">Elige un local</option>
                      {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
                    </select>
                  </label>
                  <label>Local destino
                    <select value={trTo} onChange={(e) => setTrTo(e.target.value)}>
                      <option value="">Elige un local</option>
                      {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
                    </select>
                  </label>
                </div>
                <div className="op-modal-lines">
                  {trLines.map((line, index) => (
                    <div className="op-modal-line-row with-unit" key={index}>
                      <ProductPicker
                        value={line.product}
                        options={{ locationId: trFrom || null }}
                        ariaLabel={`Producto de la línea ${index + 1}`}
                        onChange={(product) => setTrLines(trLines.map((l, i) => i === index ? { ...l, product, unit: unitsOf(product)[0]?.id ?? "" } : l))}
                      />
                      <input type="number" min="0" step="any" placeholder="Cant." value={line.qty} onChange={(e) => setTrLines(trLines.map((l, i) => i === index ? { ...l, qty: e.target.value } : l))} />
                      <select value={line.unit} aria-label="Formato" disabled={!line.product} onChange={(e) => setTrLines(trLines.map((l, i) => i === index ? { ...l, unit: e.target.value } : l))}>
                        {unitsOf(line.product).map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                      </select>
                      <button onClick={() => setTrLines(trLines.filter((_, i) => i !== index))} aria-label="Quitar línea"><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
                <button className="op-modal-add-line" onClick={() => setTrLines([...trLines, { product: null, qty: "", unit: "" }])}><Plus size={14} /> Añadir línea</button>
                <button className="op-modal-submit" onClick={handleCreateTransfer} disabled={saving}>{saving ? "Creando..." : "Crear traspaso"}</button>
              </>
            )}

            {kind === "mermas" && (
              <>
                <label>Local
                  <select value={wLocation} onChange={(e) => setWLocation(e.target.value)}>
                    <option value="">Elige un local</option>
                    {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
                  </select>
                </label>
                <div className="op-modal-field">
                  <span>Producto</span>
                  <ProductPicker
                    value={wProduct}
                    options={{ locationId: wLocation || null }}
                    placeholder="Busca el producto (nombre o código)"
                    onChange={(product) => { setWProduct(product); setWUnit(unitsOf(product)[0]?.id ?? ""); }}
                  />
                </div>
                <label>Cantidad
                  <input type="number" min="0" step="any" value={wQty} onChange={(e) => setWQty(e.target.value)} placeholder="0" />
                </label>
                <label>Formato
                  <select value={wUnit} disabled={!wProduct} onChange={(e) => setWUnit(e.target.value)}>
                    {unitsOf(wProduct).map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                  </select>
                </label>
                <label>Tipo de salida
                  <select value={wKind} onChange={(e) => { setWKind(e.target.value as ExitKind); setWReason(""); }}>
                    {EXIT_KINDS.map((k) => <option key={k} value={k}>{EXIT_KIND_LABEL[k]}</option>)}
                  </select>
                </label>
                <label>Motivo
                  <input list="exit-reasons" value={wReason} onChange={(e) => setWReason(e.target.value)} placeholder={`Ej. ${EXIT_KIND_REASONS[wKind].slice(0, 2).join(", ")}...`} />
                  <datalist id="exit-reasons">
                    {EXIT_KIND_REASONS[wKind].map((r) => <option key={r} value={r} />)}
                  </datalist>
                </label>
                <button className="op-modal-submit" onClick={handleRegisterWaste} disabled={saving}>{saving ? "Registrando..." : wKind === "merma" ? "Registrar merma" : `Registrar ${EXIT_KIND_LABEL[wKind].toLowerCase()}`}</button>
              </>
            )}

            {kind === "recepciones" && (
              <>
                <div className="op-modal-grid">
                  <label>Local
                    <select value={rLocation} onChange={(e) => setRLocation(e.target.value)}>
                      <option value="">Elige un local</option>
                      {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
                    </select>
                  </label>
                  <label>Proveedor (opcional)
                    <select value={rSupplier} onChange={(e) => setRSupplier(e.target.value)}>
                      <option value="">Sin proveedor</option>
                      {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </label>
                </div>
                <div className="op-modal-grid">
                  <label>Nº de albarán
                    <input value={rDocNumber} onChange={(e) => setRDocNumber(e.target.value)} placeholder="Ej. A-2841" />
                  </label>
                  <label>Fecha
                    <input type="date" value={rDocDate} onChange={(e) => setRDocDate(e.target.value)} />
                  </label>
                </div>
                <div className="op-modal-lines">
                  {rLines.map((line, index) => (
                    <div className="op-receipt-line" key={index}>
                      <ProductPicker
                        value={line.product}
                        options={{ locationId: rLocation || null, supplierId: rSupplier || null }}
                        ariaLabel={`Producto de la línea ${index + 1}`}
                        renderMeta={(p) => {
                          const price = purchasePack(p)?.price;
                          return price ? formatCurrency(price) : null;
                        }}
                        onChange={(product) => {
                          const pack = product ? purchasePack(product) : null;
                          setRLines(rLines.map((l, i) => i === index ? { ...l, product, packId: pack?.id ?? "", price: pack?.price ? String(Number(pack.price)) : l.price } : l));
                        }}
                      />
                      <div className="op-modal-line-row with-price">
                        <select value={line.packId} aria-label="Formato de compra" disabled={!line.product} onChange={(e) => {
                          const pack = line.product?.packs.find((k) => k.id === e.target.value);
                          setRLines(rLines.map((l, i) => i === index ? { ...l, packId: e.target.value, price: pack?.price ? String(Number(pack.price)) : l.price } : l));
                        }}>
                          {!line.product && <option value="">Formato</option>}
                          {(line.product?.packs ?? []).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                        </select>
                        <input type="number" min="0" step="any" placeholder="Uds." value={line.qty} onChange={(e) => setRLines(rLines.map((l, i) => i === index ? { ...l, qty: e.target.value } : l))} />
                        <input type="number" min="0" step="any" placeholder="Precio €" value={line.price} onChange={(e) => setRLines(rLines.map((l, i) => i === index ? { ...l, price: e.target.value } : l))} />
                        <button onClick={() => setRLines(rLines.filter((_, i) => i !== index))} aria-label="Quitar línea"><Trash2 size={14} /></button>
                      </div>
                      {(() => {
                        const expected = line.packId ? agreed.get(line.packId) : undefined;
                        const check = priceCheck(line.price, expected ?? null);
                        return (
                          <div className="op-receipt-check">
                            {check ? (
                              <span className={`op-price-check ${check.status}`}>
                                Pactado {formatCurrency(expected!)}{check.status === "igual" ? " · coincide" : ` · ${describeDiff(check, formatCurrency)}`}
                              </span>
                            ) : (
                              <span className="op-price-check none">{rSupplier ? "Sin precio anterior con este proveedor" : "Elige proveedor para comparar el precio"}</span>
                            )}
                            <select
                              value={line.incident}
                              aria-label={`Incidencia de la línea ${index + 1}`}
                              onChange={(e) => setRLines(rLines.map((l, i) => i === index ? { ...l, incident: e.target.value as Incident | "" } : l))}
                            >
                              <option value="">Sin incidencia</option>
                              {INCIDENTS.map((k) => <option key={k} value={k}>{INCIDENT_LABEL[k]}</option>)}
                            </select>
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
                <button className="op-modal-add-line" onClick={() => setRLines([...rLines, { product: null, packId: "", qty: "", price: "", incident: "" }])}><Plus size={14} /> Añadir línea</button>
                <label className="op-photo">Foto del albarán
                  <input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => setRPhoto(e.target.files?.[0] ?? null)} />
                  <small>{rPhoto ? "Se guardará con la recepción como justificante." : "Opcional: queda guardada como justificante."}</small>
                </label>
                <button className="op-modal-submit" onClick={handleCreateReceipt} disabled={saving}>{saving ? "Registrando..." : "Registrar recepción"}</button>
              </>
            )}

            {kind === "inventarios" && (
              <>
                <label>Local
                  <select value={ivLocation} onChange={(e) => setIvLocation(e.target.value)}>
                    <option value="">Elige un local</option>
                    {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
                  </select>
                </label>
                <button className="op-modal-submit" onClick={handleOpenCount} disabled={saving}>{saving ? "Abriendo..." : "Abrir inventario"}</button>
              </>
            )}

            {formError && <p className="op-modal-error">{formError}</p>}
          </section>
        </div>
      )}

      {countModal && (
        <CountModal count={countModal} onClose={() => setCountModal(null)} onChanged={() => void loadRows()} />
      )}
    </main>
  );
}
