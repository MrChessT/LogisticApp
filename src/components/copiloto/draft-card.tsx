"use client";

// Tarjeta de un borrador (merma, traspaso, recepción, pedido, cambio de precio…): se revisa, se edita
// lo que haga falta y se confirma. Nada se guarda hasta pulsar «Confirmar».
import { useState } from "react";
import { AlertTriangle, Check, CircleAlert, CircleCheck, Loader2, ShieldAlert } from "lucide-react";
import Decimal from "decimal.js";
import { decimalText, euros, parseDecimal } from "@/lib/format";
import type { Draft, DraftCheck, ResolvedEvent } from "@/copiloto/contract";
import type { ConfirmResponse } from "@/copiloto/drafts/confirm";
import { hrefFor, newId, ROUTE_LABELS } from "./chat-model";

const DECIMAL = /^\d+([.,]\d+)?$/;
/** Ediciones numéricas: se normalizan a "12.5". El resto (nombre, medida) va tal cual. */
const NUMERIC_PATH = /^(qtyBase|newPrice|price|packQtyBase|newValue|lines\.\d+\.(packPrice|qtyBase|packsQty)|orders\.\d+\.lines\.\d+\.packsQty)$/;

const DIMENSION_LABEL = { volume: "Volumen (ml)", mass: "Peso (g)", count: "Unidades" } as const;

/** Cantidad tal como se escribió: «2 × Botella 70 cl», «6 ud». */
function inputText(input: { amount: string; unit: string; packId?: string }): string {
  return input.packId ? `${decimalText(input.amount, 4)} × ${input.unit}` : `${decimalText(input.amount, 4)} ${input.unit}`;
}

/** Ediciones en el formato escrito (botellas, cajas…) → unidad base, con el mismo factor del borrador. */
function toBaseEdit(text: string, base: string, amount: string): string {
  const value = parseDecimal(text);
  return value ? value.mul(new Decimal(base).div(amount)).toString() : text;
}

