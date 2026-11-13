// Operaciones de catálogo (precio, alta, mínimo, archivar, pedido) y sobre documentos que ya existen
// (recibir, enviar o cancelar traspasos y pedidos).
import type { GateOutcome } from "../../contract/index";
import { NO_APLICA, NO_INDICADO, TODOS, type Periodo } from "../catalog";
import { venueRoles } from "../../entities/signals";
import type { ContextKey } from "../gates/policy";
import { namesAll } from "../../entities/mentions";
import { normalize } from "../../entities/normalize";
import type { CatalogAccion, DocumentAccion, Plan } from "../../agent/plans";
import type { JevReading } from "./reading";
import { closestProducts, resolveProducts } from "./products";

/**
 * Acciones de catálogo. El alta no busca un producto existente (lo busca después el constructor
 * para detectar duplicados); precio, mínimo y archivar necesitan un producto claro. Solo el mínimo
 * necesita local. El resto de datos (precio, proveedor, cantidad) los extrae el código del mensaje.
 */
export function catalogAction(r: JevReading, accion: CatalogAccion): Plan {
  const context: ContextKey = `accion:${accion}`;
  const locGate = r.gateSlot(context, "local", "local", "Local");
  let locationId = locGate ? r.meta.locationKeys.get(locGate.choice) ?? null : r.onlyLocation();
  let locationOutcome: GateOutcome = locGate && locationId ? locGate.outcome : locationId ? "actuar" : "preguntar";

  if (accion === "nuevo_producto") {
    return { type: "catalogo", accion, locationId: locationOutcome === "actuar" ? locationId : null, locationOutcome, products: [] };
  }

  // Pedido: hace falta el local; los productos son opcionales (sin productos se pide lo que falta).
  if (accion === "preparar_pedido") {
    // En un pedido la mercancía llega AL local desde el proveedor: la pregunta de destino a veces
    // está segura cuando la de local duda (medido con Jev real). Se usa la que esté segura; si
    // ninguna lo está pero coinciden, se sigue marcando el local para revisar.
    if (locationOutcome !== "actuar") {
      const dest = r.gateSlot(context, "local_destino", "local_destino", "Local destino");
      const destId = dest && dest.choice !== NO_APLICA ? r.meta.locationKeys.get(dest.choice) ?? null : null;
      if (destId && dest!.outcome === "actuar") {
        locationId = destId;
        locationOutcome = "actuar";
      } else if (destId && destId === locationId && dest!.outcome === "confirmar") {
        locationOutcome = "confirmar";
      }
    }
    if (!locationId && r.pageLocationId) {
      locationId = r.pageLocationId;
      locationOutcome = "confirmar";
    }
    if (!locationId || locationOutcome === "preguntar") {
      return r.clarify("local", "¿Para qué local es el pedido?", r.locationOptions(locGate?.ranked ?? []), [TODOS, NO_INDICADO], (key) => key);
    }
    const products = resolveProducts(r, context, true);
    if ("type" in products) return products;
    const periodo = (r.choice("periodo")?.choice ?? NO_INDICADO) as Periodo;
    return { type: "catalogo", accion, locationId, locationOutcome, products, periodo };
  }

  const products = resolveProducts(r, context, true);
  if ("type" in products) return products;
  if (products.length === 0) {
    const question = accion === "cambiar_precio" ? "¿De qué producto quieres cambiar el precio?" : accion === "archivar_producto" ? "¿Qué producto quieres archivar?" : "¿De qué producto?";
    // Con los parecidos como opciones: sin ellas, escribir el nombre volvía a la misma pregunta.
    return { type: "clarify", field: "producto", question, options: closestProducts(r, 4).map(({ key, product }) => ({ id: key, label: product.name, probability: null })), segmentIndex: 0 };
  }

  if (accion === "cambiar_minimo") {
    if (!locationId && r.pageLocationId) {
      locationId = r.pageLocationId;
      locationOutcome = "confirmar";
    }
    if (!locationId || locationOutcome === "preguntar") {
      return r.clarify("local", "¿En qué local?", r.locationOptions(locGate?.ranked ?? []), [TODOS, NO_INDICADO], (key) => key);
    }
  }
  return { type: "catalogo", accion, locationId, locationOutcome, products };
}

/** Recibir, enviar o cancelar un traspaso o un pedido: el local, si se dice, acota cuál. */
export function documentAction(r: JevReading, accion: DocumentAccion): Plan {
  const context: ContextKey = `accion:${accion}`;
  const all = r.ctx.locations.map((l) => l.id);
  const g = r.gateSlot(context, "local", "local", "Local");
  let id = g && g.outcome === "actuar" ? r.meta.locationKeys.get(g.choice) : undefined;
  // «ya ha llegado lo que mandó el Vivero»: si Jev no lo recoge pero el mensaje nombra un solo local,
  // ese local acota el documento (solo filtra cuál; el borrador se confirma igual).
  if (!id && r.meta.message) {
    const named = [...r.meta.locationKeys.entries()].filter(([name]) => namesAll(r.meta.message!, name));
    if (named.length === 1) id = named[0]![1];
  }
  // Traspasos: origen y destino según la frase. Antes se buscaba cualquier traspaso que tocara el local
  // («lo que mandó Pickles al Parador» enseñaba los que salían del Parador hacia el Vivero).
  if ((accion === "recibir_traspaso" || accion === "cancelar_traspaso") && r.meta.message) {
    const names = [...r.meta.locationKeys.keys()];
    const named = names.filter((name) => namesAll(r.meta.message!, name));
    const roles = venueRoles(r.meta.message, names);
    const key = (name: string | null | undefined) => (name ? r.meta.locationKeys.get(name) : undefined);
    let to = key(roles.destination);
    let from = key(roles.origin);
    // Dos locales y uno con papel claro: el otro es el que falta («mandó Pickles al Parador»).
    if (named.length === 2) {
      if (to && !from) from = key(named.find((n) => key(n) !== to));
      if (from && !to) to = key(named.find((n) => key(n) !== from));
    }
    // Uno solo sin preposición: al recibir, «lo que mandó el Vivero» es el origen.
    if (named.length === 1 && !to && !from && accion === "recibir_traspaso" && /\b(mand|envi)/.test(normalize(r.meta.message))) from = key(named[0]);
    if (to || from) {
      return { type: "documento", accion, locationIds: all, ...(from ? { fromLocationId: from } : {}), ...(to ? { toLocationId: to } : {}) };
    }
  }
  return { type: "documento", accion, locationIds: id ? [id] : all };
}
