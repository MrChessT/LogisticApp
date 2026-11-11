// Líneas de una recepción y cómo se rellenan desde la foto de un albarán: cada línea leída se empareja
// con un producto del catálogo (primero lo aprendido de ese proveedor; si no, por nombre, solo si está claro).
import { createClient } from "@/lib/supabase/client";
import { bestProduct, lineCode, packForUnit, searchTerms, type AlbaranPhotoRead } from "@/lib/albaran-ocr";
import { lookupProducts, purchasePack, type LookupProduct } from "@/lib/product-lookup";
import type { Incident } from "@/lib/receipt-checks";

/** Lo que decía el albarán en la foto (si la línea se leyó de una foto): se enseña y, al guardar, se recuerda. */
export type ReadLine = { code: string | null; description: string; qty: number; unit: string | null; price: number; discountPct: number | null; amount: number; lot: string | null };
export type ReceiptLine = { product: LookupProduct | null; packId: string; qty: string; price: string; incident: Incident | ""; read?: ReadLine };

/** Empareja cada línea leída: primero lo aprendido de este proveedor; si no, el catálogo, solo si está claro. */
export async function matchReadLines(result: AlbaranPhotoRead, supplierId: string, locationId: string): Promise<ReceiptLine[]> {
  const supabase = createClient();
  const memory = new Map<string, { productId: string; packId: string | null; name: string }>();
  if (supabase && supplierId) {
    const { data } = await supabase.from("supplier_item_codes").select("code, product_id, pack_id, products(name)").eq("supplier_id", supplierId);
    for (const r of (data ?? []) as Array<{ code: string; product_id: string; pack_id: string | null; products: { name: string } | null }>) {
      memory.set(r.code, { productId: r.product_id, packId: r.pack_id, name: r.products?.name ?? "" });
    }
  }
  const opts = { locationId: locationId || null, supplierId: supplierId || null, limit: 8 };
  return Promise.all(result.lines.map(async (l): Promise<ReceiptLine> => {
    const code = lineCode(l);
    // Con descuento, el precio que cuenta es el neto (importe / cantidad).
    const price = l.discountPct ? Math.round((l.amount / l.qty) * 10000) / 10000 : l.price;
    const read: ReadLine = { code, description: l.description, qty: l.qty, unit: l.unit, price: l.price, discountPct: l.discountPct, amount: l.amount, lot: l.lot };
    let product: LookupProduct | null = null;
    let packId = "";
    try {
      const remembered = code ? memory.get(code) : undefined;
      if (remembered?.name) {
        product = (await lookupProducts(remembered.name, opts)).find((p) => p.id === remembered.productId) ?? null;
        if (product && remembered.packId && product.packs.some((k) => k.id === remembered.packId)) packId = remembered.packId;
      }
      if (!product && l.description) {
        const found = new Map<string, LookupProduct>();
        for (const term of searchTerms(l.description)) for (const p of await lookupProducts(term, opts)) found.set(p.id, p);
        product = bestProduct(l.description, [...found.values()]);
      }
    } catch {
      product = null;
    }
    if (product && !packId) packId = (packForUnit(product.packs, product.dimension, l.unit, l.qty) ?? purchasePack(product))?.id ?? "";
    return { product, packId, qty: String(l.qty), price: String(price), incident: "", read };
  }));
}
