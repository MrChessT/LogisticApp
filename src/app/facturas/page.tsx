"use client";

import { useEffect, useMemo, useState } from "react";
import { CirclePlus, FileText, Paperclip, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { euros, normalizeText } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import { daysUntil, invoiceMatch } from "@/lib/invoices";
import { InvoiceEditor, type InvoiceRow, type SupplierOption, type UnbilledReceipt } from "./invoice-editor";
import "../productos/productos.css";
import "../productos/product-editor.css";
import "../escandallos/escandallos.css";
import "./facturas.css";

// Facturas de proveedor: qué hay que pagar y cuándo, y si cada factura cuadra con lo que se recibió
// (sus albaranes). También los albaranes cerrados que aún no tienen factura. Solo dirección con «ve costes».

type Tab = "pendientes" | "vencidas" | "pagadas" | "todas";
const date = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("es-ES") : "—");

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null);
  const [unbilled, setUnbilled] = useState<UnbilledReceipt[]>([]);
  const [unbilledNames, setUnbilledNames] = useState<Record<string, string>>({});
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [orgId, setOrgId] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("pendientes");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<{ invoice: InvoiceRow | null; preset: { supplierId: string; receiptIds: string[] } | null } | null>(null);
  const perms = usePermissions();
  const allowed = perms ? ["owner", "admin", "manager"].includes(perms.role) && perms.seesCosts : null;

  async function reload() {
    const supabase = createClient();
    if (!supabase) return setError("Configura las variables de Supabase.");
    const { data: m } = await supabase.from("memberships").select("org_id").limit(1).maybeSingle();
    const org = m?.org_id ?? "";
    setOrgId(org);
    if (!org) return setInvoices([]);
    const [inv, unb, sup] = await Promise.all([
      supabase.from("v_invoices").select("*").eq("org_id", org).order("invoice_date", { ascending: false }),
      supabase.from("v_unbilled_receipts").select("*").eq("org_id", org).order("doc_date"),
      supabase.from("suppliers").select("id, name, payment_terms").eq("org_id", org).eq("active", true).order("name"),
    ]);
    if (inv.error || unb.error || sup.error) return setError("No se pudieron cargar las facturas.");
    setInvoices(
      (inv.data ?? []).map((i) => ({
        id: i.id, code: i.code ?? "", number: i.number, supplierId: i.supplier_id, supplierName: i.supplier_name,
        date: i.invoice_date, due: i.due_date, subtotal: Number(i.subtotal), vat: Number(i.vat_total), total: Number(i.total),
        status: i.status as InvoiceRow["status"], paidAt: i.paid_at, attachment: i.attachment_path, notes: i.notes ?? "",
        receipts: Number(i.receipts), receiptsTotal: Number(i.receipts_total), difference: Number(i.difference), overdue: !!i.overdue,
      })),
    );
    setUnbilled(
      (unb.data ?? []).map((r) => ({
        id: r.id, code: r.code ?? "", docNumber: r.doc_number, date: r.doc_date, supplierId: r.supplier_id, locationName: r.location_name, total: Number(r.total),
      })),
    );
    setUnbilledNames(Object.fromEntries((unb.data ?? []).map((r) => [r.supplier_id, r.supplier_name])));
    setSuppliers((sup.data ?? []).map((s) => ({ id: s.id, name: s.name, paymentTerms: s.payment_terms })));
    setError("");
  }

  useEffect(() => {
    if (!allowed) return;
    async function start() {
      await Promise.resolve();
      await reload();
    }
    void start();
  }, [allowed]);

  const all = useMemo(() => invoices ?? [], [invoices]);
  const pending = all.filter((i) => i.status === "pendiente");
  const overdue = pending.filter((i) => i.overdue);
  const dueSoon = pending.filter((i) => !i.overdue && i.due && daysUntil(i.due) <= 7);
  const withDiff = all.filter((i) => i.receipts > 0 && Math.abs(i.difference) > 0.5);
  const toPay = pending.reduce((s, i) => s + i.total, 0);
  const counts: Record<Tab, number> = { pendientes: pending.length, vencidas: overdue.length, pagadas: all.length - pending.length, todas: all.length };
  const visible = all
    .filter((i) => (tab === "pendientes" ? i.status === "pendiente" : tab === "vencidas" ? i.overdue : tab === "pagadas" ? i.status === "pagada" : true))
    .filter((i) => !query || normalizeText(`${i.supplierName} ${i.number} ${i.code}`).includes(normalizeText(query)))
    .sort((a, b) => (tab === "pendientes" || tab === "vencidas" ? (a.due ?? "9999").localeCompare(b.due ?? "9999") : b.date.localeCompare(a.date)));

  const groups = useMemo(() => {
    const map = new Map<string, UnbilledReceipt[]>();
    for (const r of unbilled) map.set(r.supplierId, [...(map.get(r.supplierId) ?? []), r]);
    return [...map.entries()].map(([supplierId, rows]) => ({ supplierId, name: unbilledNames[supplierId] ?? "", rows, total: rows.reduce((s, r) => s + r.total, 0) })).sort((a, b) => b.total - a.total);
  }, [unbilled, unbilledNames]);

  const dueLabel = (i: InvoiceRow) => {
    if (i.status === "pagada") return <small>Pagada el {date(i.paidAt)}</small>;
    if (!i.due) return <small>Sin vencimiento</small>;
    const d = daysUntil(i.due);
    if (d < 0) return <small className="due bad">Vencida hace {-d} {d === -1 ? "día" : "días"}</small>;
    if (d === 0) return <small className="due warn">Vence hoy</small>;
    return <small className={d <= 7 ? "due warn" : "due"}>Vence en {d} {d === 1 ? "día" : "días"}</small>;
  };

  return (
    <main className="catalog-page">
      <div className="catalog-content">
        <div className="catalog-heading">
          <div>
            <p className="eyebrow">Gestión · Compras</p>
            <h1>Facturas de proveedor</h1>
            <p className="catalog-subtitle">Qué hay que pagar y cuándo, y si cada factura cobra lo mismo que se recibió en sus albaranes.</p>
          </div>
          {allowed && <button className="catalog-primary" onClick={() => setOpen({ invoice: null, preset: null })}><CirclePlus size={17} /> Registrar factura</button>}
        </div>

        {allowed === false ? (
          <section className="catalog-panel"><div className="catalog-empty"><strong>Sin acceso a facturas</strong><span>Las facturas las ve la dirección con el permiso «ve costes».</span></div></section>
        ) : (
          <>
            <div className="recipe-kpis">
              <div><span>Pendiente de pago</span><strong>{euros(toPay)}</strong><small>{pending.length} facturas</small></div>
              <div className={overdue.length ? "warn" : ""}><span>Vencidas</span><strong>{euros(overdue.reduce((s, i) => s + i.total, 0))}</strong><small>{overdue.length} facturas{dueSoon.length ? ` · ${dueSoon.length} vencen esta semana` : ""}</small></div>
              <div className={withDiff.length ? "warn" : ""}><span>No cuadran con albaranes</span><strong>{withDiff.length}</strong><small>{withDiff.length ? `${euros(withDiff.reduce((s, i) => s + Math.max(i.difference, 0), 0))} cobrados de más` : "todas cuadran"}</small></div>
              <div className={unbilled.length ? "warn" : ""}><span>Albaranes sin factura</span><strong>{unbilled.length}</strong><small>{euros(unbilled.reduce((s, r) => s + r.total, 0))} recibidos</small></div>
            </div>

            <div className="catalog-tabs">
              {(["pendientes", "vencidas", "pagadas", "todas"] as Tab[]).map((t) => (
                <button key={t} className={tab === t ? "active" : undefined} onClick={() => setTab(t)}>{t[0]!.toUpperCase() + t.slice(1)} <b>{counts[t]}</b></button>
              ))}
            </div>
            <section className="catalog-panel">
              <div className="catalog-toolbar">
                <div className="catalog-search">
                  <Search size={16} />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por proveedor o número" aria-label="Buscar factura" />
                </div>
              </div>
              <div className="invoice-table">
                <div className="invoice-row invoice-head"><span>Factura</span><span>Fecha</span><span>Vencimiento</span><span>Total</span><span>Cuadre</span></div>
                {error && <div className="catalog-empty"><strong>{error}</strong></div>}
                {!invoices && !error && <div className="catalog-empty"><strong>Cargando facturas...</strong></div>}
                {invoices && visible.map((i) => {
                  const m = invoiceMatch(i.subtotal, i.receiptsTotal, i.receipts, euros);
                  return (
                    <button key={i.id} className={`invoice-row ${i.overdue ? "overdue" : ""}`} onClick={() => setOpen({ invoice: i, preset: null })}>
                      <span className="recipe-name">
                        <span className="catalog-product-icon"><FileText size={15} /></span>
                        <span>
                          <strong>{i.supplierName}</strong>
                          <small>{i.number} · {i.code}{i.attachment ? <Paperclip size={10} className="invoice-clip" aria-label="con archivo" /> : null}</small>
                        </span>
                      </span>
                      <span>{date(i.date)}</span>
                      <span className="invoice-due">{i.due ? date(i.due) : ""}{dueLabel(i)}</span>
                      <span><b>{euros(i.total)}</b><small>base {euros(i.subtotal)}</small></span>
                      <span><b className={`match-pill ${m.tone}`}>{m.label}</b></span>
                    </button>
                  );
                })}
                {invoices && visible.length === 0 && (
                  <div className="catalog-empty">
                    <strong>{all.length === 0 ? "Aún no hay facturas" : "No hay facturas aquí"}</strong>
                    <span>{all.length === 0 ? "Registra la primera desde sus albaranes sin factura (abajo) o con «Registrar factura»." : "Prueba otra pestaña o búsqueda."}</span>
                  </div>
                )}
              </div>
            </section>

            {groups.length > 0 && (
              <section className="invoice-unbilled">
                <div className="invoice-unbilled-head">
                  <h2>Albaranes sin factura</h2>
                  <p>Recepciones cerradas que ningún proveedor ha facturado todavía. Al llegar la factura, créala desde aquí con sus albaranes ya marcados.</p>
                </div>
                {groups.map((g) => (
                  <div key={g.supplierId} className="invoice-group">
                    <div>
                      <strong>{g.name}</strong>
                      <small>{g.rows.length} {g.rows.length === 1 ? "albarán" : "albaranes"} · desde el {date(g.rows[0]!.date)} · {g.rows.map((r) => r.code).join(", ")}</small>
                    </div>
                    <b>{euros(g.total)}</b>
                    <button className="ghost-button" onClick={() => setOpen({ invoice: null, preset: { supplierId: g.supplierId, receiptIds: g.rows.map((r) => r.id) } })}>Crear factura</button>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </div>
      {open && (
        <InvoiceEditor
          invoice={open.invoice}
          preset={open.preset}
          orgId={orgId}
          suppliers={suppliers}
          unbilled={unbilled}
          onClose={() => setOpen(null)}
          onChanged={() => void reload()}
        />
      )}
    </main>
  );
}
