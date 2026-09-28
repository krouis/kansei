/**
 * Time handling.
 *
 * Two facts are stored for every dated record: the UTC instant, and the
 * learner's local calendar date plus zone and offset at that instant. That way
 * a day's history stays stable when the learner travels, when the zone database
 * changes, or across a daylight-saving transition — including the days that are
 * 23 or 25 hours long.
 */

export interface LocalStamp {
  /** ISO-8601 UTC instant. */
  at: string;
  /** Local calendar date, YYYY-MM-DD, per `timeZone`. */
  localDate: string;
  timeZone: string;
  /** Minutes east of UTC at `at`. */
  utcOffsetMinutes: number;
}

export function resolveTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Local calendar date for an instant in a zone, without pulling in a date library. */
export function localDateIn(date: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA yields YYYY-MM-DD.
  return fmt.format(date);
}

/** Offset in minutes east of UTC for an instant in a zone. */
export function utcOffsetMinutesIn(date: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const hour = parts.hour === '24' ? '00' : parts.hour;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - date.getTime()) / 60000);
}

export function stamp(date: Date, timeZone = resolveTimeZone()): LocalStamp {
  return {
    at: date.toISOString(),
    localDate: localDateIn(date, timeZone),
    timeZone,
    utcOffsetMinutes: utcOffsetMinutesIn(date, timeZone),
  };
}

/** Add whole days to a YYYY-MM-DD string without touching zones. */
export function addDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split('-').map(Number);
  const base = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  const next = new Date(base + days * 86400000);
  return next.toISOString().slice(0, 10);
}

/** Inclusive list of local dates from `from` to `to`. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  // Guard against a reversed range.
  if (from > to) return out;
  while (cur <= to) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

export function daysBetween(from: string, to: string): number {
  const p = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((p(to) - p(from)) / 86400000);
}
