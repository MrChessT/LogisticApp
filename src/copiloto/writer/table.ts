// Tabla de una consulta para el chat: las filas ya formateadas del resultado, con las columnas que
// importan en cada consulta. Con una sola fila no hace falta tabla (basta el texto).
import type { TableEvent } from "../contract/index";
import type { Dato } from "../jev/catalog";
import type { ToolResult, ToolRow } from "../tools/types";
import type { Evaluation } from "../agent/report";

type Column = TableEvent["columns"][number];

const text = (v: ToolRow[string] | undefined): string => (v === null || v === undefined || typeof v === "boolean" ? "" : v);

function columnsFor(result: ToolResult, dato?: Dato): { columns: Column[]; flag?: (row: ToolRow) => boolean } {
  switch (result.tool) {
    case "query_stock":
      if (result.totals.desglose === "producto") {
        return {
          columns: [
            { key: "local", label: "Local" },
            { key: "cantidad", label: "Stock", align: "right" },
            { key: "minimo", label: "Mínimo", align: "right" },
            ...(dato === "valor" ? [{ key: "valor", label: "Valor", align: "right" as const }] : []),
          ],
          flag: (r) => r.bajo_minimo === true,
        };
      }
      if (result.totals.desglose === "local") {
        return {
          columns: [{ key: "producto", label: "Producto" }, { key: "cantidad", label: "Total", align: "right" }, { key: "desglose", label: "Por local" }],
          flag: (r) => r.bajo_minimo === true,
        };
      }
      if (result.totals.desglose === "espacio") {
        return { columns: [{ key: "espacio", label: "Sección" }, { key: "producto", label: "Producto" }, { key: "cantidad", label: "Cantidad", align: "right" }] };
      }
      // El valor en euros solo si se pregunta por él («¿cuánto vale…?»); el local, solo si hay varios.
      return {
        columns: [
          { key: "producto", label: "Producto" },
          ...(new Set(result.rows.map((r) => r.local)).size > 1 ? [{ key: "local", label: "Local" }] : []),
          { key: "cantidad", label: "Cantidad", align: "right" },
          ...(dato === "valor" ? [{ key: "valor", label: "Valor", align: "right" as const }] : []),
        ],
        flag: (r) => r.bajo_minimo === true,
      };
    case "query_movements":
      if (result.totals.por_local) return { columns: [{ key: "local", label: "Local" }, { key: "tipo", label: "Tipo" }, { key: "valor", label: "Valor", align: "right" }, { key: "movimientos", label: "Registros", align: "right" }] };
      return { columns: [{ key: "tipo", label: "Tipo" }, { key: "producto", label: "Producto" }, { key: "cantidad", label: "Cantidad", align: "right" }, { key: "valor", label: "Valor", align: "right" }] };
    case "query_prices":
      return { columns: [{ key: "producto", label: "Producto" }, { key: "formato", label: "Formato" }, { key: "proveedor", label: "Proveedor" }, { key: "precio_actual", label: "Precio", align: "right" }] };
    case "query_pending_transfers":
      return { columns: [{ key: "origen", label: "Desde" }, { key: "destino", label: "A" }, { key: "enviado_hace", label: "Enviado" }, { key: "productos", label: "Productos" }] };
    case "query_count_variance":
      return { columns: [{ key: "producto", label: "Producto" }, { key: "local", label: "Local" }, { key: "diferencia", label: "Diferencia", align: "right" }, { key: "valor", label: "Valor", align: "right" }] };
    case "query_reorder":
      return { columns: [{ key: "producto", label: "Producto" }, { key: "local", label: "Local" }, { key: "stock", label: "Quedan", align: "right" }, { key: "sugerido", label: "Pedir", align: "right" }] };
    case "query_orders":
      return {
        columns: [{ key: "proveedor", label: "Proveedor" }, { key: "local", label: "Local" }, { key: "estado", label: "Estado" }, { key: "entrega", label: "Entrega" }, { key: "importe", label: "Importe", align: "right" }],
        flag: (r) => r.retraso === true,
      };
    case "query_product":
      return {
        columns: [{ key: "local", label: "Local" }, { key: "cantidad", label: "Stock", align: "right" }, { key: "valor", label: "Valor", align: "right" }, { key: "minimo", label: "Mínimo", align: "right" }],
        flag: (r) => r.bajo_minimo === true,
      };
    case "query_spend":
      return { columns: [{ key: "proveedor", label: "Proveedor" }, { key: "importe", label: "Importe", align: "right" }, { key: "porcentaje", label: "%", align: "right" }] };
    case "query_top_usage":
      return {
        columns: [
          { key: "posicion", label: "#", align: "right" },
          { key: "producto", label: "Producto" },
          { key: "cantidad", label: "Consumo", align: "right" },
          { key: "valor", label: "Valor", align: "right" },
          { key: "porcentaje", label: "%", align: "right" },
          { key: "desglose", label: "Por local" },
        ],
      };
  }
}

