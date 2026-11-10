"use client";

// Elegir un archivo con un botón propio (en español y con el estilo de la app), no el del navegador
// («Choose File / No file chosen»). En el móvil abre la cámara si `capture`.
import { useId } from "react";
import { Paperclip, X } from "lucide-react";
import "./file-pick.css";

export function FilePick({ file, onChange, accept, capture, label = "Adjuntar foto o PDF" }: {
  file: File | null;
  onChange: (file: File | null) => void;
  accept?: string;
  capture?: "environment" | "user";
  label?: string;
}) {
  const id = useId();
  return (
    <span className="file-pick">
      <label htmlFor={id} className="file-pick-button">
        <Paperclip size={15} aria-hidden="true" />
        <span>{file ? "Cambiar archivo" : label}</span>
      </label>
      <input id={id} type="file" className="file-pick-input" accept={accept} capture={capture} onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
      {file ? (
        <span className="file-pick-name">
          <span title={file.name}>{file.name}</span>
          <button type="button" onClick={() => onChange(null)} aria-label="Quitar archivo"><X size={14} /></button>
        </span>
      ) : (
        <span className="file-pick-empty">Ningún archivo</span>
      )}
    </span>
  );
}
