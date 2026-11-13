// Preguntas sobre los datos de los proveedores: cuál tiene menos información apuntada y cuál se dio de alta
// el último. Lo que no es eso (la lista, un proveedor concreto) lo contesta info.ts.
import { normalize } from "../entities/normalize";
import type { AppRoute } from "../contract/index";
import type { InfoResult, SupplierRaw } from "./info";

/** Datos básicos que le faltan a un proveedor (lo que se pide para pedirle y pagarle). */
export function supplierMissing(s: SupplierRaw): string[] {
  return [
    !s.contact && !s.phone && !s.email ? "contacto" : null,
    s.orderDays.length === 0 ? "días de pedido" : null,
    s.leadHours === null ? "plazo de entrega" : null,
    !s.minOrder ? "pedido mínimo" : null,
    !s.paymentTerms ? "forma de pago" : null,
  ].filter((x): x is string => x !== null);
}

/** La respuesta a esas preguntas, o null si el mensaje no las hace. */
export function supplierDataAnswer(suppliers: SupplierRaw[], message: string, route: AppRoute): InfoResult | null {
  const text = normalize(message);
  // «¿Cuál tiene menos información?», «¿qué proveedor está incompleto?»: los que más datos les faltan.
  if (/\b(menos (informacion|datos)|incomplet[oa]s?|le falta|les falta|faltan|sin (datos|informacion)|peor informado)\b/.test(text)) {
    if (suppliers.length === 0) return null;
    const scored = suppliers.map((s) => ({ s, missing: supplierMissing(s) })).sort((a, b) => b.missing.length - a.missing.length || a.s.name.localeCompare(b.s.name));
    const worst = scored[0]!.missing.length;
    if (worst === 0) return { text: "Todos los proveedores tienen los datos básicos apuntados.", route, rows: 0 };
    const top = scored.filter((x) => x.missing.length === worst);
    const list = top.slice(0, 5).map((x) => `${x.s.name} (le falta: ${x.missing.join(", ")})`).join("; ");
    return { text: top.length === 1 ? `${top[0]!.s.name}: le falta ${top[0]!.missing.join(", ")}.` : `Empatan ${top.length} proveedores con ${worst} datos sin apuntar: ${list}.`, route, rows: top.length };
  }
  // «¿cuál es el último en ser creado?»: el de fecha de alta más reciente.
  if (/\b(ultim[oa]|reciente|mas nuevo|nueva?|acaba de)\b.*\b(cread[oa]|dad[oa] de alta|alta|anadid[oa])\b|\b(cread[oa]|dad[oa] de alta|anadid[oa]) (el )?(ultim|mas reciente)/.test(text) && suppliers.length > 0) {
    const newest = [...suppliers].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!;
    return { text: `El último dado de alta es ${newest.name}, el ${newest.createdAt.slice(8, 10)}/${newest.createdAt.slice(5, 7)}/${newest.createdAt.slice(0, 4)}.`, route, rows: 1 };
  }
  return null;
}
