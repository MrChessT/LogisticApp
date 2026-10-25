// Recepción blindada (especificación A, hoja Recepciones): incidencias por línea, lo cobrado frente a lo
// pactado y la foto del albarán. Lo usan /recepciones y la recepción de un pedido.
import Decimal from "decimal.js";
import type { SupabaseClient } from "@supabase/supabase-js";

export const INCIDENTS = ["faltante", "sobrante", "roto", "caducado", "precio_distinto", "otro"] as const;
export type Incident = (typeof INCIDENTS)[number];

export const INCIDENT_LABEL: Record<Incident, string> = {
  faltante: "Falta mercancía",
  sobrante: "Llega de más",
  roto: "Roto o dañado",
  caducado: "Caducado o caducidad corta",
  precio_distinto: "Precio distinto",
  otro: "Otra",
};

export function isIncident(value: unknown): value is Incident {
  return typeof value === "string" && (INCIDENTS as readonly string[]).includes(value);
}

export interface PriceCheck {
  /** Cobrado − pactado, por formato. */
  diff: Decimal;
  /** En porcentaje sobre lo pactado (null si lo pactado es 0). */
  pct: Decimal | null;
  /** «sube» si cobran más, «baja» si menos, «igual» si coincide (al céntimo). */
  status: "sube" | "baja" | "igual";
}

/** Compara el precio del albarán con el pactado. null si no hay con qué comparar o el precio no es válido. */
export function priceCheck(charged: Decimal.Value | null | undefined, agreed: Decimal.Value | null | undefined): PriceCheck | null {
  if (charged === null || charged === undefined || charged === "" || agreed === null || agreed === undefined || agreed === "") return null;
  let c: Decimal;
  let a: Decimal;
  try {
    c = new Decimal(charged);
    a = new Decimal(agreed);
  } catch {
    return null;
  }
  if (c.isNaN() || a.isNaN() || c.isNegative()) return null;
  const diff = c.minus(a);
  const status = diff.abs().lt(0.005) ? "igual" : diff.gt(0) ? "sube" : "baja";
  return { diff, pct: a.isZero() ? null : diff.div(a).mul(100), status };
}

/** «+1,30 € (+1,9 %)» */
export function describeDiff(check: PriceCheck, money: (v: number) => string): string {
  const sign = check.diff.gt(0) ? "+" : check.diff.lt(0) ? "−" : "";
  const pct = check.pct ? ` (${sign}${check.pct.abs().toFixed(1).replace(".", ",")} %)` : "";
  return `${sign}${money(check.diff.abs().toNumber())}${pct}`;
}

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];

/** Si el fichero se puede subir como foto del albarán; si no, por qué. */
export function photoProblem(file: { size: number; type: string }): string | null {
  if (!PHOTO_TYPES.includes(file.type)) return "La foto tiene que ser JPG, PNG, WEBP, HEIC o PDF.";
  if (file.size > MAX_PHOTO_BYTES) return "La foto pesa más de 10 MB.";
  return null;
}

/** Ruta en el almacén «albaranes»: organización/local/recepción/fichero (lo exigen las políticas). */
export function photoPath(orgId: string, locationId: string, receiptId: string, fileName: string): string {
  const ext = (fileName.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? "jpg").toLowerCase();
  return `${orgId}/${locationId}/${receiptId}/albaran-${Date.now()}.${ext}`;
}

/** Sube la foto y la enlaza a la recepción. Devuelve un mensaje de error o null. */
export async function attachReceiptPhoto(
  supabase: SupabaseClient,
  receipt: { id: string; orgId: string; locationId: string },
  file: File,
): Promise<string | null> {
  const problem = photoProblem(file);
  if (problem) return problem;
  const path = photoPath(receipt.orgId, receipt.locationId, receipt.id, file.name);
  const upload = await supabase.storage.from("albaranes").upload(path, file, { contentType: file.type, upsert: false });
  if (upload.error) return "No se pudo subir la foto del albarán.";
  const { error } = await supabase.rpc("set_receipt_attachment", { p_receipt: receipt.id, p_path: path });
  if (error) {
    await supabase.storage.from("albaranes").remove([path]);
    return "La foto se subió pero no se pudo enlazar a la recepción.";
  }
  return null;
}

/** Enlace temporal (10 minutos) para ver la foto de un albarán. */
export async function photoUrl(supabase: SupabaseClient, path: string): Promise<string | null> {
  const { data } = await supabase.storage.from("albaranes").createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}
