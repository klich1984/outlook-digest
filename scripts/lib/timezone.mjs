/**
 * Timezone helpers for Colombia (America/Bogota, UTC-5, no DST).
 *
 * Colombia does not observe daylight saving time, so the offset is a
 * fixed -05:00 year-round. We do NOT use the host's local timezone
 * because the GH Actions runner is UTC. Every date displayed to the
 * user (subject line, report header, message rows) goes through these
 * helpers to guarantee consistent formatting regardless of where the
 * script runs.
 *
 * Month abbreviations are hardcoded in Spanish (matching the locked
 * decision: subject reads "Reporte semanal Hotmail — 17 jun 2026").
 */

const COL_TZ = 'America/Bogota';

const MONTHS_ES = Object.freeze([
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
]);

const MONTHS_ES_FULL = Object.freeze([
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]);

const WEEKDAYS_ES = Object.freeze([
  'domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado',
]);

/**
 * Extracts year/month/day/hour/minute for the given Date in COL time.
 * Uses Intl.DateTimeFormat with en-US locale for stable digit-only
 * output, then maps the result manually to avoid locale surprises.
 *
 * @param {Date|string|number} date
 * @returns {{ year: number, month: number, day: number, hour: number, minute: number, weekday: number }}
 */
export function getPartsInCOL(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) {
    throw new RangeError(`Fecha inválida: ${String(date)}`);
  }
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: COL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = {};
  for (const piece of fmt.formatToParts(d)) {
    parts[piece.type] = piece.value;
  }
  // Intl returns weekday like "Mon"; map to 0..6 via Date.getUTCDay
  // adjusted for COL offset. Simpler: re-read weekday with explicit
  // format and look it up.
  const weekdayFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: COL_TZ,
    weekday: 'short',
  });
  const weekdayShort = weekdayFmt.format(d); // "Mon"
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    hour: parseInt(parts.hour === '24' ? '0' : parts.hour, 10),
    minute: parseInt(parts.minute, 10),
    weekday: weekdayMap[weekdayShort] ?? 0,
  };
}

/**
 * @returns {{ year: number, month: number, day: number, hour: number, minute: number, weekday: number }}
 */
export function getNowInCOL() {
  return getPartsInCOL(new Date());
}

/**
 * Format a date as "17 jun 2026" (subject line) or "17 de junio de 2026"
 * (long form for the report header).
 *
 * @param {Date|string|number} date
 * @param {{ long?: boolean }} [opts]
 * @returns {string}
 */
export function formatDateInCOL(date, opts = {}) {
  const p = getPartsInCOL(date);
  const monthIdx = p.month - 1;
  if (opts.long) {
    return `${p.day} de ${MONTHS_ES_FULL[monthIdx]} de ${p.year}`;
  }
  return `${p.day} ${MONTHS_ES[monthIdx]} ${p.year}`;
}

/**
 * Format a time as "08:00 COL".
 *
 * @param {Date|string|number} date
 * @returns {string}
 */
export function formatTimeInCOL(date) {
  const p = getPartsInCOL(date);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')} COL`;
}

/**
 * Format a date range like "10 jun 2026 – 17 jun 2026".
 *
 * @param {Date|string|number} from
 * @param {Date|string|number} to
 * @returns {string}
 */
export function formatDateRangeInCOL(from, to) {
  return `${formatDateInCOL(from)} – ${formatDateInCOL(to)}`;
}

/**
 * Returns the rolling N-day window [now-N, now] using real elapsed time
 * (not calendar days). Used by the Graph filter and the report header.
 *
 * @param {number} n - number of days back
 * @returns {{ from: Date, to: Date }}
 */
export function getLastNDays(n) {
  const to = new Date();
  const from = new Date(to.getTime() - n * 24 * 60 * 60 * 1000);
  return { from, to };
}

/**
 * Return the Spanish weekday name for a date in COL time.
 *
 * @param {Date|string|number} date
 * @returns {string}
 */
export function getWeekdayInCOL(date) {
  const p = getPartsInCOL(date);
  return WEEKDAYS_ES[p.weekday];
}
