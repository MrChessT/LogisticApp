// Consultas: qué herramienta, de qué productos, dónde y de qué periodo; lo que no se dice se hereda de
// lo anterior si el mensaje lo continúa.
import type { Product } from "../../domain";
import { asChoice, asNoul, gateChoice } from "../gates/gate";
import { label, NO_INDICADO, isInfoTool, type Dato, type Herramienta, type InfoTool, type Periodo } from "../catalog";
import type { ToolName } from "../../tools/tools";
import { asksSameAgain, wantsAreaBreakdown } from "../../entities/signals";
import { need, relevant, type ContextKey } from "../gates/policy";
import { normalize } from "../../entities/normalize";
import type { Plan } from "../../agent/plans";
import { locationLabel, type JevReading } from "./reading";
import { closestProducts, resolveProducts } from "./products";

/** Dinero metido en el stock (no precio de compra): «pasta», «dinero», «euros» con «tenemos/hay/metido». */
const MONEY_OF_STOCK = /\b(pasta|dinero|pelas|euros|pasta gansa)\b.*\b(tenemos|hay|metid[oa]s?|invertid[oa]s?|parad[oa]s?|en stock)\b|\b(tenemos|hay)\b.*\b(metid[oa]s?|invertid[oa]s?)\b.*\b(pasta|dinero|euros)\b|\bvalor(acion)? (de|del|en) (stock|inventario|almacen)\b|\bque valor\b.*\b(hay|tenemos)\b/;

/** Qué dato pide la consulta. Sin seguridad suficiente, «general» (se enseña todo, como antes). */
function readDato(r: JevReading): Dato {
  // «¿cuánta pasta tenemos metida en ron?», «¿cuánto dinero hay en ginebra?»: dinero del stock, aunque
  // Jev lo lea como cantidad («cuánta» + «tenemos» pesa más que «pasta»; medido: cantidad 0,70).
  if (r.meta.message && MONEY_OF_STOCK.test(normalize(r.meta.message))) return "valor";
  const g = r.gate("dato", "Dato", r.thresholds.dato);
  return g && g.outcome === "actuar" ? (g.choice as Dato) : "general";
}

/** ¿Jev está seguro de una consulta concreta y de que se trata de leer? */
export function queryCorroborates(r: JevReading): boolean {
  const tool = r.choice("herramienta");
  if (!tool || tool.choice === "ninguna" || gateChoice(tool, r.thresholds.herramienta).outcome !== "actuar") return false;
  const alt = asChoice(r.answers.intent_alt);
  return !alt || ((alt.probabilities as Record<string, number>).leer ?? 0) >= 0.5;
}

