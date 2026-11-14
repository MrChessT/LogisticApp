// Maquetación del informe PDF: página A4, pie con número de página, tarjetas de cifras y tablas de datos.
// Solo dibuja: las cifras llegan ya calculadas y formateadas, igual que en pantalla.
import PDFDocument from "pdfkit";

export type Doc = InstanceType<typeof PDFDocument>;

export const MARGIN = 42;
/** Espacio reservado al pie: el contenido acaba por encima de él. */
const FOOTER = 36;
/** Margen inferior del documento: pdfkit no pagina por su cuenta dentro de él, así que el pie cabe aquí. */
export const DOC_BOTTOM = 14;

export const COLOR = {
  ink: "#0b0b0b",
  ink2: "#52514e",
  muted: "#898781",
  grid: "#e1e0d9",
  axis: "#c3c2b7",
  panel: "#f6f5f1",
  brand: "#0f8a5f",
  critical: "#d03b3b",
  /** Paleta categórica validada (guía de dataviz, modo claro), en orden fijo. */
  slots: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"],
} as const;

const FONT = { regular: "Helvetica", bold: "Helvetica-Bold" } as const;

export const contentWidth = (doc: Doc) => doc.page.width - MARGIN * 2;
const bottomLimit = (doc: Doc) => doc.page.height - FOOTER - 6;

/** ¿Cabe `height` puntos más en esta página? */
export const room = (doc: Doc, height: number) => doc.y + height <= bottomLimit(doc);

export function newPage(doc: Doc) {
  doc.addPage();
  doc.y = MARGIN;
}

export function setText(doc: Doc, size: number, color: string, bold = false) {
  doc.font(bold ? FONT.bold : FONT.regular).fontSize(size).fillColor(color);
}

/** Texto en una línea, recortado con «…» si no cabe en `maxWidth` (con el tipo y tamaño activos). */
export function fit(doc: Doc, value: string, maxWidth: number): string {
  if (doc.widthOfString(value) <= maxWidth) return value;
  let out = value;
  while (out.length > 1 && doc.widthOfString(`${out}…`) > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

/**
 * Escribe una línea en (x, y) sin saltos. Con `align: "right"`, x es el borde derecho.
 * pdfkit mueve el cursor vertical (`doc.y`) al escribir; aquí se conserva, porque el cursor lo lleva el código.
 */
export function line(doc: Doc, value: string, x: number, y: number, opts: { width?: number; align?: "left" | "right" } = {}) {
  const width = opts.width ?? doc.widthOfString(value);
  const left = opts.align === "right" ? x - width : x;
  const cursor = doc.y;
  doc.text(value, left, y, { lineBreak: false, width: Math.max(width, 1) });
  doc.y = cursor;
}

export function rule(doc: Doc, y: number, color: string = COLOR.grid, weight = 0.6, from = MARGIN, to = doc.page.width - MARGIN) {
  doc.save().moveTo(from, y).lineTo(to, y).lineWidth(weight).strokeColor(color).stroke().restore();
}

export interface KpiCard {
  label: string;
  value: string;
  hint?: string;
}

/** Fila de tarjetas de cifras (KPI). Avanza `doc.y` debajo de la fila. */
export function kpiRow(doc: Doc, kpis: KpiCard[]) {
  if (kpis.length === 0) return;
  const gap = 8;
  const width = (contentWidth(doc) - gap * (kpis.length - 1)) / kpis.length;
  const height = 62;
  const y = doc.y;
  kpis.forEach((k, i) => {
    const x = MARGIN + i * (width + gap);
    doc.save().roundedRect(x, y, width, height, 6).fill(COLOR.panel).restore();
    doc.save().roundedRect(x, y, width, height, 6).lineWidth(0.6).strokeColor(COLOR.grid).stroke().restore();
    setText(doc, 7.5, COLOR.muted);
    line(doc, fit(doc, k.label, width - 18), x + 9, y + 9);
    // La cifra baja de tamaño hasta caber, para que «1.134,00 €» no se corte en las tarjetas estrechas.
    let size = 14;
    setText(doc, size, COLOR.ink, true);
    while (size > 9 && doc.widthOfString(k.value) > width - 18) {
      size -= 1;
      setText(doc, size, COLOR.ink, true);
    }
    line(doc, k.value, x + 9, y + 22);
    if (k.hint) {
      setText(doc, 7, COLOR.muted);
      line(doc, fit(doc, k.hint, width - 18), x + 9, y + 46);
    }
  });
  doc.y = y + height + 14;
}

export interface TableColumn {
  label: string;
  /** Ancho en puntos; la suma de las columnas es el ancho del contenido. */
  width: number;
  align?: "left" | "right";
}

const ROW_H = 17;

/** Tabla de datos con cabecera. Si no cabe, continúa en otra página con la cabecera repetida. */
export function table(doc: Doc, columns: TableColumn[], rows: string[][]) {
  const x0 = MARGIN;
  const drawHeader = () => {
    const y = doc.y;
    doc.save().rect(x0, y, columns.reduce((s, c) => s + c.width, 0), ROW_H).fill(COLOR.panel).restore();
    setText(doc, 7.5, COLOR.muted, true);
    let x = x0;
    for (const c of columns) {
      const inner = c.width - 12;
      if (c.align === "right") line(doc, fit(doc, c.label, inner), x + c.width - 6, y + 5, { align: "right" });
      else line(doc, fit(doc, c.label, inner), x + 6, y + 5);
      x += c.width;
    }
    doc.y = y + ROW_H;
  };
  if (!room(doc, ROW_H * 2)) newPage(doc);
  drawHeader();
  for (const row of rows) {
    if (!room(doc, ROW_H)) {
      newPage(doc);
      drawHeader();
    }
    const y = doc.y;
    let x = x0;
    row.forEach((cell, i) => {
      const c = columns[i]!;
      setText(doc, 8.5, COLOR.ink2);
      const shown = fit(doc, cell, c.width - 12);
      if (c.align === "right") line(doc, shown, x + c.width - 6, y + 4.5, { align: "right" });
      else line(doc, shown, x + 6, y + 4.5);
      x += c.width;
    });
    rule(doc, y + ROW_H, COLOR.grid, 0.5, x0, x0 + columns.reduce((s, c) => s + c.width, 0));
    doc.y = y + ROW_H;
  }
  doc.y += 10;
}

/** Pie de cada página (se dibuja al final, con las páginas ya contadas). */
export function footers(doc: Doc, organization: string) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - DOC_BOTTOM - 14;
    rule(doc, y - 8);
    setText(doc, 7.5, COLOR.muted);
    line(doc, `LogisticApp${organization ? ` · ${organization}` : ""} · Importes a coste medio`, MARGIN, y);
    line(doc, `Página ${i - range.start + 1} de ${range.count}`, doc.page.width - MARGIN, y, { align: "right" });
  }
}
