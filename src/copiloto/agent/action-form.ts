// Miniformulario de operación: cuando la operación está clara (merma, traspaso, recepción) pero faltan
// dos datos o más, se piden juntos en vez de pregunta a pregunta. Con uno solo se sigue preguntando
// (una pregunta es más rápida que un formulario).
//
// Al enviarlo, el servidor valida cada campo contra los locales y el catálogo del usuario, arma la frase
// completa y fija las decisiones de Jev con lo elegido (como al contestar una aclaración): el resultado es
// el borrador de siempre, que hay que confirmar.
import { randomUUID } from "node:crypto";
import type { ChatRequest, Decision, FormEvent, FormField } from "../contract/index";
import type { SessionContext } from "../domain";
import { normalize } from "../entities/normalize";
import { parseQuantities } from "../entities/quantity-parser";
import { asChoice } from "../jev/gates/gate";
import type { JevAnswer } from "../jev/client";
import type { RoutingMeta } from "../jev/request";
import type { ClarifyPlan } from "./plans";

type FormAction = FormEvent["accion"];
const FORM_ACTIONS: readonly FormAction[] = ["merma", "traspaso", "recepcion"];
/** Preguntas que el formulario sustituye (las de operación o de formato se siguen haciendo sueltas). */
const REPLACES = new Set<ClarifyPlan["field"]>(["local", "local_destino", "producto", "cantidad"]);

const TITLE: Record<FormAction, string> = { merma: "Registrar merma", traspaso: "Traspaso entre locales", recepcion: "Recepción de mercancía" };
const MOTIVOS: Array<{ id: string; label: string }> = [
  { id: "rotura", label: "Rotura" },
  { id: "caducidad", label: "Caducado o estropeado" },
  { id: "derrame", label: "Derrame" },
  { id: "invitacion", label: "Invitación" },
  { id: "error_servicio", label: "Error de servicio" },
  { id: "otro", label: "Otro" },
];
/** Sugerencias del campo de producto: el catálogo entero, hasta este tope (solo nombres). */
const MAX_PRODUCT_OPTIONS = 600;

interface FormSource {
  decisions: Decision[];
  overrides: Record<string, string>;
  meta: RoutingMeta | undefined;
  /** Respuestas de Jev del mensaje: un dato que aún no se ha decidido (se pregunta antes otro) cuenta si Jev lo tiene claro. */
  answers: Record<string, JevAnswer> | undefined;
  ctx: SessionContext;
}

/** Jev tiene claro un dato aunque aún no se haya decidido (la interpretación va en orden y se paró antes). */
const CLEAR = 0.7;

/** «2 botellas», «1 caja», «3 kg»: la unidad del analizador va en singular. */
function quantityText(amount: string, unit: string | null): string {
  if (!unit) return amount;
  const plural = amount !== "1" && !/^(ud|kg|g|l|cl|ml)$/.test(unit) ? (/[aeiou]$/.test(unit) ? `${unit}s` : `${unit}es`) : unit;
  return `${amount} ${plural}`;
}

/** Lo que ya se sabe de cada dato: decidido con seguridad por Jev, elegido por el usuario o dicho con cifra. */
function known(source: FormSource) {
  const decided = (id: string, valid: (v: string) => boolean = () => true) => {
    if (source.overrides[id]) return source.overrides[id];
    const d = [...source.decisions].reverse().find((x) => x.id === id);
    if (d) return d.gate === "actuar" && valid(d.value) ? d.value : undefined;
    const raw = asChoice(source.answers?.[id]);
    const p = raw ? (raw.probabilities as Record<string, number>)[raw.choice] ?? 0 : 0;
    return raw && p >= CLEAR && valid(raw.choice) ? raw.choice : undefined;
  };
  const isLocation = (v: string) => !!source.meta?.locationKeys.has(v);
  const isProduct = (v: string) => !!source.meta?.segments[0]?.candidates.has(v);
  const segment = source.meta?.segments[0]?.segment;
  const typed = source.overrides.cantidad_0;
  const amount = typed ? quantityText(typed, source.overrides.unidad_texto_0 ?? null) : segment?.amount ? quantityText(segment.amount, segment.unit) : undefined;
  const productKey = decided("producto_0", isProduct);
  return {
    accion: decided("tipo_accion"),
    local: decided("local", isLocation),
    destino: decided("local_destino", isLocation),
    producto: productKey ? source.meta?.segments[0]?.candidates.get(productKey)?.name : undefined,
    cantidad: amount,
  };
}

/** Hasta este número de candidatos se ofrecen en un desplegable (más, mejor escribir). */
const MAX_CANDIDATES = 8;

/** Los productos entre los que se duda: los de la pregunta de producto, o los que encontró la búsqueda. */
function productCandidates(plan: ClarifyPlan, source: FormSource): string[] {
  if (plan.field === "producto" && plan.options.length > 1) return plan.options.map((o) => o.label);
  const rs = source.meta?.segments[0];
  if (!rs || rs.candidates.size < 2 || rs.candidates.size > MAX_CANDIDATES * 2) return [];
  const top = Math.max(0, ...rs.scores.values());
  return [...rs.candidates.entries()]
    .filter(([key]) => (rs.scores.get(key) ?? 0) >= top * 0.75)
    .sort(([a], [b]) => (rs.scores.get(b) ?? 0) - (rs.scores.get(a) ?? 0))
    .slice(0, MAX_CANDIDATES)
    .map(([, product]) => product.name);
}

