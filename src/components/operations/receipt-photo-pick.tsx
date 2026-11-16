"use client";

import { useRef, useState, type PointerEvent } from "react";
import { Crop, Minus, Plus, RotateCcw, X } from "lucide-react";
import { ocrRecorte, type Recuadro } from "@/lib/albaran-ocr";
import { rotarFoto } from "@/lib/foto-girar";
import type { OcrText } from "@/lib/albaran-reader";
import type { ReceiptLine } from "./receipt-lines";
import type { PickTarget } from "./receipt-pick";
import "./receipt-photo-pick.css";

// Cuando el lector no detecta algo, se señala en la foto: se dibuja un recuadro, se dice qué es y se lee solo esa
// zona. Sirve para el proveedor, el número y la fecha del albarán, una línea entera o el producto de una línea.
// Si la foto está torcida se endereza antes (el giro se aplica a la imagen que se dibuja y a la que se lee), y se
// puede ampliar para rodear letras pequeñas.

const TARGETS: Array<{ id: PickTarget; label: string; help: string }> = [
  { id: "line", label: "Línea nueva", help: "Rodea la línea entera, de la descripción al importe (o varias a la vez)." },
  { id: "product", label: "Producto de una línea", help: "Rodea solo el nombre del producto." },
  { id: "supplier", label: "Proveedor", help: "Rodea el nombre de la empresa que emite el albarán." },
  { id: "number", label: "Nº de albarán", help: "Rodea el número del albarán." },
  { id: "date", label: "Fecha", help: "Rodea la fecha del albarán." },
];

const MIN = 0.015;
const ZOOMS = [1, 1.5, 2, 3] as const;
const MAX_TURN = 20;

export function PhotoPick({ file, lines, apply }: {
  file: File;
  lines: ReceiptLine[];
  apply: (target: PickTarget, texts: OcrText[], lineIndex: number) => Promise<string>;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [source, setSource] = useState<Blob>(file);
  const [angle, setAngle] = useState(0);
  const [zoomIndex, setZoomIndex] = useState(0);
  const [turning, setTurning] = useState(false);
  const [target, setTarget] = useState<PickTarget>("line");
  const [lineIndex, setLineIndex] = useState(0);
  const [rect, setRect] = useState<Recuadro | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const start = useRef<{ x: number; y: number } | null>(null);
  const urlRef = useRef("");
  const turnId = useRef(0);

  // La dirección de la foto que se muestra se crea al cambiarla y se libera al cambiar o al cerrar.
  function showing(blob: Blob) {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = URL.createObjectURL(blob);
    setUrl(urlRef.current);
    setSource(blob);
  }
  function show() {
    showing(file);
    setAngle(0);
    setZoomIndex(0);
    setRect(null);
    setMessage("");
    setOpen(true);
  }
  function hide() {
    setOpen(false);
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = "";
    setUrl("");
  }

  // Girar siempre parte de la foto original (no se acumulan giros). Si llega otro giro mientras se gira, gana el último.
  async function turn(grados: number) {
    const id = ++turnId.current;
    setAngle(grados);
    setRect(null);
    setMessage("");
    setTurning(true);
    try {
      const blob = grados === 0 ? file : await rotarFoto(file, grados);
      if (id === turnId.current) showing(blob);
    } catch {
      if (id === turnId.current) setMessage("No se pudo girar la foto.");
    } finally {
      if (id === turnId.current) setTurning(false);
    }
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
  const zoom = ZOOMS[zoomIndex]!;

  async function read() {
    if (!rect || !ready) return;
    setBusy(true);
    setMessage("");
    try {
      const texts = await ocrRecorte(source, rect);
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
            <div className="pick-tools">
              <label className="pick-turn">
                <span>Enderezar {angle > 0 ? `+${angle}` : angle}°</span>
                <input type="range" min={-MAX_TURN} max={MAX_TURN} step={0.5} value={angle} disabled={turning}
                  onChange={(e) => void turn(Number(e.target.value))} aria-label="Girar la foto" />
              </label>
              <button type="button" onClick={() => void turn(0)} disabled={angle === 0 || turning} className="pick-tool"><RotateCcw size={14} aria-hidden="true" /> Sin girar</button>
              <div className="pick-zoom" role="group" aria-label="Zoom">
                <button type="button" className="pick-tool" onClick={() => setZoomIndex((i) => Math.max(0, i - 1))} disabled={zoomIndex === 0} aria-label="Alejar"><Minus size={14} aria-hidden="true" /></button>
                <button type="button" className="pick-tool" onClick={() => setZoomIndex(0)} disabled={zoomIndex === 0}>{Math.round(zoom * 100)}%</button>
                <button type="button" className="pick-tool" onClick={() => setZoomIndex((i) => Math.min(ZOOMS.length - 1, i + 1))} disabled={zoomIndex === ZOOMS.length - 1} aria-label="Acercar"><Plus size={14} aria-hidden="true" /></button>
              </div>
            </div>
            <p className="pick-help">{help} Arrastra sobre la foto para dibujar el recuadro.</p>
            <div className="pick-scroll">
              <div className="pick-stage">
                {/* eslint-disable-next-line @next/next/no-img-element -- foto local del albarán, solo en este dispositivo */}
                {url && <img src={url} alt="Foto del albarán" draggable={false} className={zoom > 1 ? "zoomed" : ""} style={zoom > 1 ? { width: `${zoom * 100}%` } : undefined} />}
                <div className="pick-overlay" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
                  {rect && <div className="pick-rect" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }} />}
                </div>
              </div>
            </div>
            <footer>
              <p role="status" className="pick-message">{busy ? "Leyendo el recuadro…" : turning ? "Girando la foto…" : message}</p>
              <button type="button" className="pick-read" disabled={!ready || busy || turning} onClick={() => void read()}>Leer recuadro</button>
              <button type="button" className="pick-done" onClick={hide}>Listo</button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
