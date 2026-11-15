"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Crop, X } from "lucide-react";
import { ocrRecorte, type Recuadro } from "@/lib/albaran-ocr";
import type { OcrText } from "@/lib/albaran-reader";
import type { ReceiptLine } from "./receipt-lines";
import type { PickTarget } from "./receipt-pick";
import "./receipt-photo-pick.css";

// Cuando el lector no detecta algo, se señala en la foto: se dibuja un recuadro, se dice qué es y se lee solo esa
// zona. Sirve para el proveedor, el número y la fecha del albarán, una línea entera o el producto de una línea.

const TARGETS: Array<{ id: PickTarget; label: string; help: string }> = [
  { id: "line", label: "Línea nueva", help: "Rodea la línea entera, de la descripción al importe (o varias a la vez)." },
  { id: "product", label: "Producto de una línea", help: "Rodea solo el nombre del producto." },
  { id: "supplier", label: "Proveedor", help: "Rodea el nombre de la empresa que emite el albarán." },
  { id: "number", label: "Nº de albarán", help: "Rodea el número del albarán." },
  { id: "date", label: "Fecha", help: "Rodea la fecha del albarán." },
];

const MIN = 0.015;

export function PhotoPick({ file, lines, apply }: {
  file: File;
  lines: ReceiptLine[];
  apply: (target: PickTarget, texts: OcrText[], lineIndex: number) => Promise<string>;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [target, setTarget] = useState<PickTarget>("line");
  const [lineIndex, setLineIndex] = useState(0);
  const [rect, setRect] = useState<Recuadro | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const start = useRef<{ x: number; y: number } | null>(null);

  // La dirección de la foto se crea al abrir y se libera al cerrar (o al cambiar de foto).
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  function show() {
    setUrl(URL.createObjectURL(file));
    setRect(null);
    setMessage("");
    setOpen(true);
  }
  function hide() {
    setOpen(false);
    setUrl("");
  }

  const point = (e: PointerEvent<HTMLDivElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)) };
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = point(e);
    setRect({ ...start.current, w: 0, h: 0 });
    setMessage("");
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const p = point(e);
    setRect({ x: Math.min(start.current.x, p.x), y: Math.min(start.current.y, p.y), w: Math.abs(p.x - start.current.x), h: Math.abs(p.y - start.current.y) });
  };
  const up = () => { start.current = null; };

  const ready = !!rect && rect.w >= MIN && rect.h >= MIN;
  const help = TARGETS.find((t) => t.id === target)!.help;

  async function read() {
    if (!rect || !ready) return;
    setBusy(true);
    setMessage("");
    try {
      const texts = await ocrRecorte(file, rect);
      setMessage(texts.length === 0 ? "No he leído texto en el recuadro. Ajústalo y prueba otra vez." : await apply(target, texts, lineIndex));
    } catch {
      setMessage("No se pudo leer el recuadro.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="pick-open" onClick={show}><Crop size={14} aria-hidden="true" /> ¿Falta algo? Señálalo en la foto</button>
      {open && (
        <div className="pick-layer" role="dialog" aria-modal="true" aria-label="Señalar en la foto">
          <section className="pick-panel">
            <header>
              <b>Señala en la foto lo que buscas</b>
              <button type="button" onClick={hide} aria-label="Cerrar"><X size={18} /></button>
            </header>
            <div className="pick-targets" role="radiogroup" aria-label="Qué buscas">
              {TARGETS.map((t) => (
                <button key={t.id} type="button" role="radio" aria-checked={target === t.id} className={target === t.id ? "on" : ""} onClick={() => { setTarget(t.id); setMessage(""); }}>{t.label}</button>
              ))}
              {target === "product" && (
                <select value={lineIndex} onChange={(e) => setLineIndex(Number(e.target.value))} aria-label="Línea de la recepción">
                  {lines.map((l, i) => <option key={i} value={i}>{`Línea ${i + 1}: ${l.product?.name ?? l.read?.description ?? "sin producto"}`}</option>)}
                </select>
              )}
            </div>
            <p className="pick-help">{help} Arrastra sobre la foto para dibujar el recuadro.</p>
            <div className="pick-scroll">
              <div className="pick-stage">
                {/* eslint-disable-next-line @next/next/no-img-element -- foto local del albarán, solo en este dispositivo */}
                {url && <img src={url} alt="Foto del albarán" draggable={false} />}
                <div className="pick-overlay" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
                  {rect && <div className="pick-rect" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }} />}
                </div>
              </div>
            </div>
            <footer>
              <p role="status" className="pick-message">{busy ? "Leyendo el recuadro…" : message}</p>
              <button type="button" className="pick-read" disabled={!ready || busy} onClick={() => void read()}>Leer recuadro</button>
              <button type="button" className="pick-done" onClick={hide}>Listo</button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
