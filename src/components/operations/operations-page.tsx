"use client";

import {
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
import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { usePermissions } from "@/lib/permissions";
import { euros as formatCurrency, quantity } from "@/lib/format";
import { toBaseQty, unitChoices, type UnitChoice } from "@/lib/packs";
import { clearLookupCache, lookupPackRows, purchasePack, type LookupProduct } from "@/lib/product-lookup";
import { onPendingFile, takePending } from "@/lib/pending-file";
import { guessSupplier, packForRead, type AlbaranPhotoRead } from "@/lib/albaran-ocr";
import { readAlbaranFile } from "@/lib/albaran-pdf";
import { civilToday } from "@/lib/business-day";
import { ProductPicker } from "@/components/product-picker/product-picker";
import { attachReceiptPhoto, describeDiff, INCIDENT_LABEL, INCIDENTS, priceCheck, type Incident } from "@/lib/receipt-checks";
import { EXIT_KIND_LABEL, EXIT_KIND_REASONS, EXIT_KINDS, type ExitKind } from "@/lib/exit-kinds";
import "./operations.css";
import "./operations-modal.css";
import { CountModal } from "./count-modal";
import { matchReadLines, type ReceiptLine } from "./receipt-lines";
import { NewProduct, NewSupplier, ReceiptScan, type ScanState } from "./receipt-new-items";
import { PhotoPick } from "./receipt-photo-pick";
import { applyPick } from "./receipt-pick";
import { checkReceiptLines } from "./receipt-save";
import { albaranNumber, supplierNameGuess } from "@/lib/albaran-cabecera";
import { filasDeOcr } from "@/lib/documento-filas";
import { loadOperations, type DisplayRow, type Location, type Metric, type OperationKind } from "./operations-data";
import { FilePick } from "@/components/ui/file-pick";

/** Formatos en los que se puede escribir la cantidad de un producto elegido en el buscador. */
const unitsOf = (product: LookupProduct | null): UnitChoice[] => (product ? unitChoices(product.dimension, lookupPackRows(product)) : []);
type SupplierOption = { id: string; name: string };
type Reference = { orgId: string; locations: Location[]; suppliers: SupplierOption[] };
type TransferLine = { product: LookupProduct | null; qty: string; unit: string };

/** Locales y proveedores compartidos por las cuatro pantallas de operativa (el catálogo ya no se
 *  descarga: cada formulario busca en el servidor solo lo que se escribe). */
const NO_PRICES = new Map<string, number>();

let referenceCache: (Reference & { userId: string }) | null = null;

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

function newRef() {
  return crypto.randomUUID();
}

export function OperationsPage({ kind }: { kind: OperationKind }) {
  const Icon = icons[kind];
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [rows, setRows] = useState<DisplayRow[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const perms = usePermissions();
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
  const [rDocDate, setRDocDate] = useState(() => civilToday());
  const [receiptKey, setReceiptKey] = useState(() => crypto.randomUUID());
  const [rPhoto, setRPhoto] = useState<File | null>(null);
  /** Último precio de cada formato con el proveedor elegido: lo pactado con lo que se compara el albarán. */
  const [agreedBySupplier, setAgreedBySupplier] = useState<{ supplierId: string; prices: Map<string, number> } | null>(null);
  const agreed = agreedBySupplier && agreedBySupplier.supplierId === rSupplier ? agreedBySupplier.prices : NO_PRICES;
  const [rLines, setRLines] = useState<ReceiptLine[]>([{ product: null, packId: "", qty: "", price: "", incident: "" }]);
  const [scan, setScan] = useState<ScanState>({ stage: "idle" });
  const [supplierHint, setSupplierHint] = useState("");

  // Inventarios
  const [ivLocation, setIvLocation] = useState("");
  const [countModal, setCountModal] = useState<{ id: string; locationId: string } | null>(null);

  function applyReference(ref: Reference) {
    setOrgId(ref.orgId);
    setLocations(ref.locations);
    setSuppliers(ref.suppliers);
    setReferenceReady(true);
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

    const result = await loadOperations(kind, {
      supabase,
      locations: locationsOverride ?? locations,
      onSendTransfer: (id) => void handleSendTransfer(id),
      onDeleteTransfer: (id) => void handleDeleteTransfer(id),
      onReceiveTransfer: (id) => void handleReceiveTransfer(id),
      onCancelTransfer: (id) => void handleCancelTransfer(id),
      onCount: setCountModal,
    });
    if ("error" in result) setLoadError(result.error);
    else {
      setRows(result.rows);
      setMetrics(result.metrics);
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

  // Foto de un albarán enviada desde el asistente: se abre Nueva recepción y se lee (cuando ya están los proveedores).
  const [photoToScan, setPhotoToScan] = useState<File | null>(null);
  const [photoRead, setPhotoRead] = useState<AlbaranPhotoRead | null>(null);
  const [referenceReady, setReferenceReady] = useState(false);
  useEffect(() => {
    if (kind !== "recepciones") return;
    const pick = () => {
      const entry = takePending<AlbaranPhotoRead>("recepcion");
      if (entry) { setPhotoToScan(entry.file); setPhotoRead(entry.read); }
    };
    void Promise.resolve().then(pick);
    return onPendingFile("recepcion", pick);
  }, [kind]);
  useEffect(() => {
    if (!photoToScan || !referenceReady) return;
    const photo = photoToScan;
    void (async () => {
      await Promise.resolve();
      setPhotoToScan(null);
      openModal();
      await handleScanAlbaran(photo, photoRead ?? undefined);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoToScan, referenceReady]);

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
    setRDocDate(civilToday());
    setReceiptKey(crypto.randomUUID());
    setRLines([{ product: null, packId: "", qty: "", price: "", incident: "" }]);
    setRPhoto(null);
    setScan({ stage: "idle" });
    setSupplierHint("");
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
    const incomplete = trLines.find((line) => (line.product && !(Number(line.qty) > 0)) || (!line.product && line.qty.trim() !== ""));
    if (incomplete) { setFormError(incomplete.product ? `Revisa la cantidad de ${incomplete.product.name}: tiene que ser mayor que 0.` : "Hay una línea con cantidad y sin producto: elígelo o quita la línea."); return; }
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
      // Sin líneas el traspaso no sirve: se retira para no dejar un borrador vacío.
      await supabase.from("transfers").delete().eq("id", transfer.id);
      setFormError("No se pudo guardar el traspaso. No se ha creado nada: puedes volver a intentarlo.");
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

  async function handleScanAlbaran(file: File | null, preRead?: AlbaranPhotoRead) {
    if (!file) return;
    setRPhoto(file);
    setFormError("");
    setScan({ stage: "reading" });
    try {
      const result = preRead ?? (await readAlbaranFile(file));
      if (result.lines.length === 0) {
        setScan({ stage: "error", message: "No he encontrado líneas con cantidad, precio e importe. Rellénalas a mano; la foto queda adjunta." });
        return;
      }
      let supplierId = rSupplier;
      if (!supplierId) {
        const guessed = guessSupplier(result.texts, suppliers);
        if (guessed) {
          supplierId = guessed.id;
          setRSupplier(guessed.id);
        }
      }
      if (result.date) setRDocDate(result.date);
      const number = result.number ?? albaranNumber(filasDeOcr(result.texts));
      if (number && !rDocNumber.trim()) setRDocNumber(number);
      setRLines(await matchReadLines(result, supplierId, rLocation));
      setScan({ stage: "done", result });
    } catch (e) {
      setScan({ stage: "error", message: e instanceof Error && e.message ? e.message : "No se pudo leer la foto." });
    }
  }

  async function handleCreateReceipt() {
    setFormError("");
    if (!rLocation) { setFormError("Elige un local."); return; }
    const checked = checkReceiptLines(rLines);
    if ("error" in checked) { setFormError(checked.error); return; }

    setSaving(true);
    const supabase = createClient();
    if (!supabase) { setFormError("Supabase no está configurado."); setSaving(false); return; }
    // Cabecera, líneas y stock entran juntos o no entra nada. La clave del intento no cambia al reintentar: si la
    // respuesta se perdió y la recepción ya estaba registrada, se recupera esa en vez de crear otra.
    const { data: receiptId, error } = await supabase.rpc("register_receipt", {
      p_key: receiptKey, p_org: orgId, p_location: rLocation, p_supplier: rSupplier || null,
      p_doc_number: rDocNumber.trim() || null, p_doc_date: rDocDate, p_lines: checked.lines,
    });
    if (error || !receiptId) {
      setFormError(error?.code === "42501" ? "No tienes permiso para registrar recepciones en este local." : "No se pudo registrar la recepción. No se ha guardado nada: puedes volver a intentarlo.");
      setSaving(false);
      return;
    }
    // Lo leído de la foto se recuerda para este proveedor: la próxima vez la línea sale sola.
    const learned = rLines
      .filter((line) => line.read?.code && line.product && line.packId)
      .map((line) => ({ code: line.read!.code, description: line.read!.description, product_id: line.product!.id, pack_id: line.packId || null }));
    if (rSupplier && learned.length > 0) await supabase.rpc("remember_supplier_codes", { p_supplier: rSupplier, p_items: learned });
    if (rPhoto) {
      const photoError = await attachReceiptPhoto(supabase, { id: receiptId, orgId, locationId: rLocation }, rPhoto);
      if (photoError) {
        // La recepción ya está registrada: se avisa y se cierra igualmente para no duplicarla.
        setLoadError(`Recepción registrada, pero ${photoError.charAt(0).toLowerCase()}${photoError.slice(1)} Puedes adjuntarla desde la ficha de la recepción.`);
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
        <div className="operation-metrics" style={{ "--cols": Math.max(metrics.length, 1) } as CSSProperties}>
          {(metrics.length ? metrics : [{ label: "Cargando", value: "—", hint: "" }]).map((m: Metric) => perms && !perms.seesCosts && m.money ? { ...m, value: "Sin permiso", hint: "pide el permiso «ve costes»", tone: undefined } : m).map((m) => (
            <div key={m.label} className={m.tone === "warn" ? "warn" : undefined}>
              <span>{m.label}</span>
              <strong className={m.small ? "small" : undefined} title={m.value}>{m.value}</strong>
              <small>{m.hint}</small>
            </div>
          ))}
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
            <div className={`operation-row${row.href ? " linked" : ""}`} key={row.id}>
              <div className="operation-reference">
                <span className={`operation-icon ${row.statusColor}`}><Icon size={16} /></span>
                <strong>{row.href ? <Link href={row.href}>{row.title}</Link> : row.title}</strong>
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
                <ReceiptScan scan={scan} missing={rLines.filter((l) => l.read && !l.product).length} onFile={(f) => void handleScanAlbaran(f)}>
                  {rPhoto?.type.startsWith("image/") && <PhotoPick file={rPhoto} lines={rLines} apply={(target, texts, index) => applyPick(target, texts, index, { suppliers, rSupplier, rLocation, rLines, setRLines, setRSupplier, setRDocNumber, setRDocDate, setSupplierHint })} />}
                </ReceiptScan>
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
                {(scan.stage === "done" || supplierHint) && !rSupplier && (
                  <NewSupplier key={supplierHint || "leido"} suggested={supplierHint || (scan.stage === "done" ? supplierNameGuess(filasDeOcr(scan.result.texts)) : null) || ""} orgId={orgId} onCreated={(s) => { setSuppliers([...suppliers, s].sort((x, y) => x.name.localeCompare(y.name))); setRSupplier(s.id); }} />
                )}
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
                    <div className={`op-receipt-line${line.read && !line.product ? " needs-product" : ""}`} key={index}>
                      {line.read && (
                        <p className="op-read-line">
                          En el albarán: <b>{line.read.description || "(sin descripción)"}</b>
                          {line.read.code && !line.read.code.startsWith("txt:") ? ` · ref. ${line.read.code}` : ""}
                          {` · ${quantity(line.read.qty, line.read.unit ?? "", 3).trim()} × ${formatCurrency(line.read.price)}`}
                          {line.read.discountPct ? ` − ${line.read.discountPct} %` : ""}
                          {` = ${formatCurrency(line.read.amount)}`}
                          {line.read.lot ? ` · lote ${line.read.lot}` : ""}
                        </p>
                      )}
                      <ProductPicker
                        value={line.product}
                        options={{ locationId: rLocation || null, supplierId: rSupplier || null }}
                        ariaLabel={`Producto de la línea ${index + 1}`}
                        renderMeta={(p) => {
                          const price = purchasePack(p)?.price;
                          return price ? formatCurrency(price) : null;
                        }}
                        onChange={(product) => {
                          // Una línea leída de la foto: el formato según cómo viene en el albarán (por kilos, por
                          // unidades) y el precio del albarán, que es lo que se ha pagado.
                          const usual = product ? purchasePack(product) ?? null : null;
                          const pack = product && line.read ? packForRead(product.packs, product.dimension, line.read.unit, line.read.qty, usual) : usual;
                          setRLines(rLines.map((l, i) => i === index ? { ...l, product, packId: pack?.id ?? "", price: !l.read && pack?.price ? String(Number(pack.price)) : l.price } : l));
                        }}
                      />
                      {line.read && !line.product && (
                        <NewProduct read={line.read} orgId={orgId} vatRate={scan.stage === "done" ? scan.result.vatRate : null} onCreated={(product) => setRLines(rLines.map((l, i) => i === index ? { ...l, product, packId: product.packs[0]!.id } : l))} />
                      )}
                      <div className="op-modal-line-row with-price">
                        <select value={line.packId} aria-label="Formato de compra" disabled={!line.product} onChange={(e) => {
                          const pack = line.product?.packs.find((k) => k.id === e.target.value);
                          setRLines(rLines.map((l, i) => i === index ? { ...l, packId: e.target.value, price: pack?.price ? String(Number(pack.price)) : l.price } : l));
                        }}>
                          {(!line.product || !line.packId) && <option value="">{line.product ? "Elige formato" : "Formato"}</option>}
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
                <div className="op-photo"><span className="op-photo-title">Foto del albarán</span>
                  <FilePick file={rPhoto} onChange={setRPhoto} accept="image/*,application/pdf" capture="environment" label="Hacer foto o adjuntar" />
                  <small>{rPhoto ? "Se guardará con la recepción como justificante." : "Opcional: queda guardada como justificante."}</small>
                </div>
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
