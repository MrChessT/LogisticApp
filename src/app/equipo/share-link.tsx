"use client";

import { useState } from "react";
import { Check, Copy, Mail, MessageCircle } from "lucide-react";

/** Enlace de acceso para copiar o enviar (WhatsApp, email). */
export function ShareLink({ link, message, email, onError }: { link: string; message: string; email?: string; onError: (message: string) => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      onError("No se pudo copiar: selecciona el enlace y cópialo a mano.");
    }
  }
  return (
    <>
      <div className="team-link">
        <input readOnly value={link} onFocus={(event) => event.target.select()} aria-label="Enlace de acceso" />
        <button className="catalog-primary" onClick={() => void copy()}>{copied ? <><Check size={15} /> Copiado</> : <><Copy size={15} /> Copiar</>}</button>
      </div>
      <div className="team-share">
        <a className="ghost-button" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer"><MessageCircle size={15} /> Enviar por WhatsApp</a>
        {email && <a className="ghost-button" href={`mailto:${email}?subject=${encodeURIComponent("Tu acceso a LogisticApp")}&body=${encodeURIComponent(message)}`}><Mail size={15} /> Enviar por email</a>}
      </div>
    </>
  );
}
