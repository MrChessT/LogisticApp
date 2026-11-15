// Datos de cabecera de un albarán leído (texto del OCR ya en renglones) y alta de lo que no está en el catálogo:
// número del albarán, nombre del proveedor que lo emite y cómo se da de alta un producto desde una línea.

const SOCIEDAD = /^(.*?[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}.*?)[\s,.]*\b(S\.?\s?L\.?\s?U\.?|S\.?\s?L\.?|S\.?\s?A\.?|S\.?\s?C\.?|C\.?\s?B\.?)(?=$|[\s.,:;])/;

/** Número del albarán: «Albarán Nº A-2841», o la etiqueta en un renglón y el número en el siguiente. */
export function albaranNumber(text: string): string | null {
  const rows = text.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  const NUM = "([A-Za-z]{0,4}[-/ ]{0,3}\\d[\\w/-]*)";
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    // «TOTAL ALBARÁN 2.660,00» es un importe, no el número.
    if (!/albar[aá]n/i.test(row) || /^\s*total/i.test(row)) continue;
    const same = new RegExp(`albar[aá]n\\s*(?:n[º°o.]*\\s*)?[:.]?\\s*${NUM}`, "i").exec(row) ?? new RegExp(`n[º°o.]*\\s*(?:de\\s*)?albar[aá]n\\s*[:.]?\\s*${NUM}`, "i").exec(row);
    if (same && !/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(same[1]!)) return same[1]!.replace(/\s+/g, "");
    // «Nº Albarán   Fecha Albarán» y debajo «A/129  28-04-2023».
    if (/n[º°o.]*\s*(de\s*)?albar[aá]n/i.test(row) && rows[i + 1]) {
      const next = new RegExp(`^${NUM}`).exec(rows[i + 1]!);
      if (next && !/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(next[1]!)) return next[1]!.replace(/\s+/g, "");
    }
  }
  return null;
}

/** Nombre de la empresa que emite el albarán: el primer renglón de arriba con forma social («… S.L.»). El del cliente no. */
export function supplierNameGuess(text: string): string | null {
  for (const row of text.split(/\r?\n/).slice(0, 12)) {
    if (/cliente|destinatario|enviar a|facturar a/i.test(row)) continue;
    const m = SOCIEDAD.exec(row.replace(/^\s*albar[aá]n\b[\s:]*/i, "").trim());
    if (!m) continue;
    const name = m[1]!.replace(/[\s,.-]+$/, "").trim();
    if (name.length >= 3 && name.length <= 80) return titleCase(name);
  }
  return null;
}

/** Un nombre leído de un recuadro: sin espacios de más ni signos al final, y con mayúsculas normales si venía todo en ellas. */
export function cleanName(text: string): string | null {
  const t = text.replace(/\s+/g, " ").replace(/^[\s:;,.\-]+|[\s:;,.\-]+$/g, "");
  if (t.length < 2 || t.length > 120 || !/[A-Za-zÁÉÍÓÚÑáéíóúñ]{2}/.test(t)) return null;
  return t === t.toUpperCase() ? titleCase(t) : t;
}

const MINOR = new Set(["de", "del", "la", "las", "el", "los", "y", "e", "en", "con", "para"]);
function titleCase(s: string): string {
  return s.toLowerCase().split(/\s+/).map((w, i) => (i > 0 && MINOR.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
}

export type Measure = { dimension: "mass" | "volume" | "count"; packName: string; qtyBase: number };

/** Medidas en las que se puede dar de alta un producto desde un albarán: cada una con su factor a la unidad base (g, ml, ud). */
export const MEASURES: Measure[] = [
  { dimension: "count", packName: "Unidad", qtyBase: 1 },
  { dimension: "mass", packName: "Kg", qtyBase: 1000 },
  { dimension: "mass", packName: "g", qtyBase: 1 },
  { dimension: "volume", packName: "Litro", qtyBase: 1000 },
  { dimension: "volume", packName: "cl", qtyBase: 10 },
  { dimension: "volume", packName: "ml", qtyBase: 1 },
];

/**
 * La medida que dice la unidad escrita en la línea, con su factor exacto: «kg» son 1000 g, «g» es 1 g, «cl» son
 * 10 ml. Una unidad que no es de medida («caja», «bot») o que falta da null: no se adivina.
 */
export function unitMeasure(unit: string | null): Measure | null {
  const u = (unit ?? "").toLowerCase().replace(/\.$/, "");
  const name = /^(kg|kgs|k|kilo|kilos)$/.test(u) ? "Kg" : /^(g|gr|grs)$/.test(u) ? "g" : /^(l|lt|lts|litro|litros)$/.test(u) ? "Litro" : u === "cl" ? "cl" : u === "ml" ? "ml" : /^(ud|uds|u|un|und|unidad|unidades)$/.test(u) ? "Unidad" : null;
  return MEASURES.find((m) => m.packName === name) ?? null;
}

export type ProductDraft = Measure & { name: string; /** La medida no viene escrita en la línea: es una propuesta y hay que confirmarla. */ assumed: boolean };

/**
 * Cómo se da de alta un producto que viene en el albarán: el nombre como está escrito y la medida que dice la unidad
 * de la línea, con su factor exacto. Sin unidad se propone «Unidad», marcada como supuesta: la persona la confirma.
 */
export function productDraft(line: { description: string; unit: string | null }): ProductDraft | null {
  const raw = line.description.replace(/\s+/g, " ").trim();
  if (raw.length < 2) return null;
  const name = (raw === raw.toUpperCase() ? raw.charAt(0) + raw.slice(1).toLowerCase() : raw).slice(0, 120);
  const measure = unitMeasure(line.unit);
  return { name, ...(measure ?? MEASURES[0]!), assumed: measure === null };
}
