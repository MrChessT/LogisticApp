// Filtros que una consulta de gestión lee del propio mensaje: periodo natural («este mes», «en octubre»), ventana
// de vencimiento («vencen esta semana»), número de documento («el albarán A-4356») y el proveedor nombrado aunque
// no exista («de makro»). Antes se ignoraban y la respuesta era la lista entera, que parecía contestar otra cosa.
import { normalize, tokenize } from "../entities/normalize";
import { addDays, formatDay, lastDayOfMonth, mondayOf, MONTHS } from "./periods";
import type { Period } from "./types";

/**
 * Ventana de vencimiento hacia delante: «vencen esta semana» (hasta el domingo), «este mes», «hoy», «mañana»,
 * «en los próximos 10 días». null si no la dice (se usa la de siempre, 7 días).
 */
export function dueWindow(message: string, today: string): Period | null {
  const t = normalize(message);
  if (!/\b(vence|vencen|vencer|vencimiento|vencimientos|toca pagar|hay que pagar|tengo que pagar|pagar)\b/.test(t)) return null;
  if (/\bmanana\b/.test(t)) {
    const d = addDays(today, 1);
    return { from: d, to: d, label: "mañana" };
  }
  if (/\bhoy\b/.test(t)) return { from: today, to: today, label: "hoy" };
  const next = /\bproxim[oa]s?\s+(\d{1,3})\s+dias\b/.exec(t);
  if (next) {
    const n = Math.max(1, Math.min(366, Number(next[1])));
    return { from: today, to: addDays(today, n), label: `en los próximos ${n} días` };
  }
  if (/\bsemana\s+que\s+viene\b|\bproxima\s+semana\b/.test(t)) {
    const monday = addDays(mondayOf(today), 7);
    return { from: monday, to: addDays(monday, 6), label: "la semana que viene" };
  }
  if (/\b(esta|la)\s+semana\b/.test(t)) {
    const sunday = addDays(mondayOf(today), 6);
    return { from: today, to: sunday, label: `esta semana (hasta el ${formatDay(sunday)})` };
  }
  if (/\b(este|el)\s+mes\b/.test(t)) {
    const end = lastDayOfMonth(`${today.slice(0, 8)}01`);
    return { from: today, to: end, label: `este mes (hasta el ${formatDay(end)})` };
  }
  return null;
}

/**
 * Número de documento que se busca: «el albarán A-4356», «factura nº 2024/118», «la F-77». Tiene que llevar
 * alguna cifra y no ser una fecha ni una cantidad con unidad.
 */
export function documentNumber(message: string): string | null {
  const t = normalize(message);
  const m = /\b(?:albaran|albaranes|factura|facturas|numero|num|n|no|ref|referencia|codigo)\.?\s*(?:º|°|n\.?º)?\s*(?:el\s+|la\s+)?([a-z0-9]+(?:[-/.][a-z0-9]+)*)/i.exec(t);
  const raw = m?.[1];
  if (!raw || !/\d/.test(raw)) return null;
  // «facturas de 2026», «albaranes de 12/10»: un año o una fecha no son un número de documento.
  if (/^(19|20)\d{2}$/.test(raw) || /^\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?$/.test(raw)) return null;
  return raw;
}

/** Mismo número aunque se escriba distinto («A-4356», «a4356», «A 4356»). */
export function sameDocument(a: string, b: string): boolean {
  const flat = (s: string) => normalize(s).replace(/[^a-z0-9]/g, "").replace(/^0+/, "");
  const x = flat(a);
  const y = flat(b);
  return x.length > 0 && (x === y || (x.length >= 3 && (y.endsWith(x) || x.endsWith(y)) && Math.min(x.length, y.length) >= 3));
}

/** Palabras que pueden seguir a «de»/«a» sin ser un proveedor («facturas de este mes», «albaranes de hoy»). */
const NOT_A_SUPPLIER = new Set([
  "este", "esta", "estos", "estas", "ese", "esa", "el", "la", "los", "las", "un", "una", "mi", "mis", "tu", "hoy", "ayer", "manana", "semana", "mes", "ano",
  "pago", "pagar", "proveedor", "proveedores", "factura", "facturas", "albaran", "albaranes", "compra", "compras", "todo", "todos", "todas", "cada",
  "mas", "menos", "nadie", "alguien", "quien", "que", "cuanto", "cuanta", "bebida", "comida", "cocina", "barra", "local", "locales",
  ...MONTHS,
]);

/**
 * Proveedor que el mensaje nombra («de makro», «a makro», «con makro») cuando no es ninguno de los conocidos ni un
 * local: hay que decir que no existe en vez de contestar con todos. null si no nombra a nadie o es conocido.
 */
export function unknownSupplier(message: string, known: string[], locations: string[]): string | null {
  const words = tokenize(message);
  // Conocido: alguna palabra de un nombre, o el nombre escrito junto («cocacola» = «Coca-Cola»).
  const isKnown = (w: string) =>
    [...known, ...locations].some((name) => tokenize(name).join("").startsWith(w) || tokenize(name).some((part) => part.length > 2 && (part === w || (w.length >= 5 && part.startsWith(w.slice(0, 5))))));
  for (let i = 0; i < words.length - 1; i += 1) {
    if (!["de", "a", "con", "del", "al"].includes(words[i]!)) continue;
    const w = words[i + 1]!;
    if (w.length < 3 || /\d/.test(w) || NOT_A_SUPPLIER.has(w) || isKnown(w)) continue;
    // Solo tras palabras de compras: «le debo a makro», «facturas de makro», «albaranes de makro», «pedido de makro».
    // Lo dicho antes en la frase («quiero pedir 3 cajas de coca y 2 de fanta a makro»).
    const before = words.slice(0, i).join(" ");
    if (!/\b(debo|debemos|factura|facturas|albaran|albaranes|pedido|pedidos|pedir|pide|pido|pidele|compras?|comprar|comprado|gastado|gasto|telefono|contacto|email|correo|proveedor|pagar|pagado|pague)\b/.test(before)) continue;
    // El nombre entero, hasta la siguiente palabra de enlace («a frutas paco para el parador» → «frutas paco»).
    const name = [w];
    for (const next of words.slice(i + 2, i + 4)) {
      if (NOT_A_SUPPLIER.has(next) || ["de", "del", "a", "al", "en", "para", "por", "y", "que", "con", "sin", "no"].includes(next) || /\d/.test(next) || isKnown(next)) break;
      name.push(next);
    }
    return name.join(" ");
  }
  return null;
}
