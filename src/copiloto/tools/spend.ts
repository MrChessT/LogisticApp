// Gasto (query_spend): lo comprado en el periodo, por proveedor. Con una familia («¿cuánto he gastado en bebida?»)
// cuentan solo las líneas de sus productos; sin ella, el albarán entero.
import Decimal from "decimal.js";
import { formatDecimal, formatMoney } from "../entities/units";
import { addDays, formatDay } from "./periods";
import type { InventoryDataSource, ToolParams, ToolResult, ToolRow } from "./types";

// Las mismas filas como mucho que el resto de consultas (tools.ts).
const MAX_ROWS = 12;

export async function spendBySupplier(source: InventoryDataSource, params: ToolParams, today: string): Promise<ToolResult> {
  const from = params.period?.from ?? addDays(today, -29);
  const to = params.period?.to ?? today;
  const family = params.family ? new Set(params.family.productIds) : null;
  const raw = family
    ? (await source.purchaseLines({ locationIds: params.locationIds, since: from }))
        .filter((l) => l.docDate <= to && family.has(l.productId))
        .map((l) => ({ receiptId: l.receiptId, supplierName: l.supplierName, total: l.amount }))
    : (await source.purchases({ locationIds: params.locationIds, since: from })).filter((p) => p.docDate <= to);
  const receipts = new Set(raw.map((p) => p.receiptId));
  const bySupplier = new Map<string, { total: Decimal; receipts: Set<string> }>();
  for (const p of raw) {
    const key = p.supplierName ?? "Sin proveedor";
    const entry = bySupplier.get(key) ?? { total: new Decimal(0), receipts: new Set<string>() };
    entry.total = entry.total.plus(p.total);
    entry.receipts.add(p.receiptId);
    bySupplier.set(key, entry);
  }
  const total = [...bySupplier.values()].reduce((acc, e) => acc.plus(e.total), new Decimal(0));
  const rows: ToolRow[] = [...bySupplier.entries()]
    .sort((a, b) => b[1].total.cmp(a[1].total))
    .map(([name, e]) => ({
      proveedor: name,
      albaranes: String(e.receipts.size),
      importe: formatMoney(e.total),
      porcentaje: `${formatDecimal(total.isZero() ? 0 : e.total.div(total).mul(100), 1)} %`,
    }));
  const totals = { total: formatMoney(total), albaranes: String(receipts.size), desde: formatDay(from), hasta: formatDay(to), ...(params.family ? { familia: params.family.label } : {}) };
  return { tool: "query_spend", rows: rows.slice(0, MAX_ROWS), totals, count: rows.length, truncated: rows.length > MAX_ROWS, evalItems: [] };
}
