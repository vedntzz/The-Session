const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** `12 Aug`, in the reader's own timezone — the day they remember working. */
export function monthDay(at: Date): string {
  return `${at.getDate()} ${MONTHS[at.getMonth()]}`;
}

/**
 * The window, as a heading says it.
 *
 * Three shapes, because repeating the month in `12 Aug–18 Aug` is noise and
 * leaving the year out of a range that crosses one is a lie. A window of one
 * day is a date, not a range.
 */
export function formatRange(from: Date, to: Date): string {
  const sameYear = from.getFullYear() === to.getFullYear();
  if (!sameYear) {
    return `${monthDay(from)} ${from.getFullYear()} – ${monthDay(to)} ${to.getFullYear()}`;
  }
  if (from.getMonth() !== to.getMonth()) {
    return `${monthDay(from)} – ${monthDay(to)}`;
  }
  if (from.getDate() === to.getDate()) {
    return monthDay(to);
  }
  return `${from.getDate()}–${monthDay(to)}`;
}

/**
 * The first day the window covers.
 *
 * `days` counts calendar days ending today, so a seven-day window run on the
 * 18th is headed 12–18: seven days, both ends included. That is a day earlier
 * than the rolling cutoff `weekSessions` filters on, which is deliberate — the
 * heading names the days a reader would say the report covers, and no session
 * can fall outside it.
 */
export function windowStart(to: Date, days: number): Date {
  const from = new Date(to.getTime() - (days - 1) * DAY_MS);
  from.setHours(0, 0, 0, 0);
  return from;
}

