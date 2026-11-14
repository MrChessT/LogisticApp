// Informe PDF de /informes: una sección por vista (cifras, gráfica y tabla con los datos exactos). Se genera en
// el servidor con los mismos cálculos que la pantalla, así que el documento y la pantalla no pueden discrepar.
import Decimal from "decimal.js";
import PDFDocument from "pdfkit";
import type { AnalyticsView, ChartSpec, Kpi } from "../contract/index";
import { drawColumns, drawLines, drawRanking, RANKING_ROW } from "./pdf-charts";
import { COLOR, contentWidth, DOC_BOTTOM, footers, kpiRow, line, MARGIN, newPage, room, rule, setText, table, type Doc, type TableColumn } from "./pdf-layout";

export interface ReportView {
  id: AnalyticsView;
  title: string;
  periodLabel: string;
  locationName: string | null;
  kpis: Kpi[];
  charts: ChartSpec[];
}

export interface ReportInput {
  organization: string;
  generatedAt: Date;
  views: ReportView[];
}

/** Lo que significa cada cifra, solo para las vistas que aparecen en el informe. */
const NOTES: Partial<Record<AnalyticsView, string>> = {
  compras: "Compras: importe de los albaranes cerrados (cantidad × precio de cada formato). Departamento: primer nivel de la categoría del catálogo; familia: la categoría completa.",
  cuentas: "Variación de stock = compras − salidas. Las salidas son consumo, pérdidas, invitaciones y consumo del personal. Las pérdidas se miden sobre lo consumido.",
  consumo: "Consumo: todas las salidas que consumen stock (consumo, mermas, invitaciones y ajustes negativos). Cuentas las separa.",
  mermas: "Pérdidas: mermas con motivo de pérdida. Invitaciones y consumo del personal se muestran aparte.",
};

const DATE_TIME = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });

/** Altura aproximada de un bloque de gráfica (título, gráfica y tabla), para decidir si cabe en la página. */
function blockHeight(spec: ChartSpec): number {
  const rows = spec.series[0]?.points.length ?? 0;
  const chart = spec.kind === "line" ? 190 : spec.kind === "column" ? 150 : rows * RANKING_ROW + 4;
  return 34 + chart + 26 + Math.min(rows, 8) * 17 + 16;
}

function chartBlock(doc: Doc, spec: ChartSpec) {
  // Basta con que quepan el título y el comienzo de la gráfica: la tabla puede seguir en la página siguiente.
  if (!room(doc, Math.min(blockHeight(spec), 150))) newPage(doc);
  setText(doc, 11, COLOR.ink, true);
  line(doc, spec.title, MARGIN, doc.y);
  setText(doc, 8.5, COLOR.muted);
  line(doc, spec.subtitle, MARGIN, doc.y + 15);
  doc.y += 34;
  const empty = spec.empty || spec.series.every((s) => s.points.length === 0);
  if (empty) {
    setText(doc, 9, COLOR.muted);
    line(doc, spec.empty ?? "Sin datos en este periodo.", MARGIN, doc.y + 6);
    doc.y += 34;
    return;
  }
  const w = contentWidth(doc);
  if (spec.kind === "line") {
    const height = drawLines(doc, spec, MARGIN, doc.y, w, 190);
    doc.y += height + 12;
    lineTable(doc, spec);
  } else if (spec.kind === "column") {
    const height = drawColumns(doc, spec, MARGIN, doc.y, w, 150);
    doc.y += height + 14;
    rankingTable(doc, spec, "Concepto");
  } else {
    const height = drawRanking(doc, spec, MARGIN, doc.y, w);
    doc.y += height + 12;
    rankingTable(doc, spec, "Concepto");
  }
}

/** Tabla de un ranking o de columnas: el concepto y su valor exacto (con el porcentaje cuando lo hay). */
function rankingTable(doc: Doc, spec: ChartSpec, first: string) {
  const w = contentWidth(doc);
  const points = spec.series[0]?.points ?? [];
  const withShare = points.some((p) => p.display.includes(" · "));
  const columns: TableColumn[] = [
    { label: first, width: w * 0.5 },
    { label: spec.format !== "money" ? "Valor" : withShare ? "Importe · participación" : "Importe", width: w * 0.5, align: "right" },
  ];
  const rows = points.map((p) => [p.label, p.display]);
  table(doc, columns, rows);
}

