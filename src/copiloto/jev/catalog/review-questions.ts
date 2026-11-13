// Preguntas de la llamada nº 2: revisión de lo que el código ya calculó (coherencia del borrador,
// urgencia de las sugerencias, duplicados y sentido de un producto nuevo, precio y mínimo plausibles).
import { choice, noul, score, type ChoiceCriteria, type Questions } from "@typesafe-ai/sdk";
import { NINGUNO, options } from "./criteria";

// Llamada nº 2: evaluación de datos calculados por el código ---------------------

export type EvalKind = "reponer" | "desvio" | "subida" | "atasco" | "pedido" | "conteo";

const URGENCY_LEVELS = [
  "baja: can wait; informational only.",
  "media: should be handled this week.",
  "alta: should be handled today or before the next service.",
  "critica: service is at risk right now (stock-out, large loss, goods missing in transit).",
] as const;
export const URGENCY_KEYS = ["baja", "media", "alta", "critica"] as const;
export type Urgency = (typeof URGENCY_KEYS)[number];

const EVAL_INSTRUCTIONS: Record<EvalKind, (i: number) => string> = {
  reponer: (i) =>
    `Should \`items.${i}.product\` be restocked before \`horizon\`, given \`items.${i}.coverage_days\`, \`items.${i}.minimum\` and \`items.${i}.pending_in\`?`,
  desvio: (i) =>
    `Is the count difference in \`items.${i}\` (\`items.${i}.diff\`, \`items.${i}.diff_pct\`, \`items.${i}.diff_value\`) large enough to investigate at a hospitality venue?`,
  subida: (i) =>
    `Is the price change in \`items.${i}\` (\`items.${i}.old_price\` to \`items.${i}.new_price\`, \`items.${i}.change_pct\`) significant for a hospitality buyer?`,
  atasco: (i) =>
    `Has transfer \`items.${i}\` (sent \`items.${i}.sent_ago\`, value \`items.${i}.value\`) been in transit long enough to follow up?`,
  pedido: (i) =>
    `Does purchase order \`items.${i}\` (\`items.${i}.state\`, age \`items.${i}.age\`, expected \`items.${i}.expected\`, value \`items.${i}.value\`) need the manager to act now (chase the supplier or send the draft)?`,
  conteo: (i) =>
    `Is it time to count stock at \`items.${i}.venue\`, given \`items.${i}.days_since_count\` without a count and \`items.${i}.stock_value\` in stock?`,
};

const EVAL_CRITERIA: Partial<Record<EvalKind, { true: string; false: string }>> = {
  reponer: { true: "It will likely run out or fall below minimum.", false: "Current stock is enough." },
};

export function evaluationQuestions(kinds: EvalKind[], withDraft: boolean): Questions {
  const questions: Questions = {};
  kinds.forEach((kind, i) => {
    questions[`${kind}_${i}`] = noul(EVAL_INSTRUCTIONS[kind](i), EVAL_CRITERIA[kind]);
    questions[`urgencia_${i}`] = score(`How urgent is it to act on \`items.${i}\`?`, URGENCY_LEVELS);
  });
  if (withDraft) {
    questions.coherencia = noul(
      "Does `draft` match `request`? Details the request leaves implicit are fine (for example the venue that owns the named bar, or the usual bottle size). Answer no only if the operation, product or quantity contradicts the request.",
      {
        true: "It matches; a person would confirm it.",
        false: "The operation, product or quantity is different from what was asked.",
      },
    );
  }
  return questions;
}

// Llamada nº 2 en acciones de catálogo: revisión del borrador -----------------------------
// Cada borrador de catálogo añade estas preguntas a la de coherencia, en la misma llamada.
// El state lleva `request`, `draft` y los bloques que referencian las preguntas.

const MEDIDAS = {
  volume: "Measured by volume (millilitres): drinks, spirits, beer, syrups, oils.",
  mass: "Measured by weight (grams): fruit, meat, ice, coffee beans, flour.",
  count: "Counted in units: cans, small bottles sold individually, packs, napkins, disposables.",
} as const satisfies ChoiceCriteria;
export type Medida = keyof typeof MEDIDAS;

/** ¿Es el producto nuevo el mismo artículo que `similar.i`? (uno por candidato). */
function duplicateQuestions(count: number): Questions {
  const questions: Questions = {};
  for (let i = 0; i < count; i += 1) {
    questions[`duplicado_${i}`] = noul(
      `Is \`new_product\` the same item as \`similar.${i}\` — the same product written differently (abbreviation, missing brand, typo, word order, size written another way)? A different size, flavour, brand or variety is a different item.`,
      {
        true: "Same item: creating it would duplicate the catalog.",
        false: "A different item that can coexist in the catalog.",
      },
    );
  }
  return questions;
}

export function newProductQuestions(input: { similar: number; categories: string[]; askDimension: boolean; hasPrice: boolean }): Questions {
  const questions: Questions = {
    ...duplicateQuestions(input.similar),
    tiene_sentido: noul(
      "Is `new_product.name` a real item that a bar, restaurant or event venue would buy and keep in stock (drink, food, ingredient, consumable or supply), rather than a typo, test text, a sentence or nonsense?",
      {
        true: "A plausible stock item.",
        false: "Not a plausible stock item.",
      },
    ),
  };
  if (input.categories.length > 0) {
    questions.categoria = choice(
      "Which existing catalog category fits `new_product`?",
      options(input.categories, { [NINGUNO]: "None of these categories fits." }),
    );
  }
  if (input.askDimension) questions.medida = choice("How is `new_product` measured when counting stock?", MEDIDAS);
  if (input.hasPrice) {
    questions.precio_plausible = noul(
      "Is `new_product.price` a plausible supplier purchase price in euros for one `new_product.pack` of `new_product.name` in Spain?",
      {
        true: "Plausible for that item and pack.",
        false: "Implausible: far too high or too low, probably a typo.",
      },
    );
  }
  return questions;
}

export function priceChangeQuestions(): Questions {
  return {
    precio_plausible: noul(
      "Is `change.new_price` a plausible supplier purchase price in euros for one `change.pack` of `change.product`, given `change.old_price` and `change.change_pct`?",
      {
        true: "Plausible, even if it is a notable rise or drop.",
        false: "Implausible: probably a typo (an extra or missing digit, a misplaced decimal comma) or the wrong product.",
      },
    ),
  };
}

export function minimumQuestions(): Questions {
  return {
    valor_plausible: noul(
      "Is `change.new_value` a sensible `change.level` for `change.product` at a hospitality venue, compared with `change.current_stock`, `change.previous_value` and `change.usual_pack`?",
      {
        true: "Sensible for day-to-day operation.",
        false: "Probably a mistake: far too high or too low, or the wrong unit.",
      },
    ),
  };
}
