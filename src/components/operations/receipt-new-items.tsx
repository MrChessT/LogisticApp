"use client";

import { useState, type ReactNode } from "react";
import { Camera, CheckCircle2, Plus, TriangleAlert } from "lucide-react";
import { FilePick } from "@/components/ui/file-pick";
import { createClient } from "@/lib/supabase/client";
import { euros as formatCurrency } from "@/lib/format";
import { productDraft } from "@/lib/albaran-cabecera";
import type { AlbaranPhotoRead } from "@/lib/albaran-ocr";
import type { LookupProduct } from "@/lib/product-lookup";

// Lo que viene en el albarán y aún no está dado de alta: el proveedor y los productos se crean desde la propia
// recepción, con lo que dice el papel. Los permisos los decide la base de datos.

export type ScanState = { stage: "idle" } | { stage: "reading" } | { stage: "error"; message: string } | { stage: "done"; result: AlbaranPhotoRead };

/** Bloque «Leer albarán con foto»: elegir la foto, el estado de la lectura y su resultado. */
export function ReceiptScan({ scan, missing, onFile, children }: { scan: ScanState; missing: number; onFile: (file: File | null) => void; children?: ReactNode }) {
  return (
    <div className="op-scan">
      <span className="op-scan-title"><Camera size={16} aria-hidden="true" /> Leer albarán con foto</span>
      {scan.stage === "reading" ? (
        <p className="op-scan-status" role="status">Leyendo el albarán…</p>
      ) : (
        <>
          <FilePick file={null} onChange={onFile} accept="image/*" capture="environment" label={scan.stage === "done" ? "Leer otra foto" : "Hacer foto del albarán"} />
          {scan.stage === "idle" && <small>Rellena las líneas solas. Se lee en este dispositivo; revísalo antes de registrar.</small>}
        </>
      )}
      {scan.stage === "error" && <p className="op-scan-status warn" role="alert"><TriangleAlert size={15} aria-hidden="true" /> {scan.message}</p>}
      {scan.stage === "done" && <ScanResult result={scan.result} missing={missing} />}
      {children}
    </div>
  );
}

/** Resultado de leer la foto: si cuadra y cuántas líneas quedan sin producto. */
function ScanResult({ result: r, missing }: { result: AlbaranPhotoRead; missing: number }) {
  const lines = `${r.lines.length} ${r.lines.length === 1 ? "línea" : "líneas"}`;
  return (
    <div className={`op-scan-result ${r.status === "cuadra" ? "ok" : "warn"}`} role="status">
      {r.status === "cuadra" ? <CheckCircle2 size={16} aria-hidden="true" /> : <TriangleAlert size={16} aria-hidden="true" />}
      <span>
        {r.status === "cuadra" && <>Leídas {lines}: suman {formatCurrency(r.linesTotal)}{r.headerDiscountPct ? ` − ${r.headerDiscountPct} % de descuento = base ${formatCurrency(r.base!)}` : " = base del albarán"} · IVA{r.vatRate ? ` ${r.vatRate} %` : ""} {formatCurrency(r.vat!)} · total {formatCurrency(r.total!)}. Cuadra.</>}
        {r.status === "parcial" && <>Leídas {lines}: suman {formatCurrency(r.linesTotal)}, igual que la base del albarán, pero no he visto el total con IVA. Compáralo con el papel.</>}
        {r.status === "no_cuadra" && <>Leídas {lines} ({formatCurrency(r.linesTotal)}), pero las cuentas no cuadran con el albarán: puede faltar una línea o haber un número mal leído. Compáralo con el papel.</>}
        {missing > 0 && <> {missing === 1 ? "Una línea no tiene" : `${missing} líneas no tienen`} producto: elígelo o créalo, y la próxima vez de este proveedor saldrá solo.</>}
      </span>
    </div>
  );
}

/** El proveedor del albarán no está en la lista: se da de alta con su nombre (editable) y queda elegido. */
export function NewSupplier({ suggested, orgId, onCreated }: { suggested: string; orgId: string; onCreated: (s: { id: string; name: string }) => void }) {
  const [name, setName] = useState(suggested);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create() {
    const clean = name.replace(/\s+/g, " ").trim();
    if (clean.length < 2) return setError("Escribe el nombre del proveedor.");
    const supabase = createClient();
    if (!supabase) return;
    setBusy(true);
    setError("");
    const { data, error: err } = await supabase.from("suppliers").insert({ org_id: orgId, name: clean }).select("id, name").single();
    setBusy(false);
    if (err || !data) return setError(err?.code === "23505" ? "Ya hay un proveedor con ese nombre: elígelo en la lista." : err?.code === "42501" ? "No tienes permiso para crear proveedores." : "No se pudo crear el proveedor.");
    onCreated(data);
  }
  return (
    <div className="op-new-item">
      <span>El proveedor del albarán no está dado de alta.</span>
      <div className="op-new-item-row">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Nombre del proveedor" aria-label="Nombre del proveedor nuevo" />
        <button type="button" onClick={() => void create()} disabled={busy}><Plus size={14} /> {busy ? "Creando…" : "Crear proveedor"}</button>
      </div>
      {error && <small className="warn" role="alert">{error}</small>}
    </div>
  );
}

/** Crea el producto de una línea del albarán (con su formato de compra) y lo devuelve listo para la línea. */
export function NewProduct({ read, orgId, vatRate, onCreated }: {
  read: { description: string; unit: string | null; qty: number };
  orgId: string;
  vatRate: number | null;
  onCreated: (product: LookupProduct) => void;
}) {
  const draft = productDraft(read);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!draft) return null;
  async function create() {
    const supabase = createClient();
    if (!supabase || !draft) return;
    setBusy(true);
    setError("");
    const { data: product, error: err } = await supabase
      .from("products")
      .insert({ org_id: orgId, name: draft.name, dimension: draft.dimension, ...(vatRate !== null ? { vat_rate: vatRate } : {}) })
      .select("id, name, dimension, base_unit")
      .single();
    if (err || !product) {
      setBusy(false);
      return setError(err?.code === "23505" ? "Ya existe un producto con ese nombre: búscalo arriba." : err?.code === "42501" ? "No tienes permiso para crear productos." : "No se pudo crear el producto.");
    }
    const { data: pack, error: packErr } = await supabase
      .from("product_packs")
      .insert({ product_id: product.id, name: draft.packName, qty_base: draft.qtyBase, is_purchase_default: true, is_count_default: true })
      .select("id, name, qty_base")
      .single();
    setBusy(false);
    if (packErr || !pack) return setError("El producto se creó, pero no su formato de compra. Búscalo arriba y revísalo en Productos.");
    onCreated({
      id: product.id, name: product.name, dimension: product.dimension, base_unit: product.base_unit, category: null, family: null, in_location: false, stock: null,
      packs: [{ id: pack.id, name: pack.name, qty: String(pack.qty_base), count: true, purchase: true, price: null }],
    });
  }
  return (
    <div className="op-new-item">
      <button type="button" onClick={() => void create()} disabled={busy}><Plus size={14} /> {busy ? "Creando…" : `Crear «${draft.name}» (por ${draft.packName.toLowerCase()})`}</button>
      {error && <small className="warn" role="alert">{error}</small>}
    </div>
  );
}
