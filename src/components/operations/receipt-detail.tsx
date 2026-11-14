"use client";

// Ficha de un albarán: cabecera, totales y líneas con lo pactado y las incidencias. Los importes solo se ven con
// el permiso «ve costes»; el resto de la ficha es igual para todos.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Camera } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { usePermissions } from "@/lib/permissions";
import { decimalText, euros } from "@/lib/format";
import { INCIDENT_LABEL, isIncident, photoUrl } from "@/lib/receipt-checks";
import { lineAmount, lineOvercharge, receiptSummary } from "@/lib/receipt-detail";
import "./receipt-detail.css";

interface Line {
  id: string;
  product: string;
  pack: string;
  qty: string;
  price: string;
  expected: string | null;
  incident: string | null;
  note: string | null;
}

interface Head {
  code: string | null;
  docNumber: string | null;
  docDate: string;
  status: "open" | "closed" | "cancelled";
  attachmentPath: string | null;
  supplier: string;
  location: string;
  lines: Line[];
}

const STATUS_LABEL = { open: "Abierto", closed: "Cerrado", cancelled: "Anulado" } as const;

type Raw = {
  code: string | null; doc_number: string | null; doc_date: string; status: Head["status"]; attachment_path: string | null;
  suppliers: { name: string } | null; locations: { name: string } | null;
  receipt_lines: Array<{
    id: string; qty: string; price: string; expected: string | null; incident: string | null; incident_note: string | null;
    product_packs: { name: string; products: { name: string } | null } | null;
  }>;
};

export function ReceiptDetail({ id }: { id: string }) {
  const supabase = useMemo(() => createClient(), []);
  const perms = usePermissions();
  const [head, setHead] = useState<Head | null>(null);
  const [state, setState] = useState<"cargando" | "listo" | "no-encontrado" | "error">("cargando");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) return setState("error");
      const { data, error } = await supabase
        .from("goods_receipts")
        .select("code, doc_number, doc_date, status, attachment_path, suppliers(name), locations(name), receipt_lines(id, qty:packs_qty::text, price:pack_price::text, expected:expected_price::text, incident, incident_note, product_packs(name, products(name)))")
        .eq("id", id)
        .maybeSingle();
      if (cancelled) return;
      if (error) return setState("error");
      if (!data) return setState("no-encontrado");
      const raw = data as unknown as Raw;
      setHead({
        code: raw.code,
        docNumber: raw.doc_number,
        docDate: raw.doc_date,
        status: raw.status,
        attachmentPath: raw.attachment_path,
        supplier: raw.suppliers?.name ?? "Proveedor sin asignar",
        location: raw.locations?.name ?? "Local sin asignar",
        lines: raw.receipt_lines.map((l) => ({
          id: l.id,
          product: l.product_packs?.products?.name ?? "Producto",
          pack: l.product_packs?.name ?? "",
          qty: l.qty,
          price: l.price,
          expected: l.expected,
          incident: l.incident,
          note: l.incident_note,
        })),
      });
      setState("listo");
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [supabase, id]);

  if (state === "cargando") return <main className="receipt-page"><p className="receipt-muted">Cargando el albarán…</p></main>;
  if (state === "no-encontrado") return <Shell><p className="receipt-muted">No encuentro este albarán. Puede que no sea de tu organización.</p></Shell>;
  if (state === "error" || !head) return <Shell><p className="receipt-error">No se pudo cargar el albarán.</p></Shell>;

  const costs = perms?.seesCosts ?? false;
  const summary = receiptSummary(head.lines.map((l) => ({ qty: l.qty, price: l.price, expected: l.expected, incident: l.incident })));
  const title = head.docNumber ? `Albarán ${head.docNumber}` : "Albarán sin número";

  return (
    <Shell>
      <div className="receipt-heading">
        <div>
          <p className="receipt-eyebrow">{head.code ?? "Recepción"} · {STATUS_LABEL[head.status]}</p>
          <h1>{title}</h1>
          <p className="receipt-meta">{head.supplier} · {head.location} · {new Date(head.docDate).toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })}</p>
        </div>
        {head.attachmentPath && <PhotoButton supabase={supabase} path={head.attachmentPath} />}
      </div>

      <div className="receipt-totals">
        {costs && <div><span>Importe</span><strong>{euros(summary.amount)}</strong></div>}
        <div><span>Líneas</span><strong>{head.lines.length}</strong></div>
        <div className={summary.incidents > 0 ? "warn" : undefined}><span>Incidencias</span><strong>{summary.incidents}</strong></div>
        {costs && <div className={summary.overcharge.gt(0) ? "warn" : undefined}><span>Por encima de lo pactado</span><strong>{summary.overcharge.gt(0) ? euros(summary.overcharge) : "Nada"}</strong></div>}
      </div>

      <section className="receipt-panel">
        <table className="receipt-lines">
          <thead>
            <tr>
              <th>Producto</th>
              <th className="num">Cantidad</th>
              {costs && <th className="num">Precio</th>}
              {costs && <th className="num">Importe</th>}
              {costs && <th className="num">Pactado</th>}
              <th>Incidencia</th>
            </tr>
          </thead>
          <tbody>
            {head.lines.map((l) => {
              const line = { qty: l.qty, price: l.price, expected: l.expected, incident: l.incident };
              const over = lineOvercharge(line);
              return (
                <tr key={l.id}>
                  <td><strong>{l.product}</strong>{l.pack && <small>{l.pack}</small>}</td>
                  <td className="num">{decimalText(l.qty)}</td>
                  {costs && <td className="num">{euros(l.price)}</td>}
                  {costs && <td className="num">{euros(lineAmount(line))}</td>}
                  {costs && <td className={`num${over.gt(0) ? " warn" : ""}`}>{l.expected ? euros(l.expected) : "—"}</td>}
                  <td>
                    {isIncident(l.incident) ? <span className="receipt-incident">{INCIDENT_LABEL[l.incident]}</span> : <span className="receipt-muted">—</span>}
                    {l.note && <small>{l.note}</small>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="receipt-page">
      <div className="receipt-content">
        <Link className="receipt-back" href="/recepciones"><ArrowLeft size={15} /> Recepciones</Link>
        {children}
      </div>
    </main>
  );
}

function PhotoButton({ supabase, path }: { supabase: ReturnType<typeof createClient>; path: string }) {
  // La ventana se abre en el clic: los navegadores bloquean las que se abren después de esperar.
  function open() {
    if (!supabase) return;
    const win = window.open("", "_blank");
    void photoUrl(supabase, path).then((url) => {
      if (url && win) win.location.href = url;
      else win?.close();
    });
  }
  return (
    <button type="button" className="receipt-photo" onClick={open}>
      <Camera size={15} /> Ver foto del albarán
    </button>
  );
}
