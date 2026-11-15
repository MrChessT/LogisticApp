// Foto de un albarán enviada al asistente: se lee en el navegador (sin subirla) y se resume en una frase.
// Registrar la recepción se hace después en Nueva recepción, con las mismas comprobaciones que a mano.
import { createClient } from "@/lib/supabase/client";

export interface PhotoSummary {
  /** Lo que dice el asistente. */
  text: string;
  /** La lectura del albarán, para que Nueva recepción no la repita. */
  result?: unknown;
  /** Se han reconocido líneas de albarán. */
  read: boolean;
}

const money = (v: number) => `${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export async function summarizeAlbaranPhoto(file: File): Promise<PhotoSummary> {
  const { guessSupplier, readAlbaranPhoto } = await import("@/lib/albaran-ocr");
  const result = await readAlbaranPhoto(file);
  if (result.lines.length === 0) {
    return {
      read: false,
      text: "No he encontrado líneas de albarán (cantidad, precio e importe) en la foto. Si es un albarán, prueba con la hoja entera, recta y con luz; o regístralo a mano en Recepciones.",
    };
  }
  const supabase = createClient();
  const { data } = supabase ? await supabase.from("suppliers").select("id, name").eq("active", true) : { data: null };
  const supplier = guessSupplier(result.texts, (data ?? []) as Array<{ id: string; name: string }>);
  const status =
    result.status === "cuadra"
      ? "las líneas cuadran con el total"
      : result.status === "parcial"
        ? "las líneas suman la base, pero no he visto el total"
        : "algo no cuadra: revisa las líneas antes de registrar";
  const date = result.date ? ` del ${result.date.split("-").reverse().join("/")}` : "";
  // Pedido enviado a ese proveedor y aún sin recibir: se avisa (es lo que llega con este albarán).
  let order = "";
  if (supabase && supplier) {
    const { data: orders } = await supabase.from("purchase_orders").select("code, expected_date, locations(name)").eq("supplier_id", supplier.id).in("status", ["sent", "partial"]).order("expected_date", { ascending: true }).limit(3);
    const list = (orders ?? []) as unknown as Array<{ code: string | null; locations: { name: string } | null }>;
    if (list.length === 1) {
      const o = list[0]!;
      order = ` Tienes un pedido pendiente a ${supplier.name}${o.code ? ` (${o.code})` : ""}${o.locations?.name ? ` para ${o.locations.name}` : ""}: comprueba que lo recibido coincide.`;
    } else if (list.length > 1) order = ` Tienes ${list.length} pedidos pendientes a ${supplier.name}: comprueba a cuál corresponde.`;
  }
  const lines = `${result.lines.length} ${result.lines.length === 1 ? "línea" : "líneas"} por ${money(result.linesTotal)}`;
  const total = result.total !== null ? `, total con IVA ${money(result.total)}` : "";
  return {
    read: true,
    result,
    text: `Albarán${supplier ? ` de ${supplier.name}` : " (proveedor sin identificar)"}${date}: ${lines}${total}; ${status}.${order} Ya está preparado en Recepciones, con la foto adjunta: revisa los productos y regístralo.`,
  };
}
