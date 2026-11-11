// Foto que el asistente pasa a otra pantalla (albarán → Nueva recepción) sin recargar la página:
// queda en memoria hasta que esa pantalla la recoge. Si ya está abierta, se le avisa con un evento.

const EVENT = "logisticapp:foto-pendiente";
let pending: File | null = null;

export function setPendingPhoto(file: File): void {
  pending = file;
  window.dispatchEvent(new Event(EVENT));
}

/** La foto pendiente (una sola vez). */
export function takePendingPhoto(): File | null {
  const file = pending;
  pending = null;
  return file;
}

/** Avisa cuando llega una foto con la pantalla ya abierta. Devuelve la función para dejar de escuchar. */
export function onPendingPhoto(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
