import type { Periodo } from "../jev/catalog";
import { normalize } from "../entities/normalize";
import type { Period } from "./types";

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekday(day: string): number {
  // 0 = domingo … 6 = sábado
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** Días de un periodo contando los dos extremos (del 1 al 3 → 3). */
export function daysInclusive(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000) + 1;
}

export function formatDay(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}

/** Fechas explícitas del mensaje: "12/09", "12/09/2026", "del 1 al 15". */
export function extractDates(message: string, today: string): string[] {
  const year = today.slice(0, 4);
  const found: string[] = [];
  for (const match of message.matchAll(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/g)) {
    const d = match[1]!.padStart(2, "0");
    const m = match[2]!.padStart(2, "0");
    const y = match[3] ? (match[3].length === 2 ? `20${match[3]}` : match[3]) : year;
    found.push(`${y}-${m}-${d}`);
  }
  if (found.length === 0) {
    const range = /\bdel\s+(\d{1,2})\s+al\s+(\d{1,2})\b/i.exec(message);
    if (range) {
      const ym = today.slice(0, 7);
      found.push(`${ym}-${range[1]!.padStart(2, "0")}`, `${ym}-${range[2]!.padStart(2, "0")}`);
    }
  }
  return found.filter((day) => !Number.isNaN(new Date(`${day}T00:00:00Z`).getTime())).sort();
}

export const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function mondayOf(day: string): string {
  let d = day;
  while (weekday(d) !== 1) d = addDays(d, -1);
  return d;
}

export function lastDayOfMonth(firstDay: string): string {
  const [y, m] = firstDay.split("-").map(Number);
  const next = m === 12 ? `${y! + 1}-01-01` : `${y}-${String(m! + 1).padStart(2, "0")}-01`;
  return addDays(next, -1);
}

/**
 * Periodo natural dicho en el mensaje (hacia atrás): «hoy», «ayer», «esta semana» (desde el lunes), «la semana
 * pasada», «este mes» (desde el día 1), «el mes pasado», «este año», «en octubre», «los últimos 15 días».
 * null si no dice ninguno.
 */
export function calendarPeriod(message: string, today: string): Period | null {
  const t = normalize(message);
  // «este mes hasta hoy» es el mes: «hoy» solo cuenta si no cierra otro periodo.
  if (/\bhoy\b/.test(t) && !/\bhasta hoy\b/.test(t)) return { from: today, to: today, label: "hoy" };
  if (/\bayer\b/.test(t)) {
    const y = addDays(today, -1);
    return { from: y, to: y, label: "ayer" };
  }
  const last = /\bultim[oa]s?\s+(\d{1,3})\s+dias\b/.exec(t);
  if (last) {
    const n = Math.max(1, Math.min(366, Number(last[1])));
    return { from: addDays(today, -(n - 1)), to: today, label: `los últimos ${n} días` };
  }
  if (/\bsemana\s+(pasada|anterior)\b/.test(t)) {
    const monday = addDays(mondayOf(today), -7);
    const sunday = addDays(monday, 6);
    return { from: monday, to: sunday, label: `la semana pasada, del ${formatDay(monday)} al ${formatDay(sunday)}` };
  }
  if (/\besta\s+semana\b/.test(t)) return { from: mondayOf(today), to: today, label: "esta semana" };
  const first = `${today.slice(0, 8)}01`;
  if (/\bmes\s+(pasado|anterior)\b/.test(t)) {
    const to = addDays(first, -1);
    const from = `${to.slice(0, 8)}01`;
    return { from, to, label: `el mes pasado, del ${formatDay(from)} al ${formatDay(to)}` };
  }
  if (/\beste\s+mes\b|\bmes\s+actual\b|\ben\s+lo\s+que\s+va\s+de\s+mes\b/.test(t)) return { from: first, to: today, label: "este mes" };
  if (/\beste\s+ano\b|\ben\s+lo\s+que\s+va\s+de\s+ano\b/.test(t)) return { from: `${today.slice(0, 4)}-01-01`, to: today, label: `este año` };
  const month = MONTHS.findIndex((m) => new RegExp(`\\b(en|de|del mes de|durante)\\s+${m}\\b`).test(t));
  if (month >= 0) {
    // Un mes que aún no ha llegado este año es el del año pasado («en diciembre» dicho en marzo).
    const year = month + 1 > Number(today.slice(5, 7)) ? Number(today.slice(0, 4)) - 1 : Number(today.slice(0, 4));
    const from = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const end = lastDayOfMonth(from);
    return { from, to: end < today ? end : today, label: `en ${MONTHS[month]}${year === Number(today.slice(0, 4)) ? "" : ` de ${year}`}` };
  }
  return null;
}

/** Ventana hacia atrás, para movimientos, precios o desvíos. */
export function pastPeriod(periodo: Periodo, today: string, message: string, fallback: "semana" | "mes"): Period {
  // «este mes», «esta semana», «en octubre»: el periodo natural que se dice, no los últimos 30 o 7 días.
  const named = periodo === "mes" || periodo === "semana" || periodo === "personalizado" ? calendarPeriod(message, today) : null;
  if (named && named.from !== named.to) return named;
  switch (periodo) {
    case "hoy":
      return { from: today, to: today, label: "hoy" };
    case "ayer": {
      const y = addDays(today, -1);
      return { from: y, to: y, label: "ayer" };
    }
    // «la semana pasada», «el mes pasado» (la anterior entera) y «este mes» ya los ha resuelto calendarPeriod.
    case "semana":
      return { from: addDays(today, -6), to: today, label: "los últimos 7 días" };
    case "mes":
      return { from: addDays(today, -29), to: today, label: "los últimos 30 días" };
    case "fin_de_semana": {
      // Último viernes a domingo ya empezado.
      let friday = today;
      while (weekday(friday) !== 5) friday = addDays(friday, -1);
      const sunday = addDays(friday, 2);
      return { from: friday, to: sunday < today ? sunday : today, label: "el fin de semana" };
    }
    case "personalizado": {
      const dates = extractDates(message, today);
      if (dates.length >= 2) return { from: dates[0]!, to: dates[dates.length - 1]!, label: `del ${formatDay(dates[0]!)} al ${formatDay(dates[dates.length - 1]!)}` };
      if (dates.length === 1) return { from: dates[0]!, to: dates[0]!, label: `el ${formatDay(dates[0]!)}` };
      return pastPeriod(fallback, today, message, fallback);
    }
    case "no_indicado":
      return pastPeriod(fallback, today, message, fallback);
  }
}

/** Horizonte hacia delante para reponer. */
export function horizon(periodo: Periodo, today: string): { days: number; label: string } {
  switch (periodo) {
    case "hoy":
      return { days: 1, label: "hoy" };
    case "ayer":
      return { days: 1, label: "hoy" };
    case "fin_de_semana": {
      // Días hasta el domingo incluido (si ya es fin de semana, lo que queda de él).
      const wd = weekday(today);
      const days = wd === 0 ? 1 : 7 - wd + 1;
      return { days: Math.min(days, 7), label: "el fin de semana" };
    }
    case "mes":
      return { days: 30, label: "el próximo mes" };
    case "semana":
      return { days: 7, label: "la próxima semana" };
    case "personalizado":
    case "no_indicado":
      return { days: 3, label: "los próximos 3 días" };
  }
}
