"use client";

import { useEffect, useState } from "react";
import { Delete, ShieldCheck, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Validar en la pantalla del almacén: quién valida (solo quien puede y tiene PIN) y su PIN de 6 cifras.
// El PIN lo comprueba la base de datos (area_moves_decide); 5 fallos bloquean a esa persona 15 minutos.

type Validator = { user_id: string; name: string };
type Result = { ok: boolean; error?: string; attempts_left?: number; locked_until?: string; validated?: number; rejected?: number };

export function PinDialog({
  summary,
  onConfirm,
  onClose,
}: {
  summary: string;
  /** Envía las decisiones con ese validador y PIN; devuelve la respuesta de la base de datos. */
  onConfirm: (validatorId: string, pin: string) => Promise<Result>;
  onClose: () => void;
}) {
  const [validators, setValidators] = useState<Validator[] | null>(null);
  const [who, setWho] = useState<Validator | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data, error: err } = (await createClient()?.rpc("kiosk_validators")) ?? { data: null, error: null };
      if (cancelled) return;
      if (err) setError("No se pudo cargar quién puede validar.");
      setValidators((data ?? []) as unknown as Validator[]);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(full: string) {
    if (!who) return;
    setBusy(true);
    setError("");
    const result = await onConfirm(who.user_id, full);
    setBusy(false);
    if (result.ok) return;
    setPin("");
    if (result.error === "locked") {
      const until = result.locked_until ? new Date(result.locked_until).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "dentro de un rato";
      setError(`Demasiados intentos: ${who.name} queda bloqueado hasta las ${until}.`);
    } else if (result.error === "pin") {
      setError(`PIN incorrecto. ${result.attempts_left === 1 ? "Queda 1 intento" : `Quedan ${result.attempts_left} intentos`}.`);
    } else if (result.error === "no_pin") {
      setError(`${who.name} todavía no tiene PIN: se lo pone en «Tu cuenta».`);
    } else {
      setError("No se pudo validar. Inténtalo de nuevo.");
    }
  }

  function press(digit: string) {
    if (busy || pin.length >= 6) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === 6) void submit(next);
  }

  return (
    <div className="wh-modal-layer" onClick={() => !busy && onClose()}>
      <section className="wh-modal wh-pin" role="dialog" aria-modal="true" aria-label="Validar salidas" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p className="wh-eyebrow"><ShieldCheck size={15} /> Validar</p>
            <h2>{who ? `PIN de ${who.name}` : "¿Quién valida?"}</h2>
            <p className="wh-muted">{summary}</p>
          </div>
          <button className="wh-icon-button" onClick={onClose} aria-label="Cerrar" disabled={busy}><X size={20} /></button>
        </header>

        {!who ? (
          <div className="wh-validators">
            {validators === null && <p className="wh-muted">Cargando…</p>}
            {validators?.length === 0 && (
              <p className="wh-muted">
                Nadie de este local tiene PIN todavía. Los encargados (y el personal autorizado) se lo ponen en «Tu cuenta» desde su móvil.
              </p>
            )}
            {validators?.map((v) => (
              <button key={v.user_id} className="wh-validator" onClick={() => setWho(v)}>
                <span>{v.name.slice(0, 1).toUpperCase()}</span>
                {v.name}
              </button>
            ))}
          </div>
        ) : (
          <div className="wh-pinpad">
            <div className="wh-pin-dots" aria-label={`${pin.length} de 6 cifras`}>
              {Array.from({ length: 6 }, (_, i) => <i key={i} className={i < pin.length ? "on" : ""} />)}
            </div>
            <div className="wh-keys">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <button key={d} onClick={() => press(d)} disabled={busy}>{d}</button>
              ))}
              <button className="wh-key-quiet" onClick={() => { setWho(null); setPin(""); setError(""); }} disabled={busy}>Otra persona</button>
              <button onClick={() => press("0")} disabled={busy}>0</button>
              <button className="wh-key-quiet" onClick={() => setPin((p) => p.slice(0, -1))} disabled={busy} aria-label="Borrar"><Delete size={22} /></button>
            </div>
          </div>
        )}
        {busy && <p className="wh-muted wh-center">Validando…</p>}
        {error && <p className="wh-error">{error}</p>}
      </section>
    </div>
  );
}
