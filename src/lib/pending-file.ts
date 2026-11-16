// Archivo que el asistente pasa a otra pantalla sin recargar la página: la foto de un albarán a Nueva
// recepción, el PDF de una factura a Nueva factura. Queda en memoria hasta que esa pantalla lo recoge; si
// ya está abierta, se le avisa con un evento.

export type FileTarget = "recepcion" | "factura";

const EVENT = "logisticapp:archivo-pendiente";
/**
 * El archivo y lo que ya se leyó de él (una foto de albarán: la pantalla no vuelve a leerla) van juntos en una
 * sola entrada: así la lectura de una foto nunca acaba aplicada a otra.
 */
const pending = new Map<FileTarget, { file: File; read: unknown }>();

export function setPendingFile(target: FileTarget, file: File, read?: unknown): void {
  pending.set(target, { file, read: read ?? null });
  window.dispatchEvent(new CustomEvent(EVENT, { detail: target }));
}

/** El archivo pendiente para esa pantalla con su lectura, si la tiene (una sola vez). */
export function takePending<T>(target: FileTarget): { file: File; read: T | null } | null {
  const entry = pending.get(target) ?? null;
  pending.delete(target);
  return entry as { file: File; read: T | null } | null;
}

/** El archivo pendiente para esa pantalla (una sola vez). */
export function takePendingFile(target: FileTarget): File | null {
  return takePending(target)?.file ?? null;
}

/** Avisa cuando llega un archivo para esa pantalla ya abierta. Devuelve la función para dejar de escuchar. */
export function onPendingFile(target: FileTarget, listener: () => void): () => void {
  const handler = (event: Event) => {
    if ((event as CustomEvent<FileTarget>).detail === target) listener();
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
