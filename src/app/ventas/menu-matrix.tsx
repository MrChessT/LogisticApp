"use client";

import { euros } from "@/lib/format";
import { MENU_CLASS, menuEngineering, type MenuClass } from "@/lib/menu-engineering";
import type { SalesItemRow } from "./sales-link-editor";

// Ingeniería de menú con lo vendido en el periodo: qué platos mantener, revisar, promocionar o quitar.

const ORDER: MenuClass[] = ["estrella", "puzle", "caballo", "perro"];
const pctText = (v: number) => `${(v * 100).toLocaleString("es-ES", { maximumFractionDigits: 1 })} %`;

export function MenuMatrix({ items, days }: { items: SalesItemRow[]; days: number }) {
  const platos = items.filter((i) => i.link === "receta");
  const analysis = menuEngineering(platos.map((i) => ({ id: i.id, name: i.linkName ?? i.name, qty: i.qty, amount: i.amount, cost: i.cost })));
  if (analysis.rows.length === 0) {
    return (
      <div className="catalog-empty">
        <strong>Aún no hay platos con coste para comparar</strong>
        <span>Enlaza los artículos del TPV a sus escandallos (y que los ingredientes tengan precio) para ver qué platos funcionan.</span>
      </div>
    );
  }
  const byClass = (c: MenuClass) => analysis.rows.filter((r) => r.cls === c);
  return (
    <div className="menu-matrix">
      <p className="menu-note">
        {analysis.rows.length} platos con coste · margen medio {euros(analysis.avgMargin)} por ración · popular si supera el {pctText(analysis.popularityThreshold)} de las raciones.
        {days < 7 ? ` Con ${days} ${days === 1 ? "día" : "días"} de ventas es orientativo: gana fiabilidad con más días.` : ""}
        {analysis.skipped > 0 ? ` ${analysis.skipped} ${analysis.skipped === 1 ? "plato vendido no tiene" : "platos vendidos no tienen"} coste y no entran.` : ""}
      </p>
      <div className="menu-quadrants">
        {ORDER.map((c) => {
          const list = byClass(c);
          return (
            <section key={c} className={`menu-quadrant ${c}`}>
              <header><strong>{MENU_CLASS[c].label}</strong><b>{list.length}</b></header>
              <p>{MENU_CLASS[c].advice}</p>
              <ul>{list.slice(0, 6).map((r) => <li key={r.id}>{r.name}</li>)}{list.length > 6 && <li className="more">y {list.length - 6} más</li>}</ul>
            </section>
          );
        })}
      </div>
      <div className="menu-table">
        <div className="menu-row menu-head"><span>Plato</span><span>Raciones</span><span>Mix</span><span>Precio s/IVA</span><span>Coste</span><span>Margen</span><span>Tipo</span></div>
        {analysis.rows.map((r) => (
          <div key={r.id} className="menu-row">
            <span className="menu-name">{r.name}</span>
            <span>{r.qty.toLocaleString("es-ES", { maximumFractionDigits: 1 })}</span>
            <span>{pctText(r.mix)}</span>
            <span>{euros(r.unitPrice)}</span>
            <span>{euros(r.unitCost)}</span>
            <span><b>{euros(r.unitMargin)}</b></span>
            <span><i className={`menu-pill ${r.cls}`}>{MENU_CLASS[r.cls].one}</i></span>
          </div>
        ))}
      </div>
    </div>
  );
}
