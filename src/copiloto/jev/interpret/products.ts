// Qué productos nombra el mensaje, según Jev y la búsqueda: uno concreto, una familia entera o una
// aclaración. Para escribir se exige más que para leer.
import type { GateOutcome } from "../../contract/index";
import type { Product } from "../../domain";
import { asNoul, gateNoulYes } from "../gates/gate";
import { label, NINGUNO, VARIOS } from "../catalog";
import { relevant, slotSpec, type ContextKey } from "../gates/policy";
import { namesProduct, unexplainedWords } from "../../entities/mentions";
import { familyOf, nameGroupOf, type Family } from "../../entities/family";
import { formatDecimal } from "../../entities/units";
import { isUnitWord } from "../../entities/quantity-parser";
import { tokenize } from "../../entities/normalize";
import type { ClarifyPlan, ResolvedProduct } from "../../agent/plans";
import type { JevReading } from "./reading";

/** El fragmento es el mensaje entero (la cantidad no traía producto): no se cita en la pregunta. */
function wholeMessage(segment: { text: string; productText: string }): boolean {
  return segment.productText === segment.text && segment.text.split(/\s+/).length > 4;
}

/** Familia del catálogo que nombra el fragmento («ron», «cervezas»), para consultas. */
function catalogFamily(r: JevReading, segmentIndex: number, byName = true): Family | null {
  const rs = r.meta.segments[segmentIndex];
  if (!rs) return null;
  const text = tokenize(rs.segment.productText || rs.segment.text).filter((w) => !r.placeWords.has(w)).join(" ");
  // Sin familia del catálogo con ese nombre («ron» dentro de «Destilados y Licores»), el grupo por nombre. Solo
  // si Jev no apunta a un producto concreto: si duda entre Barceló y Brugal, se pregunta cuál.
  // Las unidades no forman grupo: «¿cuántas botellas quedan?» habla del producto de antes, no de «botellas».
  const named = tokenize(text).filter((w) => !isUnitWord(w)).join(" ");
  return familyOf(text, r.ctx.products) ?? (byName && named ? nameGroupOf(named, r.ctx.products) : null);
}

/** Candidatos parecidos al mejor (≥ 50 % de su puntuación de recuperación), como mucho 10. */
function similarProducts(r: JevReading, segmentIndex: number): Product[] {
  const rs = r.meta.segments[segmentIndex]!;
  const top = Math.max(0, ...rs.scores.values());
  return [...rs.candidates.entries()]
    .filter(([key]) => (rs.scores.get(key) ?? 0) >= top * 0.5)
    .sort(([a], [b]) => (rs.scores.get(b) ?? 0) - (rs.scores.get(a) ?? 0))
    .slice(0, 10)
    .map(([, product]) => product);
}

