import { readSessions, type Session, type StoreOptions } from "../store.js";

/** The window `session week` reports on when nobody says otherwise. */
export const DEFAULT_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Reads `--days`. Whole days only: a window of 2.5 days is a boundary nobody
 * can hold in their head, and it would make two runs an hour apart disagree
 * about which sessions belong to the week.
 */
export function parseDays(value?: string): number {
  if (value === undefined) {
    return DEFAULT_DAYS;
  }
  const days = Number(value.trim());
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`--days takes a whole number of days, 1 or more. Got ${value}.`);
  }
  return days;
}

/**
 * The sessions that started inside the window, oldest first — a rolling one,
 * not calendar days, so the week means the same thing whenever it is run.
 *
 * A session still running is included: it is part of the week whether or not
 * it has been stopped, and its row says so.
 */
export async function weekSessions(
  days: number = DEFAULT_DAYS,
  options: StoreOptions = {},
): Promise<Session[]> {
  const sessions = await readSessions(options);
  const cutoff = Date.now() - days * DAY_MS;
  return sessions.filter((session) => Date.parse(session.startedAt) >= cutoff);
}
