// Crear un Intl.DateTimeFormat cuesta ~80 µs: con miles de movimientos (informes, consumo) dominaba el
// tiempo de respuesta. Se crea uno por zona horaria y se reutiliza.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timezone, formatter);
  }
  return formatter;
}

export function businessDay(occurredAt: Date, timezone: string, cutoff: string): string {
  const parts = formatterFor(timezone).formatToParts(occurredAt).reduce<Record<string, string>>((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  const localMinutes = Number(parts.hour) * 60 + Number(parts.minute);
  const cutoffParts = cutoff.split(":").map(Number);
  const cutoffHour = cutoffParts[0] ?? 0;
  const cutoffMinute = cutoffParts[1] ?? 0;
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  if (localMinutes < cutoffHour * 60 + cutoffMinute) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * La fecha de hoy en el calendario del negocio (no en UTC): a las 00:30 de Madrid ya es el día siguiente, aunque en
 * UTC siga siendo el anterior. Para las fechas por defecto de albaranes, facturas, pagos e importaciones.
 */
export function civilToday(timezone = "Europe/Madrid", now: Date = new Date()): string {
  return businessDay(now, timezone, "00:00");
}
