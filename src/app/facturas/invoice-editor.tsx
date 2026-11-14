"use client";

import { useEffect, useMemo, useState } from "react";
import { Camera, CheckCircle2, FileText, Paperclip, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { euros } from "@/lib/format";
import { addDays, invoiceMatch, paymentDays } from "@/lib/invoices";
import { camposDeFactura, readDocumentPhoto } from "@/lib/documento-foto";

// Alta y edición de una factura de proveedor: datos, albaranes que cubre (con el cuadre en vivo), archivo
// y pago. La base de datos valida (save_invoice): base + IVA = total, albaranes del proveedor y libres.

export type InvoiceRow = {
  id: string; code: string; number: string; supplierId: string; supplierName: string; date: string; due: string | null;
  subtotal: number; vat: number; total: number; status: "pendiente" | "pagada"; paidAt: string | null;
  attachment: string | null; notes: string; receipts: number; receiptsTotal: number; difference: number; overdue: boolean;
};
export type UnbilledReceipt = { id: string; code: string; docNumber: string | null; date: string; supplierId: string; locationName: string; total: number };
export type SupplierOption = { id: string; name: string; paymentTerms: string | null };

const today = () => new Date().toISOString().slice(0, 10);
const dec = (s: string) => {
  const t = s.replace(/\s|€/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};
const text = (n: number | null | undefined) => (n === null || n === undefined ? "" : n.toFixed(2).replace(".", ","));

export function InvoiceEditor({ invoice, preset, initialFile, orgId, suppliers, unbilled, onClose, onChanged }: {
  invoice: InvoiceRow | null;
  /** PDF que llega del asistente: la factura nueva se abre con él ya adjunto. */
  initialFile?: File;
  preset: { supplierId: string; receiptIds: string[] } | null;
  orgId: string;
  suppliers: SupplierOption[];
  unbilled: UnbilledReceipt[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [supplierId, setSupplierId] = useState(invoice?.supplierId ?? preset?.supplierId ?? "");
  const [number, setNumber] = useState(invoice?.number ?? "");
  const [date, setDate] = useState(invoice?.date ?? today());
  const [due, setDue] = useState(() => {
    if (invoice) return invoice.due ?? "";
    const days = paymentDays(suppliers.find((s) => s.id === preset?.supplierId)?.paymentTerms);
    return days === null ? "" : addDays(today(), days);
  });
  const [subtotal, setSubtotal] = useState(text(invoice?.subtotal));
  const [vat, setVat] = useState(text(invoice?.vat));
  const [total, setTotal] = useState(text(invoice?.total));
  const [notes, setNotes] = useState(invoice?.notes ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set(preset?.receiptIds ?? []));
  const [linked, setLinked] = useState<UnbilledReceipt[]>([]);
  const [file, setFile] = useState<File | null>(initialFile ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<{ ok: boolean; text: string } | null>(null);

  // Albaranes ya enlazados (si se edita) + los libres del proveedor.
  useEffect(() => {
    if (!invoice) return;
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      if (!supabase) return;
      const { data } = await supabase
        .from("invoice_receipts")
        .select("receipt_id, goods_receipts(id, code, doc_number, doc_date, supplier_id, locations(name), receipt_lines(packs_qty, pack_price))")
        .eq("invoice_id", invoice.id);
      if (cancelled) return;
      const rows = (data ?? []).map((r) => {
        const g = r.goods_receipts as unknown as { id: string; code: string; doc_number: string | null; doc_date: string; supplier_id: string; locations: { name: string } | null; receipt_lines: Array<{ packs_qty: number; pack_price: number }> };
        return { id: g.id, code: g.code, docNumber: g.doc_number, date: g.doc_date, supplierId: g.supplier_id, locationName: g.locations?.name ?? "", total: Math.round(g.receipt_lines.reduce((s, l) => s + l.packs_qty * l.pack_price, 0) * 100) / 100 };
      });
      setLinked(rows);
      setSelected(new Set(rows.map((r) => r.id)));
    })();
    return () => {
      cancelled = true;
    };
  }, [invoice]);

  const available = useMemo(() => {
    const own = linked.filter((r) => r.supplierId === supplierId);
    return [...own, ...unbilled.filter((r) => r.supplierId === supplierId && !own.some((o) => o.id === r.id))].sort((a, b) => a.date.localeCompare(b.date));
  }, [linked, unbilled, supplierId]);
  const chosen = available.filter((r) => selected.has(r.id));
  const receiptsTotal = Math.round(chosen.reduce((s, r) => s + r.total, 0) * 100) / 100;
  const base = dec(subtotal);
  const match = base !== null ? invoiceMatch(base, receiptsTotal, chosen.length, euros) : null;

  function pickSupplier(id: string) {
    setSupplierId(id);
    setSelected(new Set());
    // Vencimiento según sus condiciones de pago (si no se ha puesto a mano).
    const before = paymentDays(suppliers.find((s) => s.id === supplierId)?.paymentTerms);
    const days = paymentDays(suppliers.find((s) => s.id === id)?.paymentTerms);
    const automatic = !due || (before !== null && due === addDays(date, before));
    if (automatic && date) setDue(days === null ? "" : addDays(date, days));
  }

  /** Si el vencimiento era el que sale de las condiciones, se mueve con la fecha. */
  function changeDate(next: string) {
    const days = paymentDays(suppliers.find((s) => s.id === supplierId)?.paymentTerms);
    if (days !== null && date && next && (!due || due === addDays(date, days))) setDue(addDays(next, days));
    setDate(next);
  }

  /** Base o IVA cambian → total; si se escribe el total, se respeta. */
  function recalc(nextBase: string, nextVat: string) {
    const b = dec(nextBase);
    const v = dec(nextVat);
    if (b !== null && v !== null) setTotal(text(b + v));
  }

  function applyVatRate(rate: number) {
    const b = dec(subtotal);
    if (b === null) return;
    const v = Math.round(b * rate) / 100;
    setVat(text(v));
    setTotal(text(b + v));
  }

  /** Rellena los campos con lo que se lee en la foto. Solo en facturas nuevas; la persona revisa y registra. */
  async function readPhoto(photo: File) {
    setReading(true);
    setReadNote(null);
    try {
      const c = camposDeFactura(await readDocumentPhoto(photo));
      if (c.number) setNumber(c.number);
      if (c.date) changeDate(c.date);
      if (c.subtotal) setSubtotal(c.subtotal);
      if (c.vat) setVat(c.vat);
      if (c.total) setTotal(c.total);
      setFile(photo);
      setReadNote(c.aviso);
    } catch (e) {
      setReadNote({ ok: false, text: e instanceof Error ? e.message : "No se pudo leer la foto." });
    } finally {
      setReading(false);
    }
  }

  async function save() {
    setError("");
    const b = dec(subtotal);
    const v = dec(vat || "0");
    const t = dec(total);
    if (!supplierId) return setError("Elige el proveedor.");
    if (!number.trim()) return setError("Escribe el número de la factura.");
    if (!date) return setError("Indica la fecha de la factura.");
    if (b === null || v === null || t === null) return setError("Base, IVA y total tienen que ser importes.");
    if (Math.abs(t - (b + v)) > 0.05) return setError("La base más el IVA no da el total: revisa los importes.");
    if (due && due < date) return setError("El vencimiento no puede ser anterior a la fecha de la factura.");
    const supabase = createClient();
    if (!supabase) return;
    setSaving(true);
    const { data: id, error: err } = await supabase.rpc("save_invoice", {
      p_id: invoice?.id ?? null, p_org: orgId, p_supplier: supplierId, p_number: number.trim(), p_date: date, p_due: due || null,
      p_subtotal: b, p_vat: v, p_total: t, p_notes: notes.trim() || null, p_receipts: chosen.map((r) => r.id),
    });
    if (err || !id) {
      setSaving(false);
      if (err?.code === "23505") return setError("Ese número de factura ya está registrado para este proveedor.");
      if (err?.message.includes("invalid_receipts")) return setError("Algún albarán ya está en otra factura o no es de este proveedor. Recarga y vuelve a probar.");
      if (err?.code === "42501") return setError("No tienes permiso para registrar facturas.");
      return setError("No se pudo guardar la factura.");
    }
    if (file) {
      const ext = (file.name.split(".").pop() ?? "pdf").toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf";
      const path = `${orgId}/${id}/factura-${crypto.randomUUID().slice(0, 8)}.${ext}`;
      const up = await supabase.storage.from("facturas").upload(path, file, { contentType: file.type || undefined });
      if (up.error) {
        setSaving(false);
        onChanged();
        return setError("La factura se guardó, pero no el archivo. Vuelve a adjuntarlo.");
      }
      await supabase.from("invoices").update({ attachment_path: path }).eq("id", id);
    }
    setSaving(false);
    onChanged();
    onClose();
  }

  async function setPaid(paid: boolean) {
    if (!invoice) return;
    const { error: err } = (await createClient()?.from("invoices").update({ status: paid ? "pagada" : "pendiente", paid_at: paid ? today() : null }).eq("id", invoice.id)) ?? { error: null };
    if (err) return setError("No se pudo cambiar el pago.");
    onChanged();
    onClose();
  }

  async function openFile() {
    if (!invoice?.attachment) return;
    const win = window.open("", "_blank");
    const { data } = (await createClient()?.storage.from("facturas").createSignedUrl(invoice.attachment, 300)) ?? { data: null };
    if (data?.signedUrl && win) win.location.href = data.signedUrl;
    else win?.close();
  }

  async function remove() {
    if (!invoice) return;
    const { error: err } = (await createClient()?.from("invoices").delete().eq("id", invoice.id)) ?? { error: null };
    if (err) return setError("No se pudo eliminar (una factura pagada no se elimina).");
    onChanged();
    onClose();
  }

  return (
    <div className="modal-layer editor-layer" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <section className="product-editor invoice-editor" role="dialog" aria-modal="true" aria-label={invoice ? `Factura ${invoice.number}` : "Nueva factura"}>
        <header className="editor-header">
          <div>
            <p className="eyebrow">{invoice ? `${invoice.code} · ${invoice.status === "pagada" ? `Pagada el ${new Date(invoice.paidAt!).toLocaleDateString("es-ES")}` : "Pendiente de pago"}` : "Nueva factura"}</p>
            <h2>{suppliers.find((s) => s.id === supplierId)?.name ?? "Factura de proveedor"}{number ? ` · ${number}` : ""}</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        </header>

        <div className="editor-body invoice-body">
          {!invoice && (
            <div className="invoice-read">
              <label className="ghost-button"><Camera size={14} /> {reading ? "Leyendo la foto…" : "Leer foto de la factura"}
                <input type="file" hidden accept="image/*" disabled={reading} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void readPhoto(f); }} />
              </label>
              {readNote && <p className={`editor-message ${readNote.ok ? "" : "error"}`}>{readNote.text}</p>}
            </div>
          )}
          <div className="editor-grid invoice-fields">
            <label className="span-2">Proveedor
              <select value={supplierId} onChange={(e) => pickSupplier(e.target.value)} disabled={!!invoice && invoice.status === "pagada"}>
                <option value="">Elige el proveedor…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label>Número de factura<input value={number} onChange={(e) => setNumber(e.target.value)} maxLength={60} placeholder="F-2026/118" /></label>
            <label>Fecha<input type="date" value={date} onChange={(e) => changeDate(e.target.value)} /></label>
            <label>Vencimiento<input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
            <span />
            <label>Base imponible<input value={subtotal} inputMode="decimal" onChange={(e) => { setSubtotal(e.target.value); recalc(e.target.value, vat || "0"); }} placeholder="0,00" /></label>
            <label>IVA
              <span className="invoice-vat">
                <input value={vat} inputMode="decimal" onChange={(e) => { setVat(e.target.value); recalc(subtotal, e.target.value); }} placeholder="0,00" />
                {[21, 10, 4].map((r) => <button key={r} type="button" className="ghost-button" onClick={() => applyVatRate(r)}>{r} %</button>)}
              </span>
            </label>
            <label>Total<input value={total} inputMode="decimal" onChange={(e) => setTotal(e.target.value)} placeholder="0,00" /></label>
          </div>

          <div className="editor-section">
            <p className="facet-title">Albaranes que cubre</p>
            {!supplierId ? (
              <p className="section-hint">Elige el proveedor para ver sus albaranes sin facturar.</p>
            ) : available.length === 0 ? (
              <p className="section-hint">Este proveedor no tiene albaranes cerrados sin factura.</p>
            ) : (
              <div className="invoice-receipts">
                {available.map((r) => (
                  <label key={r.id} className={`check-option invoice-receipt ${selected.has(r.id) ? "on" : ""}`}>
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} />
                    <span><b>{r.code}</b>{r.docNumber ? ` · albarán ${r.docNumber}` : ""}<small>{new Date(r.date).toLocaleDateString("es-ES")} · {r.locationName}</small></span>
                    <strong>{euros(r.total)}</strong>
                  </label>
                ))}
              </div>
            )}
            <div className={`invoice-match ${match?.tone ?? "none"}`}>
              <span>Albaranes marcados: <b>{euros(receiptsTotal)}</b> ({chosen.length})</span>
              <span>Base de la factura: <b>{base === null ? "—" : euros(base)}</b></span>
              <strong>{match ? match.label : "Escribe la base para cuadrar"}</strong>
            </div>
            {match?.tone === "over" && <p className="section-hint">El proveedor cobra más de lo que se recibió a precio de albarán: revisa precios o reclama el abono.</p>}
          </div>

          <div className="editor-section">
            <p className="facet-title">Archivo y notas</p>
            <div className="invoice-file">
              {invoice?.attachment && <button type="button" className="ghost-button" onClick={() => void openFile()}><FileText size={14} /> Ver factura</button>}
              <label className="ghost-button"><Paperclip size={14} /> {file ? file.name : invoice?.attachment ? "Cambiar archivo" : "Adjuntar PDF o foto"}
                <input type="file" hidden accept="application/pdf,image/*" onChange={(e) => { const f = e.target.files?.[0] ?? null; if (f && f.size > 10 * 1024 * 1024) { setError("El archivo ocupa más de 10 MB."); return; } setFile(f); }} />
              </label>
            </div>
            <textarea className="recipe-instructions" rows={2} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder="Notas (abono pendiente, rappel, devolución…)" />
          </div>
        </div>

        {error && <p className="editor-message error">{error}</p>}
        <footer className="editor-footer">
          {invoice ? (
            confirmDelete ? (
              <div className="delete-confirm">
                <span>¿Eliminar la factura {invoice.number}?</span>
                <button className="danger-button" onClick={() => void remove()}>Sí, eliminar</button>
                <button className="ghost-button" onClick={() => setConfirmDelete(false)}>Cancelar</button>
              </div>
            ) : (
              <div className="footer-left">
                {invoice.status === "pendiente" && <button className="ghost-button danger" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> Eliminar</button>}
                <button className="ghost-button" onClick={() => void setPaid(invoice.status !== "pagada")}><CheckCircle2 size={14} /> {invoice.status === "pagada" ? "Marcar pendiente" : "Marcar pagada hoy"}</button>
              </div>
            )
          ) : <span />}
          <div className="footer-right">
            <button className="catalog-primary" disabled={saving} onClick={() => void save()}>{saving ? "Guardando..." : invoice ? "Guardar cambios" : "Registrar factura"}</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
