import { reportedOutcome } from "../../../outcome.js";
import type { Session, SessionOutcome } from "../../../store.js";
import { figure, plural } from "../text.js";

/**
 * How many of these ended that way, read through `reportedOutcome`.
 *
 * Never off the field: `abandoned` is a person's word, and the computation
 * arrives at it from evidence an unpushed branch produces just as readily. A
 * count taken off the raw field would report somebody's unfinished work as
 * thrown away.
 */
function count(sessions: readonly Session[], outcome: SessionOutcome): number {
  return sessions.filter((session) => reportedOutcome(session) === outcome).length;
}

/**
 * How many sessions, and where their work went — for a caller that wants one
 * line over a window rather than the blocks below.
 *
 * Kept for `render/tui`, which has one header line and no room to split it
 * three ways. `week` itself no longer prints this: pooling declared, primed
 * and captured into one count is the reading the blocks exist to prevent.
 */
export function outcomeHeadline(sessions: readonly Session[]): string {
  const open = count(sessions, "open");
  const empty = count(sessions, "empty");
  return [
    plural(sessions.length, "session", "sessions"),
    `${figure(count(sessions, "merged"))} landed on the default branch`,
    `${figure(count(sessions, "abandoned"))} did not`,
    ...(open > 0 ? [`${figure(open)} still open`] : []),
    ...(empty > 0 ? [`${figure(empty)} changed no files`] : []),
  ].join(" · ");
}

export { count as countOutcomes };