/** Consultas cuyo texto ordena por la valoración de Jev (urgencia, subidas): ahí manda el texto. */
const EVALUATED = new Set<ToolResult["tool"]>(["query_reorder", "query_prices", "query_count_variance"]);

const URGENCY_LABEL = { baja: "Baja", media: "Media", alta: "Alta", critica: "Crítica" } as const;

/**
 * Reposición en tabla, de más a menos urgente: lo valorado por Jev primero (con su urgencia), después el
 * resto. El stock negativo se marca para revisar (es un descuadre, no «quedan -1»).
 */
export function reorderTable(result: ToolResult, evaluations: Evaluation[]): TableEvent | null {
  if (result.tool !== "query_reorder" || result.rows.length === 0) return null;
  const rank = { critica: 3, alta: 2, media: 1, baja: 0 } as const;
  const judged = [...evaluations].sort((a, b) => rank[b.urgency] - rank[a.urgency] || b.urgencyScore - a.urgencyScore);
  const key = (product: string, local: string) => `${product}\u0000${local}`;
  const urgency = new Map(judged.map((e) => [key(e.data.product ?? "", e.data.venue ?? ""), e.urgency]));
  const order = new Map(judged.map((e, i) => [key(e.data.product ?? "", e.data.venue ?? ""), i]));
  const rows = [...result.rows].sort(
    (a, b) => (order.get(key(String(a.producto), String(a.local))) ?? 1e6) - (order.get(key(String(b.producto), String(b.local))) ?? 1e6),
  );
  const oneLocal = new Set(rows.map((r) => r.local)).size === 1;
  const columns: Column[] = [
    { key: "producto", label: "Producto" },
    ...(oneLocal ? [] : [{ key: "local", label: "Local" }]),
    { key: "stock", label: "Quedan", align: "right" },
    { key: "sugerido", label: "Pedir", align: "right" },
    ...(urgency.size > 0 ? [{ key: "urgencia", label: "Urgencia" }] : []),
  ];
  const out = rows.map((r) => {
    const u = urgency.get(key(String(r.producto), String(r.local)));
    const stock = text(r.stock);
    return {
      producto: text(r.producto),
      local: text(r.local),
      stock: stock.startsWith("-") ? `${stock} (revisar)` : stock,
      sugerido: text(r.sugerido),
      urgencia: u ? URGENCY_LABEL[u] : "",
    };
  });
  const flagged = out.flatMap((r, i) => (r.urgencia === "Alta" || r.urgencia === "Crítica" || r.stock.startsWith("-") ? [i] : []));
  return {
    columns,
    rows: out.map((r) => Object.fromEntries(columns.map((c) => [c.key, r[c.key as keyof typeof r]]))),
    ...(flagged.length > 0 ? { flagged } : {}),
    ...(result.truncated ? { more: result.count - result.rows.length } : {}),
  };
}

/** null si no hay nada que tabular (una fila o ninguna) o si el texto va por urgencia valorada. */
export function tableFor(result: ToolResult, evaluated = false, dato?: Dato): TableEvent | null {
  if (result.rows.length < 2 || (evaluated && EVALUATED.has(result.tool))) return null;
  // Precio de productos concretos («¿a cuánto nos sale el Beefeater?»): con pocas filas basta el texto.
  if (dato === "precio" && result.tool === "query_prices" && result.rows.length <= 3) return null;
  const { columns, flag } = columnsFor(result, dato);
  const present = columns.filter((c) => result.rows.some((r) => text(r[c.key]) !== ""));
  const flagged = flag ? result.rows.flatMap((r, i) => (flag(r) ? [i] : [])) : [];
  return {
    columns: present,
    rows: result.rows.map((r) => Object.fromEntries(present.map((c) => [c.key, text(r[c.key])]))),
    ...(flagged.length > 0 ? { flagged } : {}),
    ...(result.truncated ? { more: result.count - result.rows.length } : {}),
  };
}