export function DraftCard({ draft, resolved }: { draft: Draft; resolved?: ResolvedEvent }) {
  const [edits, setEdits] = useState<Record<string, string | boolean>>({});
  const [key, setKey] = useState(() => newId());
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [result, setResult] = useState<ConfirmResponse | null>(null);
  const [invalid, setInvalid] = useState("");

  function edit(path: string, value: string | boolean) {
    setEdits((prev) => ({ ...prev, [path]: value }));
  }

  async function confirm() {
    const normalized: Record<string, string | boolean> = {};
    for (const [path, value] of Object.entries(edits)) {
      if (typeof value === "string" && NUMERIC_PATH.test(path)) {
        const clean = value.trim().replace(",", ".");
        if (!DECIMAL.test(clean)) {
          setInvalid("Revisa las cifras: usa números como 12,50.");
          return;
        }
        normalized[path] = clean;
      } else normalized[path] = typeof value === "string" ? value.trim() : value;
    }
    setInvalid("");
    setState("sending");
    try {
      const res = await fetch("/api/copiloto/actions/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: draft.draftId, idempotencyKey: key, edits: normalized }),
      });
      const data = (await res.json()) as ConfirmResponse;
      setResult(data);
      setState(data.ok ? "done" : "idle");
      // Tras un fallo, un nuevo clic es un intento nuevo.
      if (!data.ok) setKey(newId());
    } catch {
      setResult({ ok: false, code: "internal", message: "No se ha podido confirmar. Inténtalo de nuevo." });
      setState("idle");
      setKey(newId());
    }
  }

  const locked = state !== "idle" || !!resolved;
  const needsAck = draft.checks?.some((c) => c.status === "revisar") ?? false;
  const acknowledged = edits.acknowledged === true;

  return (
    <div className={`copiloto-draft${needsAck ? " needs-review" : ""}`}>
      <strong>{draft.title}</strong>
      {draft.checks && draft.checks.length > 0 && <Checks checks={draft.checks} />}
      {draft.warnings.map((warning) => (
        <p key={warning} className="copiloto-warning"><AlertTriangle size={13} /> {warning}</p>
      ))}

      {draft.kind === "precio" && (
        <>
          <p className="copiloto-detail">
            {draft.packName} · {draft.supplierName}
            <br />
            Antes: <b>{draft.oldPrice === null ? "—" : euros(draft.oldPrice)}</b> · coste unitario nuevo: {draft.unitCost}
          </p>
          <label className="copiloto-field">
            Precio nuevo por {draft.packName} (€)
            <input defaultValue={draft.newPrice.replace(".", ",")} disabled={locked} inputMode="decimal" onChange={(event) => edit("newPrice", event.target.value)} />
          </label>
        </>
      )}

      {draft.kind === "producto_nuevo" && (
        <>
          <label className="copiloto-field">
            Nombre
            <input defaultValue={draft.name} disabled={locked} maxLength={80} onChange={(event) => edit("name", event.target.value)} />
          </label>
          <div className="copiloto-row">
            <label className="copiloto-field">
              Cómo se mide
              <select defaultValue={draft.dimension} disabled={locked} onChange={(event) => edit("dimension", event.target.value)}>
                {(Object.keys(DIMENSION_LABEL) as Array<keyof typeof DIMENSION_LABEL>).map((d) => (
                  <option key={d} value={d}>{DIMENSION_LABEL[d]}</option>
                ))}
              </select>
            </label>
            {draft.price !== null && (
              <label className="copiloto-field">
                Precio (€)
                <input defaultValue={draft.price.replace(".", ",")} disabled={locked} inputMode="decimal" onChange={(event) => edit("price", event.target.value)} />
              </label>
            )}
          </div>
          <p className="copiloto-detail">
            Categoría: <b>{draft.categoryName ?? "sin categoría"}</b>
            {draft.packName && <> · Formato: <b>{draft.packName}</b></>}
            {draft.supplierName && <> · Proveedor: <b>{draft.supplierName}</b></>}
            {draft.locationNames.length > 0 && <> · Activo en: <b>{draft.locationNames.join(", ")}</b></>}
          </p>
        </>
      )}

      {draft.kind === "minimo" && (
        <label className="copiloto-field">
          {draft.field === "min_qty" ? "Mínimo" : "Objetivo"} en {draft.locationName} ({draft.input?.unit ?? draft.baseUnit}) · antes:{" "}
          {draft.oldValue === null ? "sin definir" : draft.input ? decimalText(new Decimal(draft.oldValue).div(new Decimal(draft.newValue).div(draft.input.amount)), 2) : draft.oldValue}
          <input
            defaultValue={draft.input ? decimalText(draft.input.amount, 4) : draft.newValue}
            disabled={locked}
            inputMode="decimal"
            onChange={(event) => edit("newValue", draft.input ? toBaseEdit(event.target.value, draft.newValue, draft.input.amount) : event.target.value)}
          />
        </label>
      )}

      {draft.kind === "pedido" &&
        draft.orders.map((order, o) => (
          <div className="copiloto-order" key={order.supplierName}>
            <p className="copiloto-order-supplier">{order.supplierName}</p>
            {order.lines.map((line, l) => (
              <label className="copiloto-order-line" key={`${line.productName}-${line.packName}`}>
                <span>
                  <b>{line.productName}</b>
                  <small>{line.packName}{line.packPrice ? ` · ${euros(line.packPrice)}` : ""} · {line.note}</small>
                </span>
                <input
                  defaultValue={line.packsQty}
                  disabled={locked}
                  inputMode="decimal"
                  aria-label={`Cantidad de ${line.productName}`}
                  onChange={(event) => edit(`orders.${o}.lines.${l}.packsQty`, event.target.value)}
                />
              </label>
            ))}
          </div>
        ))}
      {draft.kind === "pedido" && <p className="copiloto-detail">Se guardan como borrador en Pedidos (pon 0 para quitar una línea). Enviarlos al proveedor lo decides allí.</p>}

      {draft.kind === "conteo" && draft.operation === "anotar" && (
        <ul className="copiloto-lines">
          {draft.lines.map((line) => (
            <li key={line.productName}>{line.productName}: {line.text}</li>
          ))}
        </ul>
      )}

      {draft.kind === "documento" && (
        <>
          <p className="copiloto-detail">{draft.summary}</p>
          {draft.lines.length > 0 && (
            <ul className="copiloto-lines">
              {draft.lines.map((line, i) => (
                <li key={`${line.label}-${i}`}>{line.label}: {line.qty}</li>
              ))}
            </ul>
          )}
        </>
      )}

      {draft.kind === "archivar" && (
        <p className="copiloto-detail">Dejará de aparecer en recepciones, traspasos, mermas e inventarios. Conserva su historial y puedes restaurarlo desde su ficha.</p>
      )}

      {draft.kind === "merma" && draft.editable.includes("qtyBase") && (
        <label className="copiloto-field">
          Cantidad ({draft.input.unit})
          <input
            defaultValue={decimalText(draft.input.amount, 4)}
            disabled={locked}
            inputMode="decimal"
            onChange={(event) => edit("qtyBase", toBaseEdit(event.target.value, draft.qtyBase, draft.input.amount))}
          />
        </label>
      )}

      {draft.kind === "traspaso" && (
        <>
          <ul className="copiloto-lines">
            {draft.lines.map((line) => (
              <li key={line.productName}>{line.productName}: {inputText(line.input)}</li>
            ))}
          </ul>
          {draft.send && (
            <label className="copiloto-check">
              <input type="checkbox" defaultChecked disabled={locked} onChange={(event) => edit("send", event.target.checked)} /> Enviar ahora (si no, queda en borrador)
            </label>
          )}
        </>
      )}

      {draft.kind === "recepcion" &&
        draft.lines.map((line, index) => (
          <label key={`${line.packName}-${line.productName}`} className="copiloto-field">
            {line.packsQty} × {line.packName} · precio por formato (€)
            <input
              defaultValue={line.packPrice ?? ""}
              placeholder="Precio"
              disabled={locked}
              inputMode="decimal"
              onChange={(event) => edit(`lines.${index}.packPrice`, event.target.value)}
            />
          </label>
        ))}

      {draft.kind === "cierre_inventario" && (
        <>
          <ul className="copiloto-lines">
            {draft.preview.adjustments.map((a) => (
              <li key={a.productName}>
                {a.productName}: {a.expectedText ?? `${a.expected} ${a.baseUnit}`} → {a.countedText ?? `${a.counted} ${a.baseUnit}`} ({euros(a.diffValue)})
              </li>
            ))}
          </ul>
          <label className="copiloto-check">
            <input type="checkbox" disabled={locked} onChange={(event) => edit("zeroUncounted", event.target.checked)} /> Poner a cero lo no contado
          </label>
          <label className="copiloto-check">
            <input type="checkbox" defaultChecked={draft.asConsumption} disabled={locked} onChange={(event) => edit("asConsumption", event.target.checked)} /> Lo que falta es consumo (no un ajuste)
          </label>
        </>
      )}

      {needsAck && state !== "done" && (
        <label className="copiloto-check copiloto-ack">
          <input type="checkbox" checked={acknowledged} disabled={locked} onChange={(event) => edit("acknowledged", event.target.checked)} /> He revisado los avisos marcados
        </label>
      )}

      <div className="copiloto-draft-actions">
        <span />
        {resolved ? (
          <span className={resolved.status === "confirmado" ? "copiloto-ok" : "copiloto-muted"}>
            {resolved.status === "confirmado" ? <><Check size={14} /> Confirmado desde el chat</> : "Descartado"}
          </span>
        ) : state === "done" ? (
          <span className="copiloto-ok"><Check size={14} /> Hecho</span>
        ) : (
          <button type="button" className="primary-button" disabled={!draft.canConfirm || locked || (needsAck && !acknowledged)} onClick={() => void confirm()}>
            {state === "sending" ? <Loader2 size={14} className="copiloto-spin" /> : <Check size={14} />}
            {draft.canConfirm ? "Confirmar" : "Requiere encargado"}
          </button>
        )}
      </div>
      {invalid && <p className="copiloto-error">{invalid}</p>}
      {result && (
        <p className={result.ok ? "copiloto-ok" : "copiloto-error"}>
          {result.message}{" "}
          {result.ok && result.navigate && <a href={hrefFor(result.navigate)}>Ver en {ROUTE_LABELS[result.navigate.route]}</a>}
        </p>
      )}
    </div>
  );
}

const CHECK_ICON = { ok: CircleCheck, aviso: CircleAlert, revisar: ShieldAlert } as const;

/** Comprobaciones del borrador: qué ha verificado el asistente y con qué resultado. */
function Checks({ checks }: { checks: DraftCheck[] }) {
  return (
    <ul className="copiloto-checks" aria-label="Comprobaciones">
      {checks.map((c) => {
        const Icon = CHECK_ICON[c.status];
        return (
          <li key={c.id} className={c.status}>
            <Icon size={14} />
            <span>
              <b>{c.label}:</b> {c.detail}
            </span>
            {c.probability !== null && <small title="Seguridad de Jev">{Math.round(c.probability * 100)} %</small>}
          </li>
        );
      })}
    </ul>
  );
}
