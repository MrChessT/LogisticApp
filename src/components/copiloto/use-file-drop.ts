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

/** Qué hacer con un archivo que no es una foto (el panel solo lee fotos de albaranes). */
export function otherFileReply(file: File, kind: Exclude<FileKind, "imagen">): string {
  const name = file.name || "el archivo";
  if (kind === "pdf") {
    return `«${name}» es un PDF. Aquí leo fotos de albaranes; si es una factura, se registra en Gestión › Facturas («Registrar factura»), donde se adjunta el PDF y se cuadra con sus albaranes. Si es un albarán, hazle una foto o una captura y arrástrala aquí.`;
  }
  if (kind === "hoja") {
    return `«${name}» es una hoja de cálculo. Productos, ventas del TPV y escandallos se cargan desde Gestión › Importar, que revisa cada fila antes de guardar nada.`;
  }
  return `No sé leer «${name}». Arrástrame una foto o captura de un albarán (JPG, PNG o HEIC) y te digo qué llega.`;
}

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

export function useFileDrop(onFile: (file: File) => void, enabled: boolean) {
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
      const file = event.dataTransfer.files[0];
      if (file && enabled) onFile(file);
    },
  };

  function onPaste(event: ClipboardEvent) {
    const file = Array.from(event.clipboardData?.files ?? []).find((f) => fileKind(f) === "imagen");
    if (!file || !enabled) return;
    event.preventDefault();
    onFile(file);
  }

  return { dragging, dropHandlers, onPaste };
}
