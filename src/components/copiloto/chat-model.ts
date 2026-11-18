// Modelo del chat en el navegador: los mensajes de la conversación, las rutas de la app y cómo se
// resume un mensaje al adjuntarlo a un reporte.
import type { FileTarget } from "@/lib/pending-file";
import type { FileSummary } from "./documents";
import type { TranscriptEntry } from "@/lib/copilot-feedback";
import type { ActionsEvent, AppRoute, ChartSpec, ClarifyEvent, DecisionEvent, Draft, FormEvent, NavigateEvent, ResolvedEvent, TableEvent } from "@/copiloto/contract";
import type { Suggestion } from "@/copiloto/suggestions/engine";

export type Item =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "assistant";
      text: string;
      pending: boolean;
      decision?: DecisionEvent;
      navigate?: NavigateEvent;
      clarify?: ClarifyEvent;
      /** Miniformulario (faltan varios datos de una operación clara) y si ya se envió. */
      form?: FormEvent;
      formSent?: boolean;
      draft?: Draft;
      /** El borrador se confirmó o descartó después, desde el chat. */
      resolved?: ResolvedEvent;
      /** Varias órdenes en un mensaje: los borradores que siguen al primero, cada uno con su estado. */
      moreDrafts?: Array<{ draft: Draft; resolved?: ResolvedEvent }>;
      /** El texto final se enseña aunque haya borrador (varias órdenes, con notas). */
      showText?: boolean;
      charts?: ChartSpec[];
      table?: TableEvent;
      actions?: ActionsEvent["actions"];
      error?: string;
      /** Archivo leído en el chat (foto, PDF u hoja): se revisa y guarda en su pantalla (documents.ts). */
      file?: { file: File; open?: FileSummary["open"] };
      /** Guía de /ayuda. */
      help?: boolean;
      /** Lista de /avisos. */
      alerts?: Suggestion[];
    };

export type AssistantItem = Extract<Item, { role: "assistant" }>;

export const ROUTE_LABELS: Record<AppRoute, string> = {
  "/": "Panel",
  "/productos": "Productos",
  "/stock": "Stock",
  "/pedidos": "Pedidos",
  "/recepciones": "Recepciones",
  "/traspasos": "Traspasos",
  "/inventarios": "Inventarios",
  "/mermas": "Mermas",
  "/informes": "Informes",
  "/almacen": "Almacén",
  "/proveedores": "Proveedores",
  "/escandallos": "Escandallos",
  "/ventas": "Ventas",
  "/facturas": "Facturas",
  "/equipo": "Equipo",
  "/zonas": "Zonas",
};

/** Pantalla donde se revisa y guarda cada archivo que llega al chat. */
export const ROUTE_OF: Record<FileTarget, string> = { recepcion: "/recepciones", factura: "/facturas", importar: "/importar", ventas: "/ventas" };

export function currentRoute(pathname: string | null): AppRoute {
  const route = (Object.keys(ROUTE_LABELS) as AppRoute[]).find((r) => r !== "/" && pathname?.startsWith(r));
  return route ?? "/";
}

/** Ruta de la app con los filtros que entienden las páginas (?local=, ?producto=, ?estado=). */
export function hrefFor(nav: NavigateEvent): string {
  const params = new URLSearchParams();
  if (nav.filters.locationId) params.set("local", nav.filters.locationId);
  if (nav.filters.productId) params.set("producto", nav.filters.productId);
  if (nav.filters.status) params.set("estado", nav.filters.status);
  if (nav.filters.view) params.set("vista", nav.filters.view);
  if (nav.filters.days) params.set("dias", String(nav.filters.days));
  const query = params.toString();
  return query ? `${nav.route}?${query}` : nav.route;
}

export function newId(): string {
  return crypto.randomUUID();
}

/** Un mensaje del chat tal como se adjunta a un reporte: el texto y, en una línea, lo que lo acompañaba. */
export function toEntry(item: Item, flagged: boolean): TranscriptEntry {
  if (item.role === "user") return { role: "user", text: item.text, ...(flagged ? { flagged } : {}) };
  const detail = [
    item.draft && `Borrador: ${item.draft.title}`,
    ...(item.moreDrafts ?? []).map((m) => `Borrador: ${m.draft.title}`),
    item.resolved && `Borrador ${item.resolved.status}`,
    item.clarify && item.clarify.options.length > 0 && `Opciones: ${item.clarify.options.map((o) => o.label).join(" / ")}`,
    item.form && `Formulario: ${item.form.fields.map((f) => f.label).join(", ")}`,
    item.table && `Tabla: ${item.table.columns.map((c) => c.label).join(", ")} · ${item.table.rows.length} filas`,
    item.charts?.length && `${item.charts.length} gráfico(s)`,
    item.actions?.length && `Botones: ${item.actions.map((a) => a.label).join(" / ")}`,
    item.navigate && `Enlace a ${ROUTE_LABELS[item.navigate.route]}`,
    item.error && `Error: ${item.error}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return { role: "assistant", text: item.text, ...(detail ? { detail } : {}), ...(flagged ? { flagged } : {}) };
}

