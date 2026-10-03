"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Check, Pencil, RotateCcw, Undo2, X } from "lucide-react";
import { describeQty, inputText, layoutOf, qtyFromInput, type MoveRow } from "@/lib/warehouse";

// Cola de salidas de un local. Quien puede validar marca qué valida, corrige o rechaza; el resto la ve.
// En la pantalla, «Validar» pide quién valida y su PIN; en el móvil vale su propia sesión.

export type Decision = { id: string; action: "validate" | "reject"; qty?: string; note?: string };
type Edit = { action: "validate" | "reject"; boxes?: string; loose?: string; editing?: boolean };

const minutesAgo = (iso: string, now: number) => {
  const m = Math.round((now - new Date(iso).getTime()) / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.floor(h / 24)} d`;
};

export function qtyLabel(row: Pick<MoveRow, "qty" | "input" | "dimension" | "packs">): string {
  return inputText(layoutOf(row.dimension, row.packs), row.input) ?? describeQty(row.qty, row.dimension, row.packs);
}

export function MovesQueue({
  rows,
  now,
  canDecide,
  busy,
  onDecide,
  onUndo,
}: {
  rows: MoveRow[];
  /** Hora de referencia (la página la actualiza): «hace 5 min», deshacer durante 2 minutos. */
  now: number;
  /** Quien mira puede validar (o es la pantalla, que pedirá PIN). */
  canDecide: boolean;
  busy: boolean;
  onDecide: (decisions: Decision[], summary: string) => void;
  onUndo: (row: MoveRow) => void;
}) {
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const editOf = (id: string): Edit => edits[id] ?? { action: "validate" };
  const patch = (id: string, p: Partial<Edit>) => setEdits((e) => ({ ...e, [id]: { ...editOf(id), ...p } }));

  const decisions = useMemo(() => {
    const out: Array<Decision | null> = rows.map((r) => {
      const e = editOf(r.id);
      if (e.action === "reject") return { id: r.id, action: "reject" };
      if (e.boxes !== undefined || e.loose !== undefined) {
        const qty = qtyFromInput(r.dimension, r.packs, e.boxes ?? "", e.loose ?? "");
        return qty ? { id: r.id, action: "validate", qty: qty.toString() } : null;
      }
      return { id: r.id, action: "validate" };
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, edits]);
  const invalid = decisions.some((d) => d === null);
  const toValidate = decisions.filter((d) => d?.action === "validate").length;
  const toReject = decisions.filter((d) => d?.action === "reject").length;
  const summary = [toValidate ? `${toValidate} ${toValidate === 1 ? "salida" : "salidas"} a validar` : "", toReject ? `${toReject} rechazada${toReject === 1 ? "" : "s"}` : ""]
    .filter(Boolean)
    .join(" · ");

  if (rows.length === 0) {
    return (
      <div className="wh-empty">
        <Check size={26} />
        <strong>No hay nada pendiente</strong>
        <span>Todo lo que ha salido del almacén está validado.</span>
      </div>
    );
  }

  return (
    <div className="wh-queue">
      {rows.map((r) => {
        const e = editOf(r.id);
        const layout = layoutOf(r.dimension, r.packs);
        const undoable = r.mine && now - new Date(r.created_at).getTime() < 2 * 60_000;
        return (
          <article key={r.id} className={`wh-move ${e.action === "reject" ? "rejected" : ""}`}>
            <div className="wh-move-main">
              <strong>{r.product_name}</strong>
              <span className="wh-move-qty">{qtyLabel(r)}</span>
              <span className="wh-move-route">
                {r.kind === "devolucion" && <RotateCcw size={13} />} {r.from_area} <ArrowRight size={13} /> {r.to_area}
              </span>
              <small>{r.created_by_name} · {minutesAgo(r.created_at, now)}{r.note ? ` · «${r.note}»` : ""}</small>
              {e.editing && (
                <div className="wh-move-edit">
                  {layout.box && (
                    <label>
                      {layout.box.name}
                      <input inputMode="numeric" value={e.boxes ?? ""} onChange={(ev) => patch(r.id, { boxes: ev.target.value })} placeholder="0" aria-label={`Cajas de ${r.product_name}`} />
                    </label>
                  )}
                  <label>
                    {layout.unit.plural}
                    <input inputMode="decimal" value={e.loose ?? ""} onChange={(ev) => patch(r.id, { loose: ev.target.value })} placeholder="0" aria-label={`Sueltas de ${r.product_name}`} />
                  </label>
                  {decisions.find((d) => d?.id === r.id) === undefined && <span className="wh-error">Revisa la cantidad</span>}
                </div>
              )}
            </div>
            <div className="wh-move-actions">
              {undoable && (
                <button className="wh-chip-button" onClick={() => onUndo(r)} disabled={busy}><Undo2 size={15} /> Deshacer</button>
              )}
              {canDecide && (
                <>
                  <button
                    className={`wh-chip-button ${e.editing ? "active" : ""}`}
                    onClick={() => patch(r.id, e.editing ? { editing: false, boxes: undefined, loose: undefined } : { editing: true, action: "validate" })}
                    aria-label={`Corregir ${r.product_name}`}
                  >
                    <Pencil size={14} /> {e.editing ? "Sin corregir" : "Corregir"}
                  </button>
                  <button
                    className={`wh-chip-button danger ${e.action === "reject" ? "active" : ""}`}
                    onClick={() => patch(r.id, { action: e.action === "reject" ? "validate" : "reject", editing: false })}
                    aria-label={`Rechazar ${r.product_name}`}
                  >
                    <X size={14} /> {e.action === "reject" ? "Rechazada" : "Rechazar"}
                  </button>
                </>
              )}
            </div>
          </article>
        );
      })}
      {canDecide && (
        <div className="wh-queue-footer">
          <span>{invalid ? "Hay una cantidad corregida que no es válida." : summary}</span>
          <button
            className="wh-primary"
            disabled={busy || invalid || (toValidate === 0 && toReject === 0)}
            onClick={() => onDecide(decisions.filter((d): d is Decision => d !== null), summary)}
          >
            <Check size={18} /> Validar
          </button>
        </div>
      )}
    </div>
  );
}