export function query(r: JevReading, intent: "consultar" | "pedir_sugerencias"): Plan {
  const g = r.gate("herramienta", "Consulta", r.thresholds.herramienta);
  let tool: Herramienta = g?.choice as Herramienta;
  const inherited: string[] = [];
  const focusTool = r.focus?.kind === "consulta" ? (r.focus.tool as Herramienta | undefined) : undefined;
  if (intent === "pedir_sugerencias" && (!g || tool === "ninguna" || g.outcome !== "actuar")) {
    tool = "query_reorder";
  } else if ((!g || g.outcome !== "actuar") && r.meta.message && wantsAreaBreakdown(r.meta.message)) {
    // «¿qué hay en cada sección del Vivero?»: stock por secciones (Jev dudaba: 0,63–0,72).
    tool = "query_stock";
  } else if (!g || tool === "ninguna" || g.outcome === "preguntar") {
    // Entre «preguntar» y «actuar» se contesta con la más probable: es solo leer, y preguntar «¿Qué
    // quieres consultar?» con «precio cocacola» era la pregunta de más más repetida en producción.
    // «¿y en el Vivero?»: sin consulta clara, la misma que antes.
    if (!focusTool || !r.followsUp()) return r.clarify("herramienta", "¿Qué quieres consultar?", g?.ranked ?? [], ["ninguna"]);
    tool = focusTool;
  } else if (focusTool && tool !== focusTool && r.meta.message && asksSameAgain(r.meta.message) && r.followsUp()) {
    // «¿y en el Parador?» tras «¿qué tengo que pedir?»: la misma consulta, en otro sitio (Jev lee «stock»).
    tool = focusTool;
  }
  if (isInfoTool(tool)) return info(r, tool);
  const context: ContextKey = `consulta:${tool as ToolName}`;
  const loc = r.readLocation(context);
  const area = r.readArea(context);
  let products = resolveProducts(r, context, false);
  if ("type" in products) return products;
  // Elegido al aclarar «¿De qué producto?» entre los de antes (no tiene por qué estar entre los candidatos
  // de este mensaje, que no nombra ninguno: «¿y a cuánto lo compramos?»).
  const picked = r.overrides.producto_0 ? r.ctx.products.find((p) => p.name === r.overrides.producto_0) : undefined;
  if (products.length === 0 && picked) products = [{ product: picked, segmentIndex: 0, amount: null, unit: null, price: null, quantityOutcome: null }];
  // Consultas de un producto concreto (su ficha): sin producto, o con varios («ginebra»), se pregunta cuál.
  if (need(context, "producto") === "requerido" && products.length !== 1 && !(products.length === 0 && r.focus?.productIds.length === 1 && r.followsUp())) {
    if (products.length === 0) {
      // Con los de la respuesta anterior («stock de larios» → 3 Larios) o los parecidos como opciones.
      const previous = (r.focus?.productIds ?? []).map((id) => r.ctx.products.find((p) => p.id === id)).filter((p): p is Product => !!p);
      const options = previous.length > 1 ? previous.slice(0, 4) : closestProducts(r, 4).map((c) => c.product);
      return { type: "clarify", field: "producto", question: "¿De qué producto?", options: options.map((p) => ({ id: p.name, label: p.name, probability: null })), segmentIndex: 0 };
    }
    return {
      type: "clarify",
      field: "producto",
      question: "¿De cuál de estos productos?",
      options: products.slice(0, 4).map((p) => ({ id: p.product.name, label: p.product.name, probability: null })),
      segmentIndex: Math.max(0, products[0]!.segmentIndex),
    };
  }
  // El periodo solo cuenta donde importa (movimientos, gasto, precios…), no en el stock de ahora.
  let periodo = (relevant(context, "periodo") ? r.choice("periodo")?.choice ?? NO_INDICADO : NO_INDICADO) as Periodo;

  // Lo que este mensaje no dice se toma del anterior, si lo continúa.
  const focus = r.focus;
  if (focus && (products.length === 0 || loc.defaulted || periodo === NO_INDICADO) && r.followsUp()) {
    if (products.length === 0 && focus.productIds.length > 0 && relevant(context, "producto")) {
      products = focus.productIds
        .map((id) => r.ctx.products.find((p) => p.id === id))
        .filter((p): p is Product => !!p)
        .map((product) => ({ product, segmentIndex: -1, amount: null, unit: null, price: null, quantityOutcome: null }));
      if (products.length > 0) inherited.push(products.length === 1 ? products[0]!.product.name : "los mismos productos");
      // «¿y en Pickles?» tras «¿cuánta tónica queda?»: el titular sigue diciendo «tónica».
      if (products.length > 1 && focus.familia && !r.familia) r.familia = focus.familia;
    }
    const focusLocations = focus.locationIds.filter((id) => r.ctx.locations.some((l) => l.id === id));
    if (loc.defaulted && focusLocations.length > 0 && relevant(context, "local")) {
      loc.ids = focusLocations;
      loc.defaulted = false;
      inherited.push(focusLocations.map((id) => locationLabel(r.ctx, id)).join(", "));
    }
    if (periodo === NO_INDICADO && focus.periodo && focus.periodo !== NO_INDICADO && relevant(context, "periodo")) {
      periodo = focus.periodo as Periodo;
      inherited.push(label(periodo).toLowerCase());
    }
  }
  if (periodo !== NO_INDICADO) {
    // Heredado sin que el mensaje hable de tiempo: Jev no dio periodo y cuenta la continuación.
    const p = r.choice("periodo");
    const probability = p ? (p.probabilities as Record<string, number>)[periodo] ?? 0 : asNoul(r.answers.seguimiento)?.noul ?? 0;
    r.decisions.push({ id: "periodo", label: "Periodo", value: periodo, valueLabel: label(periodo), probability, confidence: p?.confidence ?? null, gate: "actuar" });
  }
  const areaId = area.outcome === "actuar" ? area.id : null;
  const areaLocation = areaId ? r.ctx.areas.find((a) => a.id === areaId)?.locationId : undefined;
  const dato = readDato(r);
  tool = toolForDato(tool, dato, products.length);
  return {
    type: "consultar",
    tool: tool as ToolName,
    ...(dato !== "general" ? { dato } : {}),
    locationIds: areaLocation ? [areaLocation] : loc.ids,
    locationsDefaulted: areaLocation ? false : loc.defaulted,
    areaId,
    products,
    periodo,
    ...(inherited.length > 0 ? { inherited } : {}),
    ...(r.familia ? { familia: r.familia } : {}),
  };
}

/** Facturas, equipo, escandallos, zonas, inventarios o proveedores: el local, los productos y el periodo solo filtran. */
function info(r: JevReading, tool: InfoTool): Plan {
  const loc = r.readLocation("info");
  const products = resolveProducts(r, "info", false);
  const periodo = (r.choice("periodo")?.choice ?? NO_INDICADO) as Periodo;
  return { type: "info", tool, locationIds: loc.ids, locationsDefaulted: loc.defaulted, products: "type" in products ? [] : products, periodo };
}

/**
 * La consulta que contesta ese dato de esos productos: «¿a cuánto nos sale el Beefeater?» es su
 * último precio (no la ficha entera), «¿cuántas botellas de Beefeater hay?» su stock, y el proveedor,
 * los formatos o el mínimo de un producto salen de su ficha. Sin productos, la consulta de Jev.
 */
function toolForDato(tool: Herramienta, dato: Dato, productCount: number): Herramienta {
  if (productCount === 0) return tool;
  const lookup = tool === "query_stock" || tool === "query_product";
  if (dato === "precio" && (lookup || tool === "query_prices")) return "query_prices";
  if (!lookup) return tool;
  if (dato === "cantidad" || dato === "valor") return "query_stock";
  if ((dato === "proveedor" || dato === "formatos" || dato === "minimo") && productCount === 1) return "query_product";
  return tool;
}
