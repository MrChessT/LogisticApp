"use client";

// Piezas de una respuesta del asistente: lo que ha entendido, la tabla de resultados y el texto con
// algo de estructura (fichas, avisos y listas).
import { useState, type ReactNode } from "react";
import type { Decision, DecisionEvent, TableEvent } from "@/copiloto/contract";

function confidence(d: Decision): string {
  return `${Math.round((d.confidence ?? d.probability) * 100)} %`;
}

const EMPTY_VALUES = new Set(["no_indicado", "ninguno", "ninguna", "no_aplica"]);

/** Lo que el asistente ha entendido, en una línea: «Traspaso · Parador → Vivero · Larios 12 · 3 botellas». */
function understood(ev: DecisionEvent): Array<{ key: string; text: string; doubtful: boolean }> {
  const all = [ev.intent, ...ev.decisions];
  const by = (id: string) => all.find((d) => d.id === id);
  // «Sin indicar», «Ninguno», «No aplica» no dicen nada: fuera.
  const part = (d: Decision | undefined, text?: string) => (d && !EMPTY_VALUES.has(d.value) ? [{ key: d.id, text: text ?? d.valueLabel, doubtful: d.gate !== "actuar" }] : []);
  const what = by("tipo_accion") ?? by("herramienta") ?? ev.intent;
  const from = by("local");
  const to = by("local_destino");
  const places = from && to && !EMPTY_VALUES.has(from.value) && !EMPTY_VALUES.has(to.value) ? [{ key: "locales", text: `${from.valueLabel} → ${to.valueLabel}`, doubtful: from.gate !== "actuar" || to.gate !== "actuar" }] : [...part(from), ...part(to)];
  const products = all.filter((d) => /^producto_\d+$/.test(d.id) || /^cantidad_ok_\d+$/.test(d.id));
  return [...part(what), ...places, ...part(by("espacio")), ...products.flatMap((d) => part(d)), ...part(by("periodo"))];
}

/**
 * «Entendido: …» solo cuando el asistente pregunta (así se ve qué entendió y qué falta). En el resto,
 * la respuesta ya lo dice: queda un «¿Por qué?» discreto con el detalle.
 */
export function Understood({ decision, asking }: { decision: DecisionEvent; asking: boolean }) {
  const [open, setOpen] = useState(false);
  const parts = understood(decision);
  const quiet = decision.intent.value === "conversar" || decision.intent.value === "fuera_de_ambito" || decision.shortcut;
  if (quiet || parts.length === 0) return null;
  return (
    <div className={`copiloto-understood${asking ? "" : " compact"}`}>
      <p>
        {asking && (
          <>
            <span className="copiloto-understood-label">Entendido:</span>{" "}
            {parts.map((p, i) => (
              <span key={p.key}>
                {i > 0 && " · "}
                <span className={p.doubtful ? "dudoso" : undefined} title={p.doubtful ? "No estoy seguro: revísalo" : undefined}>{p.text}</span>
              </span>
            ))}
          </>
        )}
        {!decision.shortcut && (
          <button type="button" className="copiloto-why" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "Ocultar" : "¿Por qué?"}
          </button>
        )}
      </p>
      {open && (
        <div className="copiloto-chips">
          {[decision.intent, ...decision.decisions].map((d) => (
            <span key={d.id} className={`copiloto-chip ${d.gate}`} title={`${d.label}: ${d.valueLabel}`}>
              {d.label}: <b>{d.valueLabel}</b> {confidence(d)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function TableCard({ table }: { table: TableEvent }) {
  const flagged = new Set(table.flagged ?? []);
  // La fila se nombra por su primera columna con texto («#» es solo la posición en un ranking).
  const titleIndex = table.columns[0]?.label === "#" && table.columns.length > 1 ? 1 : 0;
  return (
    // Con más de 3 columnas, en el panel estrecho cada fila se ve como una ficha (CSS: container query).
    <div className={`copiloto-table${table.columns.length > 3 ? " cards" : ""}`}>
      <table>
        <thead>
          <tr>
            {table.columns.map((c) => (
              <th key={c.key} className={c.align === "right" ? "num" : undefined}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i} className={flagged.has(i) ? "flagged" : undefined}>
              {table.columns.map((c, j) => (
                <td key={c.key} className={[c.align === "right" ? "num" : "", j === titleIndex ? "title" : "", j < titleIndex ? "rank" : "", j !== titleIndex && (row[c.key] ?? "").length <= 14 ? "short" : ""].filter(Boolean).join(" ") || undefined} data-label={c.label}>
                  {row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.more ? <p className="copiloto-table-more">…y {table.more} más en la pantalla enlazada.</p> : null}
    </div>
  );
}

/** Datos de ficha («Precio: …», «Stock: …»): se pintan como pares etiqueta–valor. */
const FACT = /^(Precio|Stock|Consumo(?: \d+ días)?|Formatos|Compra|Proveedor(?:es)?|Mínimo|Valor|Categoría):\s+(.+)$/;

/**
 * Texto del asistente con algo de estructura: las líneas «Etiqueta: valor» de una ficha como tabla de
 * datos (con la primera línea de título), los avisos «⚠ …» resaltados y las viñetas como lista.
 */
export function AssistantText({ text }: { text: string }) {
  const lines = text.split("\n");
  if (!lines.some((l) => FACT.test(l) || l.startsWith("⚠ ") || l.startsWith("• "))) return <p className="copiloto-text">{text}</p>;
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]!;
    if (FACT.test(line)) {
      const facts: Array<[string, string]> = [];
      while (i < lines.length && FACT.test(lines[i]!)) {
        const m = FACT.exec(lines[i]!)!;
        facts.push([m[1]!, m[2]!]);
        i += 1;
      }
      blocks.push(
        <dl key={i} className="copiloto-facts">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>,
      );
    } else if (line.startsWith("• ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("• ")) {
        items.push(lines[i]!.slice(2));
        i += 1;
      }
      blocks.push(
        <ul key={i} className="copiloto-bullets">
          {items.map((item, k) => <li key={k}>{item}</li>)}
        </ul>,
      );
    } else {
      // La primera línea encima de una ficha es su título («Bombay Sapphire · Destilados › Ginebra»).
      const heading = i === 0 && FACT.test(lines[1] ?? "");
      blocks.push(
        <p key={i} className={line.startsWith("⚠ ") ? "copiloto-alert" : heading ? "copiloto-heading" : undefined}>
          {line}
        </p>,
      );
      i += 1;
    }
  }
  return <div className="copiloto-text structured">{blocks}</div>;
}

