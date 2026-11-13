// Archivo que el asistente pasa a otra pantalla sin recargar la página: la foto de un albarán a Nueva
// recepción, el PDF de una factura a Nueva factura. Queda en memoria hasta que esa pantalla lo recoge; si
// ya está abierta, se le avisa con un evento.

export type FileTarget = "recepcion" | "factura";

const EVENT = "logisticapp:archivo-pendiente";
const pending = new Map<FileTarget, File>();

export function setPendingFile(target: FileTarget, file: File): void {
  pending.set(target, file);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: target }));
}

/** El archivo pendiente para esa pantalla (una sola vez). */
export function takePendingFile(target: FileTarget): File | null {
  const file = pending.get(target) ?? null;
  pending.delete(target);
  return file;
}

/** Avisa cuando llega un archivo para esa pantalla ya abierta. Devuelve la función para dejar de escuchar. */
export function onPendingFile(target: FileTarget, listener: () => void): () => void {
  const handler = (event: Event) => {
    if ((event as CustomEvent<FileTarget>).detail === target) listener();
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
