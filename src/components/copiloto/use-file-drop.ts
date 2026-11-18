"use client";

// Archivos arrastrados encima del panel o pegados en el cuadro de texto (Ctrl+V de una captura). Lo
// que llega se entrega igual que si se hubiera elegido con el botón de la cámara.
import { useRef, useState, type ClipboardEvent, type DragEvent } from "react";

export type FileKind = "imagen" | "pdf" | "hoja" | "otro";

export function fileKind(file: File): FileKind {
  const name = file.name.toLowerCase();
  if (file.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/.test(name)) return "imagen";
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (/\.(xlsx?|csv|ods|tsv)$/.test(name) || /spreadsheet|excel|csv/.test(file.type)) return "hoja";
  return "otro";
}

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

/** `onFiles`: varios a la vez (las páginas de una factura en fotos); un archivo suelto llega como lista de uno. */
export function useFileDrop(onFiles: (files: File[]) => void, enabled: boolean) {
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave saltan en cada hijo: se cuentan para saber cuándo se sale de verdad del panel.
  const depth = useRef(0);

  const dropHandlers = {
    onDragEnter(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    onDragOver(event: DragEvent) {
      if (!hasFiles(event)) return;
      // Sin esto el navegador abre el archivo en la pestaña en vez de soltarlo aquí.
      event.preventDefault();
      event.dataTransfer.dropEffect = enabled ? "copy" : "none";
    },
    onDragLeave(event: DragEvent) {
      if (!hasFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    onDrop(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      const files = Array.from(event.dataTransfer.files);
      if (files.length && enabled) onFiles(files);
    },
  };

  function onPaste(event: ClipboardEvent) {
    const file = Array.from(event.clipboardData?.files ?? []).find((f) => fileKind(f) === "imagen");
    if (!file || !enabled) return;
    event.preventDefault();
    onFiles([file]);
  }

  return { dragging, dropHandlers, onPaste };
}