/** Tabla de una gráfica de líneas: por serie, el mínimo, el máximo y el último valor del periodo. */
function lineTable(doc: Doc, spec: ChartSpec) {
  const w = contentWidth(doc);
  const columns: TableColumn[] = [
    { label: "Serie", width: w * 0.4 },
    { label: "Mínimo", width: w * 0.2, align: "right" },
    { label: "Máximo", width: w * 0.2, align: "right" },
    { label: "Último", width: w * 0.2, align: "right" },
  ];
  const rows = spec.series.map((s) => {
    const sorted = [...s.points].sort((a, b) => new Decimal(a.value).cmp(b.value));
    return [s.name, sorted[0]?.display ?? "—", sorted.at(-1)?.display ?? "—", s.points.at(-1)?.display ?? "—"];
  });
  table(doc, columns, rows);
}

function viewSection(doc: Doc, view: ReportView, first: boolean) {
  if (!first) {
    // Cada vista empieza en página nueva solo si no caben su título, sus cifras y el comienzo de su primera gráfica.
    if (room(doc, 240)) doc.y += 18;
    else newPage(doc);
  }
  setText(doc, 16, COLOR.ink, true);
  line(doc, view.title, MARGIN, doc.y);
  setText(doc, 8.5, COLOR.muted);
  line(doc, `${view.locationName ?? "Todos los locales"} · ${view.periodLabel}`, MARGIN, doc.y + 21);
  doc.y += 40;
  rule(doc, doc.y - 6, COLOR.brand, 1);
  if (view.kpis.length > 0) kpiRow(doc, view.kpis.map((k) => ({ label: k.label, value: k.value, hint: k.hint })));
  for (const chart of view.charts) {
    doc.y += 4;
    chartBlock(doc, chart);
  }
}

function notesSection(doc: Doc, views: ReportView[]) {
  const notes = views.map((v) => NOTES[v.id]).filter((n): n is string => Boolean(n));
  if (notes.length === 0) return;
  if (!room(doc, 60 + notes.length * 22)) newPage(doc);
  setText(doc, 11, COLOR.ink, true);
  line(doc, "Cómo se calcula", MARGIN, doc.y + 6);
  doc.y += 26;
  for (const note of notes) {
    setText(doc, 8.5, COLOR.ink2);
    // Con ancho y sin `lineBreak: false`, pdfkit avanza `doc.y` tras el párrafo.
    doc.text(note, MARGIN, doc.y, { width: contentWidth(doc) });
    doc.y += 6;
  }
}

/** Genera el PDF completo. Devuelve los bytes listos para descargar. */
export function buildReportPdf(input: ReportInput): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    bufferPages: true,
    margins: { top: MARGIN, bottom: DOC_BOTTOM, left: MARGIN, right: MARGIN },
    info: { Title: input.views.length === 1 ? `Informe de ${input.views[0]!.title}` : "Informe completo", Author: "LogisticApp", Creator: "LogisticApp" },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const [first] = input.views;
  setText(doc, 8, COLOR.brand, true);
  line(doc, input.organization ? input.organization.toUpperCase() : "LOGISTICAPP", MARGIN, MARGIN);
  setText(doc, 22, COLOR.ink, true);
  doc.y = MARGIN + 16;
  line(doc, input.views.length === 1 ? `Informe de ${first?.title ?? ""}` : "Informe completo de inventario y compras", MARGIN, doc.y);
  doc.y += 32;
  setText(doc, 9, COLOR.muted);
  line(doc, `Local: ${first?.locationName ?? "Todos los locales"} · Periodo: ${first?.periodLabel ?? ""} · Generado el ${DATE_TIME.format(input.generatedAt)}`, MARGIN, doc.y);
  doc.y += 20;
  rule(doc, doc.y, COLOR.brand, 1.5);
  doc.y += 16;

  input.views.forEach((view, i) => viewSection(doc, view, i === 0));
  notesSection(doc, input.views);
  footers(doc, input.organization);
  doc.end();
  return done;
}

