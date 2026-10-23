// The report window a --since value names: the last 7, 30 or 90 days up to now. Pure.
import type { TeamReport } from "./team-report.js";

const DAYS_BY_SINCE: Readonly<Record<string, number>> = { "7d": 7, "30d": 30, "90d": 90 };
const DAY_MS = 24 * 60 * 60 * 1000;

/** The window ending at `now`; any other value is an error naming the accepted ones. */
export function windowSince(since: string, now: Date): TeamReport["window"] {
  const days = DAYS_BY_SINCE[since];
  if (days === undefined) throw new Error(`--since ${since} is not a window. Use 7d, 30d or 90d.`);
  return { from: new Date(now.getTime() - days * DAY_MS).toISOString(), to: now.toISOString() };
}
