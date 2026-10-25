// Tipos de salida de stock que no son venta (especificación A, hoja Mermas). Solo «merma» es pérdida: el
// resto son acciones comerciales o consumo interno y no deben inflar las mermas de los informes.
export const EXIT_KINDS = ["merma", "invitacion", "consumo_personal", "degustacion", "evento"] as const;
export type ExitKind = (typeof EXIT_KINDS)[number];

export const EXIT_KIND_LABEL: Record<ExitKind, string> = {
  merma: "Merma",
  invitacion: "Invitación",
  consumo_personal: "Consumo del personal",
  degustacion: "Degustación",
  evento: "Evento",
};

/** Motivos habituales de cada tipo: se sugieren en el formulario, pero se puede escribir otro. */
export const EXIT_KIND_REASONS: Record<ExitKind, string[]> = {
  merma: ["Rotura", "Caducidad", "Derrame", "Error de servicio", "Devolución de cliente", "Espuma de barril"],
  invitacion: ["Cliente habitual", "Compensación por una queja", "Promoción"],
  consumo_personal: ["Comida del personal", "Bebida del personal"],
  degustacion: ["Cata de proveedor", "Prueba de producto"],
  evento: ["Evento privado", "Acción comercial"],
};

export function isExitKind(value: unknown): value is ExitKind {
  return typeof value === "string" && (EXIT_KINDS as readonly string[]).includes(value);
}

/** Una merma sin tipo (anterior a los tipos) es pérdida. */
export function isLoss(kind: ExitKind | null | undefined): boolean {
  return (kind ?? "merma") === "merma";
}
