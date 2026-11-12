// Condiciones de un proveedor dichas en una frase: «el pedido mínimo de Makro es 200 €», «a Makro se le
// pide lunes y jueves antes de las 12», «Makro entrega en 48 h», «a Makro se le paga a 30 días». Solo lee
// la frase; qué proveedor es y si se puede cambiar lo deciden el borrador y la base de datos.
import { normalize } from "../entities/normalize";

export type TermField = "min_order" | "order_days" | "order_cutoff" | "lead_time_hours" | "payment_terms";
export interface TermChange { field: TermField; value: string }

export const TERM_LABEL: Record<TermField, string> = {
  min_order: "Pedido mínimo",
  order_days: "Días de pedido",
  order_cutoff: "Hora límite",
  lead_time_hours: "Plazo de entrega",
  payment_terms: "Pago",
};

const DAYS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];
const DAY_SHORT = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

/** «lunes y jueves» → [1, 4]; «de lunes a viernes» → [1..5]; «todos los días» → [1..7]. */
function daysIn(text: string): number[] {
  if (/\b(todos los dias|cualquier dia|a diario|cada dia)\b/.test(text)) return [1, 2, 3, 4, 5, 6, 7];
  const range = /\bde (lunes|martes|miercoles|jueves|viernes|sabado|domingo) a (lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.exec(text);
  if (range) {
    const from = DAYS.indexOf(range[1]!) + 1;
    const to = DAYS.indexOf(range[2]!) + 1;
    return from <= to ? Array.from({ length: to - from + 1 }, (_, i) => from + i) : [];
  }
  return DAYS.map((d, i) => (new RegExp(`\\b${d}s?\\b`).test(text) ? i + 1 : 0)).filter((d) => d > 0);
}

const amount = (raw: string) => raw.replace(",", ".");

export function parseTermChanges(message: string): TermChange[] {
  const text = normalize(message).replace(/[¿?¡!;]/g, " ").replace(/\s+/g, " ").trim();
  const changes: TermChange[] = [];

  const min = /\b(?:pedido minimo|minimo de pedido|minimo)\b[^0-9]*?(\d+(?:[.,]\d{1,2})?)/.exec(text);
  if (min) changes.push({ field: "min_order", value: amount(min[1]!) });

  if (/\b(se (le )?pide|le pedimos|pedimos|dias de pedido|pedidos? (los|el|de)|pide (los|el))\b/.test(text)) {
    const days = daysIn(text);
    if (days.length > 0) changes.push({ field: "order_days", value: days.join(",") });
  }

  const cutoff = /\b(?:hora limite|antes de las?|hasta las?|limite (?:a |de )?las?)\s*(\d{1,2})(?:[:.h](\d{2}))?\b/.exec(text);
  if (cutoff && Number(cutoff[1]) <= 23) changes.push({ field: "order_cutoff", value: `${cutoff[1]!.padStart(2, "0")}:${cutoff[2] ?? "00"}` });

  const lead = /\b(?:entrega|entregan|reparte|reparten|trae|traen|tarda|tardan|plazo(?: de entrega)?)\b(?: (?:en|a|de))? (\d{1,3}) ?(h|horas?|dias?)\b/.exec(text);
  if (lead) changes.push({ field: "lead_time_hours", value: String(Number(lead[1]) * (lead[2]!.startsWith("d") ? 24 : 1)) });

  // La forma de pago es texto libre: lo que va tras «se le paga», «pago», «forma de pago»…
  const pay = /\b(?:se le paga|le pagamos|pagamos|se paga|forma de pago|condiciones de pago|pago)\b(?: (?:es|son|a|por|con|mediante|en))?\s+(.{3,80})$/.exec(text);
  if (pay && !/\bfactur/.test(text)) {
    // Se recorta del mensaje original (con sus tildes): mismo texto sin acentos → mismas posiciones.
    const plain = message.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    const at = plain.lastIndexOf(pay[1]!.slice(0, 8));
    let raw = (at >= 0 ? message.slice(at) : pay[1]!).trim().replace(/[.!]+$/, "");
    // «de Makro: domiciliación…», «de Makro es transferencia…»: el proveedor no es parte del valor.
    raw = raw.includes(":") ? raw.slice(raw.lastIndexOf(":") + 1).trim() : raw.replace(/^(de|del|para|con)\s+.+?\s+(es|son|sera|será)\s+/i, "");
    changes.push({ field: "payment_terms", value: raw.charAt(0).toUpperCase() + raw.slice(1) });
  }
  return changes;
}

/** Cómo se enseña cada valor («200,00 €», «lun, jue», «12:00», «48 h»). */
export function termText(field: TermField, value: string | number[] | number | null, money: (v: string) => string): string {
  if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) return "sin apuntar";
  switch (field) {
    case "min_order":
      return money(String(value));
    case "order_days": {
      const days = Array.isArray(value) ? value : String(value).split(",").map(Number);
      return days.map((d) => DAY_SHORT[d - 1]).join(", ");
    }
    case "order_cutoff":
      return String(value).slice(0, 5);
    case "lead_time_hours":
      return `${value} h`;
    case "payment_terms":
      return String(value);
  }
}