/** El formulario que sustituye a esta aclaración, o null si basta con la pregunta. */
export function formFor(plan: ClarifyPlan, source: FormSource): FormEvent | null {
  if (!REPLACES.has(plan.field)) return null;
  const k = known(source);
  const accion = FORM_ACTIONS.find((a) => a === k.accion);
  if (!accion) return null;
  const required: Array<keyof typeof k> = accion === "traspaso" ? ["local", "destino", "producto", "cantidad"] : ["local", "producto", "cantidad"];
  const missing = required.filter((f) => !k[f]);
  if (missing.length < 2) return null;

  const locations = source.ctx.locations.map((l) => ({ id: l.name, label: l.name }));
  const candidates = productCandidates(plan, source);
  const fields: FormField[] = [
    { key: "local", label: accion === "traspaso" ? "Sale de" : accion === "recepcion" ? "Llega a" : "Local", kind: "select", options: locations, required: true, ...(k.local ? { value: k.local } : {}) },
    ...(accion === "traspaso" ? [{ key: "destino" as const, label: "Va a", kind: "select" as const, options: locations, required: true, ...(k.destino ? { value: k.destino } : {}) }] : []),
    // «ron», «larios» con varios: se elige entre los que encajan (como los botones de la pregunta); si el
    // mensaje no nombraba ninguno, todo el catálogo para escribir.
    !k.producto && candidates.length > 1
      ? { key: "producto", label: "Producto", kind: "select", options: candidates.map((name) => ({ id: name, label: name })), required: true }
      : {
          key: "producto",
          label: "Producto",
          kind: "product",
          options: source.ctx.products.slice(0, MAX_PRODUCT_OPTIONS).map((p) => ({ id: p.name, label: p.name })),
          required: true,
          placeholder: "Empieza a escribir el nombre",
          ...(k.producto ? { value: k.producto } : {}),
        },
    { key: "cantidad", label: "Cantidad", kind: "text", required: true, placeholder: "3 botellas, 1 caja, 2 kg…", ...(k.cantidad ? { value: k.cantidad } : {}) },
    ...(accion === "merma" ? [{ key: "motivo" as const, label: "Motivo", kind: "select" as const, options: MOTIVOS, required: false }] : []),
  ];
  return { formId: randomUUID().slice(0, 12), title: TITLE[accion], accion, fields };
}

type FormRequest = NonNullable<ChatRequest["form"]>;

/**
 * El formulario enviado → la frase completa y las decisiones fijadas. Si algo no vale (un local que no
 * es suyo, una cantidad sin cifra), `error` dice qué corregir.
 */
export function readForm(form: FormRequest, ctx: SessionContext): { message: string; display: string; overrides: Record<string, string> } | { error: string } {
  const v = form.values;
  const byName = (name: string | undefined) => (name ? ctx.locations.find((l) => normalize(l.name) === normalize(name)) : undefined);
  const local = byName(v.local);
  if (!local) return { error: "Elige el local en el formulario." };
  const destino = form.accion === "traspaso" ? byName(v.destino) : undefined;
  if (form.accion === "traspaso" && (!destino || destino.id === local.id)) return { error: "Elige a qué local va (distinto del de salida)." };
  const productText = (v.producto ?? "").trim();
  if (!productText) return { error: "Escribe el producto." };
  const quantity = (v.cantidad ?? "").trim();
  if (!/\d/.test(quantity) || parseQuantities(`${quantity} de x`).length === 0) return { error: "Escribe la cantidad con una cifra, por ejemplo «3 botellas»." };
  // Un nombre exacto del catálogo fija el producto; si no, decide Jev con lo escrito (y pregunta si duda).
  const product = ctx.products.find((p) => normalize(p.name) === normalize(productText));
  const motivo = form.accion === "merma" && MOTIVOS.some((m) => m.id === v.motivo) ? v.motivo! : undefined;
  const name = product?.name ?? productText;
  const message =
    form.accion === "merma"
      ? `merma de ${quantity} de ${name} en ${local.name}${motivo ? ` por ${MOTIVOS.find((m) => m.id === motivo)!.label.toLowerCase()}` : ""}`
      : form.accion === "traspaso"
        ? `pasa ${quantity} de ${name} de ${local.name} a ${destino!.name}`
        : `han llegado ${quantity} de ${name} a ${local.name}`;
  const overrides: Record<string, string> = {
    intent: "proponer_accion",
    tipo_accion: form.accion,
    local: local.name,
    ...(destino ? { local_destino: destino.name } : {}),
    ...(product ? { producto_0: product.name } : {}),
    ...(motivo ? { motivo_merma: motivo } : {}),
  };
  return { message, display: `${TITLE[form.accion]}: ${quantity} de ${name}${destino ? `, ${local.name} → ${destino.name}` : ` en ${local.name}`}`, overrides };
}
