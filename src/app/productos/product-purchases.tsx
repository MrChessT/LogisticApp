"use client";

// Pestañas de la ficha de un producto, solo de lectura: los proveedores que lo venden (con su código de artículo
// y su último precio) y los albaranes en los que aparece, con enlace a cada albarán.
import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { decimalText, euros } from "@/lib/format";

type Supplier = { supplier: string; code: string; price: string | null; pack: string };
type Purchase = { id: string; date: string; ref: string; supplier: string; qty: string; price: string; status: string };

export function ProductSuppliers({ productId }: { productId: string }) {
  const [rows, setRows] = useState<Supplier[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createClient();
      if (!supabase) return setRows([]);
      const { data: packs } = await supabase.from("product_packs").select("id, name").eq("product_id", productId);
      const packMap = new Map((packs ?? []).map((k) => [k.id as string, k.name as string]));
      const [codes, prices] = await Promise.all([
        supabase.from("supplier_item_codes").select("code, pack_id, supplier_id").eq("product_id", productId),
        supabase.from("supplier_prices").select("pack_id, supplier_id, last_price").in("pack_id", [...packMap.keys()]),
      ]);
      const supplierIds = [...new Set([...(codes.data ?? []), ...(prices.data ?? [])].map((r) => r.supplier_id as string))];
      const { data: suppliers } = supplierIds.length ? await supabase.from("suppliers").select("id, name").in("id", supplierIds) : { data: [] };
      if (cancelled) return;
      const nameOf = new Map((suppliers ?? []).map((x) => [x.id as string, x.name as string]));
      const priceOf = new Map((prices.data ?? []).map((p) => [`${p.pack_id}|${p.supplier_id}`, p.last_price as number | null]));
      const out: Supplier[] = (codes.data ?? []).map((c) => {
        const last = priceOf.get(`${c.pack_id}|${c.supplier_id}`);
        return {
          supplier: nameOf.get(c.supplier_id as string) ?? "Proveedor",
          code: c.code as string,
          pack: packMap.get((c.pack_id as string) ?? "") ?? "",
          price: last != null ? String(last) : null,
        };
      });
      setRows(out);
    }
    void load();
    return () => { cancelled = true; };
  }, [productId]);

  if (rows === null) return <p className="editor-muted">Cargando proveedores…</p>;
  if (rows.length === 0) return <p className="editor-muted">Ningún proveedor tiene este producto todavía. Se asocia desde el albarán o desde el asistente.</p>;
  return (
    <table className="editor-table">
      <thead><tr><th>Proveedor</th><th>Código en el proveedor</th><th>Formato</th><th>Último precio</th></tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.supplier}-${r.code}-${i}`}>
            <td><strong>{r.supplier}</strong></td>
            <td>{r.code}</td>
            <td>{r.pack || "—"}</td>
            <td>{r.price ? euros(r.price) : "Sin precio aún"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ProductPurchases({ productId }: { productId: string }) {
  const [rows, setRows] = useState<Purchase[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createClient();
      if (!supabase) return setRows([]);
      const { data: packs } = await supabase.from("product_packs").select("id").eq("product_id", productId);
      const ids = (packs ?? []).map((k) => k.id as string);
      if (ids.length === 0) return setRows([]);
      const { data } = await supabase
        .from("receipt_lines")
        .select("id, packs_qty:packs_qty::text, pack_price:pack_price::text, goods_receipts(id, code, doc_number, doc_date, status, suppliers(name))")
        .in("pack_id", ids)
        .limit(200);
      if (cancelled) return;
      const out = ((data ?? []) as unknown as Array<{ id: string; packs_qty: string; pack_price: string; goods_receipts: { id: string; code: string | null; doc_number: string | null; doc_date: string; status: string; suppliers: { name: string } | null } | null }>)
        .filter((l) => l.goods_receipts)
        .map((l) => ({
          id: l.goods_receipts!.id,
          date: l.goods_receipts!.doc_date,
          ref: l.goods_receipts!.doc_number ? `Albarán ${l.goods_receipts!.doc_number}` : l.goods_receipts!.code ?? "Sin número",
          supplier: l.goods_receipts!.suppliers?.name ?? "Proveedor sin asignar",
          qty: l.packs_qty,
          price: l.pack_price,
          status: l.goods_receipts!.status,
        }))
        .sort((a, b) => b.date.localeCompare(a.date));
      setRows(out);
    }
    void load();
    return () => { cancelled = true; };
  }, [productId]);

  if (rows === null) return <p className="editor-muted">Cargando compras…</p>;
  if (rows.length === 0) return <p className="editor-muted">Este producto todavía no aparece en ningún albarán.</p>;
  return (
    <table className="editor-table">
      <thead><tr><th>Fecha</th><th>Albarán</th><th>Proveedor</th><th>Cantidad</th><th>Precio</th><th /></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.id}-${r.date}-${r.ref}`}>
            <td>{new Date(r.date).toLocaleDateString("es-ES")}</td>
            <td>{r.ref}</td>
            <td>{r.supplier}</td>
            <td>{decimalText(r.qty)}</td>
            <td>{euros(r.price)}</td>
            <td><Link href={`/recepciones/${r.id}`}>Ver albarán</Link></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