/** Productos de cada segmento. Devuelve una aclaración si alguno no llega al umbral. */
export function resolveProducts(r: JevReading, context: ContextKey, forAction: boolean): ResolvedProduct[] | ClarifyPlan {
  const resolved: ResolvedProduct[] = [];
  if (!relevant(context, "producto")) return resolved;
  // Al preguntar «¿qué producto?» la respuesta escrita ya es el producto (clarify-answer.ts): no se vuelve a extraer.
  const typed = r.overrides.producto_elegido ? r.ctx.products.find((p) => p.id === r.overrides.producto_elegido) : undefined;
  if (typed) return [{ product: typed, segmentIndex: 0, amount: null, unit: null, price: null, quantityOutcome: null, productOutcome: "actuar" }];
  // Varios productos encajan con lo escrito: se pregunta cuál, sin adivinar.
  if (r.overrides.producto_opciones) {
    const options = r.overrides.producto_opciones.split(",").map((id) => r.ctx.products.find((p) => p.id === id)).filter((p) => p !== undefined);
    if (options.length > 0) return { type: "clarify", field: "producto", question: "¿Cuál de estos productos?", options: options.map((p) => ({ id: p.id, label: p.name, probability: null })) };
  }
  for (const [i, rs] of r.meta.segments.entries()) {
    const id = `producto_${i}`;
    const answer = r.choice(id);
    // Evidencia literal: el fragmento nombra el producto elegido («2 cajas de beefeater»).
    const chosen = answer ? rs.candidates.get(answer.choice) : undefined;
    // Para escribir, el nombre dicho debe encajar entero: «Prubea Luis» no es «Luis Latour» aunque
    // comparta «luis». Solo se mira el fragmento del producto (no la frase entera con la operación).
    // Solo en fragmentos con cantidad (en los demás «productText» es la frase entera).
    const unexplained =
      // Si el producto lo eligió el usuario al aclarar, manda su elección.
      forAction && chosen && r.overrides[id] === undefined && rs.segment.amount !== null && rs.segment.productText && rs.segment.productText !== rs.segment.text
        ? unexplainedWords(rs.segment.productText, chosen, (w) => isUnitWord(w) || r.placeWords.has(w))
        : [];
    const literal = !!chosen && unexplained.length === 0 && namesProduct(rs.segment.productText || rs.segment.text, chosen);
    const g = r.gate(id, "Producto", slotSpec(r.thresholds, context, "producto", literal), (v) => (v === NINGUNO || v === VARIOS ? label(v) : v));
    if (!g) continue;
    if (unexplained.length > 0 && g.choice === answer?.choice && g.outcome !== "preguntar") {
      g.outcome = "preguntar";
      const last = r.decisions[r.decisions.length - 1];
      if (last?.id === id) last.gate = "preguntar";
    }
    // Un solo candidato, el mensaje lo nombra tal cual y Jev lo pone primero («4 tónicas» con una sola
    // tónica: 0,50 frente a «varios» 0,38): no hay otro producto al que pueda referirse.
    if (g.outcome !== "actuar" && literal && rs.candidates.size === 1 && chosen && g.ranked[0]?.option === answer!.choice && g.probability >= 0.45) {
      g.outcome = "actuar";
      r.markActed(id);
    }
    // En una consulta (solo lectura) basta con que el mensaje nombre el único candidato y Jev le dé
    // algo de peso: «¿cuál es el mínimo de tónica en pickels?» (ninguno 0,46, la tónica 0,43).
    const [onlyKey, only] = rs.candidates.size === 1 ? [...rs.candidates.entries()][0]! : [undefined, undefined];
    if (!forAction && only && onlyKey && g.outcome !== "actuar" && namesProduct(rs.segment.productText || rs.segment.text, only) && ((answer!.probabilities as Record<string, number>)[onlyKey] ?? 0) >= 0.3) {
      r.markActed(id);
      resolved.push({ product: only, segmentIndex: i, amount: null, unit: null, price: null, quantityOutcome: null, productOutcome: "actuar" });
      continue;
    }
    if (g.choice === NINGUNO && g.outcome === "actuar") {
      const whole = !forAction && rs.segment.amount === null ? catalogFamily(r, i) : null;
      if (whole) {
        r.familia = whole.label;
        for (const product of whole.products) resolved.push({ product, segmentIndex: i, amount: null, unit: null, price: null, quantityOutcome: null });
      }
      continue;
    }
    // "ron" con varios rones: en una consulta se incluyen todos; en una escritura se pregunta cuál.
    if (g.choice === VARIOS && g.outcome !== "preguntar") {
      const family = similarProducts(r, i);
      if (!forAction) {
        const whole = catalogFamily(r, i);
        if (whole) r.familia = whole.label;
        for (const product of whole?.products ?? family) resolved.push({ product, segmentIndex: i, amount: null, unit: null, price: null, quantityOutcome: null });
        continue;
      }
      return {
        type: "clarify",
        field: "producto",
        question: rs.segment.amount !== null && !wholeMessage(rs.segment) ? `¿Cuál de estos productos es «${rs.segment.text}»?` : "¿Cuál de estos productos?",
        options: [...family]
          .sort((a, b) => (r.habits?.products[b.id] ?? 0) - (r.habits?.products[a.id] ?? 0))
          .slice(0, 4)
          .map((p) => ({ id: p.name, label: p.name, probability: null })),
        segmentIndex: i,
      };
    }
    // Entre ask y act con un producto concreto se sigue: en una escritura el borrador lo marca para
    // revisar (el propio borrador es la confirmación). Por debajo de ask, o "ninguno", se pregunta.
    if (g.choice === NINGUNO || g.outcome === "preguntar") {
      // En una consulta sin cantidad, la duda entre "ninguno" y "varios" no bloquea: sin filtro, o la familia.
      const vague = g.ranked[0]?.option === NINGUNO || g.ranked[0]?.option === VARIOS;
      const whole = !forAction && rs.segment.amount === null ? catalogFamily(r, i, vague) : null;
      if (whole) {
        // «¿cuántas cervezas quedan?»: la familia entera, aunque Jev dude entre «ninguno» y «varios».
        r.familia = whole.label;
        for (const product of whole.products) resolved.push({ product, segmentIndex: i, amount: null, unit: null, price: null, quantityOutcome: null });
        continue;
      }
      if (!forAction && rs.segment.amount === null && g.ranked[0]?.option === NINGUNO) continue;
      if (!forAction && rs.segment.amount === null && g.ranked[0]?.option === VARIOS) {
        for (const product of similarProducts(r, i)) resolved.push({ product, segmentIndex: i, amount: null, unit: null, price: null, quantityOutcome: null });
        continue;
      }
      const question =
        unexplained.length > 0
          ? `No encuentro «${rs.segment.productText}» tal cual en el catálogo. ¿Es alguno de estos? Si es un producto nuevo, primero hay que darlo de alta.`
          : rs.segment.amount !== null && !wholeMessage(rs.segment)
            ? `¿A qué producto te refieres con «${rs.segment.text}»?`
            : rs.segment.amount !== null
              ? `¿De qué producto son las ${amountLabel(rs.segment.amount, rs.segment.unit)}?`
              : "¿A qué producto te refieres?";
      return r.clarify("producto", question, g.ranked, [NINGUNO, VARIOS], (v) => v, i);
    }
    const product = rs.candidates.get(g.choice);
    if (!product) continue;
    // Cantidad escrita por el usuario al responder «¿qué cantidad?»: manda sobre la del mensaje.
    const typedAmount = r.overrides[`cantidad_${i}`];
    if (typedAmount !== undefined) {
      const typedUnit = r.overrides[`unidad_texto_${i}`] ?? null;
      r.decisions.push({ id: `cantidad_ok_${i}`, label: "Cantidad", value: `${typedAmount} ${typedUnit ?? ""}`.trim(), valueLabel: amountLabel(typedAmount, typedUnit), probability: 1, confidence: null, gate: "actuar" });
      resolved.push({ product, segmentIndex: i, amount: typedAmount, unit: typedUnit, price: rs.segment.price, quantityOutcome: "actuar", productOutcome: g.outcome });
      continue;
    }
    let quantityOutcome: GateOutcome | null = null;
    const q = asNoul(r.answers[`cantidad_ok_${i}`]);
    if (q && rs.segment.amount !== null) {
      quantityOutcome = r.overrides[`cantidad_ok_${i}`] ? "actuar" : gateNoulYes(q, r.thresholds.cantidad);
      r.decisions.push({
        id: `cantidad_ok_${i}`,
        label: "Cantidad",
        value: `${rs.segment.amount} ${rs.segment.unit ?? ""}${rs.segment.loose ? ` + ${rs.segment.loose}` : ""}`.trim(),
        valueLabel: `${amountLabel(rs.segment.amount, rs.segment.unit)}${rs.segment.loose ? ` + ${amountLabel(rs.segment.loose, rs.segment.looseUnit ?? "ud")} sueltas` : ""}`,
        probability: q.noul,
        confidence: null,
        gate: quantityOutcome,
      });
    }
    const loose = rs.segment.loose ? { loose: rs.segment.loose, looseUnit: rs.segment.looseUnit ?? null } : {};
    resolved.push({ product, segmentIndex: i, amount: rs.segment.amount, unit: rs.segment.unit, price: rs.segment.price, quantityOutcome, productOutcome: g.outcome, ...loose });
  }
  return resolved;
}

/** Los productos del catálogo más parecidos a lo que dice el mensaje (por la búsqueda, no por Jev). */
export function closestProducts(r: JevReading, n: number): Array<{ key: string; product: Product }> {
  const scored = (r.meta.segments[0] ? [r.meta.segments[0]] : []).flatMap((rs) => [...rs.candidates.entries()].map(([key, product]) => ({ key, product, score: rs.scores.get(key) ?? 0 })));
  return scored.sort((a, b) => b.score - a.score).slice(0, n);
}

/** «2 botellas», «1 caja», «6 ud»: la cantidad del mensaje para enseñarla. */
function amountLabel(amount: string, unit: string | null): string {
  const n = formatDecimal(amount, 4);
  if (!unit) return n;
  const plural = amount !== "1" && !/^(ud|kg|g|l|cl|ml)$/.test(unit) ? (/[aeiou]$/.test(unit) ? `${unit}s` : `${unit}es`) : unit;
  return `${n} ${plural}`;
}
