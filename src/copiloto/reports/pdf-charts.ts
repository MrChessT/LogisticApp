// Gráficas del informe PDF dibujadas con vectores (no capturas): barras de ranking, columnas y líneas.
// Las cifras llegan como cadenas exactas; aquí solo se convierten a número para POSICIONAR las marcas.
import type { ChartSpec } from "../contract/index";
import { COLOR, Doc, fit, line, setText } from "./pdf-layout";

const SLOT = COLOR.slots[0];
const toNum = (value: string) => Number(value);

/** Escala «bonita» de marcas (1, 2 o 5 × 10^n) que cubre [min, max] con el cero incluido. */
function niceTicks(min: number, max: number, count = 4): number[] {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  const raw = (hi - lo || 1) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const n = raw / power;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * power;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

const compact = new Intl.NumberFormat("es-ES", { notation: "compact", maximumFractionDigits: 1 });
function tickText(value: number, format: ChartSpec["format"]): string {
  const n = compact.format(value);
  return format === "money" ? `${n} €` : format === "percent" ? `${n} %` : format === "days" ? `${n} d` : n;
}

/** Barra con los dos extremos redondeados solo en el lado del valor (el lado del cero queda recto). */
function barPath(x0: number, x1: number, y: number, h: number, r = 3): string {
  const w = Math.abs(x1 - x0);
  const rr = Math.min(r, h / 2, w);
  if (x1 >= x0) return `M${x0},${y}H${x1 - rr}Q${x1},${y} ${x1},${y + rr}V${y + h - rr}Q${x1},${y + h} ${x1 - rr},${y + h}H${x0}Z`;
  return `M${x0},${y}H${x1 + rr}Q${x1},${y} ${x1},${y + rr}V${y + h - rr}Q${x1},${y + h} ${x1 + rr},${y + h}H${x0}Z`;
}

/** Columna con las esquinas superiores redondeadas. */
function columnPath(x: number, y: number, w: number, h: number, r = 3): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

export const RANKING_ROW = 19;

/** Texto centrado en `cx` (con el tipo y tamaño activos). */
function centered(doc: Doc, value: string, cx: number, y: number) {
  line(doc, value, cx - doc.widthOfString(value) / 2, y);
}

/** Ranking horizontal: nombre a la izquierda, barra, y el valor exacto con su porcentaje a la derecha. */
export function drawRanking(doc: Doc, spec: ChartSpec, x: number, y: number, w: number): number {
  const points = spec.series[0]?.points ?? [];
  const labelW = Math.min(150, w * 0.34);
  const valueW = 132;
  const barX = x + labelW + 10;
  const barW = w - labelW - valueW - 20;
  const values = points.map((p) => toNum(p.value));
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo || 1;
  const xOf = (v: number) => barX + ((v - lo) / span) * barW;
  const zero = xOf(0);
  const diverging = spec.kind === "diverging";
  points.forEach((p, i) => {
    const v = toNum(p.value);
    const top = y + i * RANKING_ROW;
    const barY = top + (RANKING_ROW - 9) / 2;
    setText(doc, 8.5, COLOR.ink2);
    line(doc, fit(doc, p.label, labelW), x + labelW, barY - 0.5, { align: "right", width: labelW });
    const x0 = Math.min(zero, xOf(v));
    const x1 = Math.max(zero, xOf(v));
    if (x1 - x0 > 0.5) {
      const color = diverging && v < 0 ? COLOR.critical : SLOT;
      doc.save().path(barPath(x0, x1, barY, 9)).fill(color).restore();
    }
    setText(doc, 8.5, COLOR.ink, true);
    line(doc, p.display, x + w, barY - 0.5, { align: "right" });
  });
  if (lo < 0) doc.save().moveTo(zero, y).lineTo(zero, y + points.length * RANKING_ROW).lineWidth(0.6).strokeColor(COLOR.axis).stroke().restore();
  return points.length * RANKING_ROW;
}

/** Columnas verticales con su valor encima y la etiqueta debajo. */
export function drawColumns(doc: Doc, spec: ChartSpec, x: number, y: number, w: number, h: number): number {
  const points = spec.series[0]?.points ?? [];
  const labelH = 14;
  const valueH = 13;
  const plotTop = y + valueH;
  const plotBottom = y + h - labelH;
  const hi = Math.max(0, ...points.map((p) => toNum(p.value))) || 1;
  const band = w / Math.max(points.length, 1);
  const barW = Math.min(30, band * 0.55);
  doc.save().moveTo(x, plotBottom).lineTo(x + w, plotBottom).lineWidth(0.6).strokeColor(COLOR.axis).stroke().restore();
  points.forEach((p, i) => {
    const cx = x + band * i + band / 2;
    const bh = (toNum(p.value) / hi) * (plotBottom - plotTop);
    if (bh > 0.5) doc.save().path(columnPath(cx - barW / 2, plotBottom - bh, barW, bh)).fill(SLOT).restore();
    setText(doc, 8, COLOR.ink, true);
    centered(doc, p.display, cx, plotBottom - bh - valueH + 2);
    setText(doc, 7.5, COLOR.muted);
    centered(doc, fit(doc, p.label, band - 4), cx, plotBottom + 4);
  });
  return h;
}

/** Líneas con varias series (máximo cuatro): leyenda arriba, rejilla y eje de fechas abajo. */
export function drawLines(doc: Doc, spec: ChartSpec, x: number, y: number, w: number, h: number): number {
  const legendH = 16;
  let lx = x;
  spec.series.forEach((s, i) => {
    doc.save().circle(lx + 3, y + 5, 3).fill(COLOR.slots[i] ?? SLOT).restore();
    setText(doc, 8, COLOR.ink2);
    line(doc, s.name, lx + 10, y + 1);
    lx += 16 + doc.widthOfString(s.name) + 14;
  });
  const top = y + legendH + 4;
  const bottom = y + h - 16;
  const left = x + 56;
  const right = x + w - 4;
  const values = spec.series.flatMap((s) => s.points.map((p) => toNum(p.value)));
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const lo = ticks[0]!;
  const hi = ticks.at(-1)!;
  const yOf = (v: number) => bottom - ((v - lo) / (hi - lo || 1)) * (bottom - top);
  for (const t of ticks) {
    doc.save().moveTo(left, yOf(t)).lineTo(right, yOf(t)).lineWidth(t === 0 ? 0.6 : 0.4).strokeColor(t === 0 ? COLOR.axis : COLOR.grid).stroke().restore();
    setText(doc, 7.5, COLOR.muted);
    line(doc, tickText(t, spec.format), left - 6, yOf(t) - 4, { align: "right", width: 50 });
  }
  const dates = spec.series[0]?.points ?? [];
  const n = dates.length;
  const xOf = (i: number) => left + (n <= 1 ? (right - left) / 2 : (i / (n - 1)) * (right - left));
  spec.series.forEach((s, si) => {
    const color = COLOR.slots[si] ?? SLOT;
    if (s.points.length === 0) return;
    const d = s.points.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(2)},${yOf(toNum(p.value)).toFixed(2)}`).join(" ");
    doc.save().path(d).lineWidth(1.6).lineJoin("round").lineCap("round").strokeColor(color).stroke().restore();
    const last = s.points.at(-1)!;
    doc.save().circle(xOf(s.points.length - 1), yOf(toNum(last.value)), 2.6).fill(color).restore();
  });
  // Tres fechas de referencia: la primera, la de en medio y la última.
  for (const i of [0, Math.floor((n - 1) / 2), n - 1]) {
    const p = dates[i];
    if (!p) continue;
    setText(doc, 7.5, COLOR.muted);
    const tw = doc.widthOfString(p.label);
    const px = i === 0 ? left : i === n - 1 ? right - tw : xOf(i) - tw / 2;
    line(doc, p.label, px, bottom + 4);
  }
  return h;
}
