// What a view calls an intent, and the markers that survive a pipe.
import type { Session } from "../../store.js";

/**
 * Marks drift where colour cannot: piped output, a log file, a screenshot,
 * a terminal someone has turned colour off in.
 */
export const DRIFT_MARKER = "!";

/**
 * Marks an intent that was captured from a prompt rather than declared before
 * the work. Like `DRIFT_MARKER`, it is a character rather than an ink, so the
 * distinction survives a pipe, a log file and a screenshot; the tables that
 * use it say what it means underneath.
 */
export const CAPTURED_MARKER = "~";

/** What `show` says about an intent nobody declared. */
export const CAPTURED_INTENT = "captured from the first prompt, not declared";

/** What `show` says instead of a scope, for a session nobody declared one for. */
export const NO_SCOPE = "no scope — nothing was declared to drift from";

/** Where a reader who wants drift is sent. */
export const SCOPE_HINT = "← session start --scope is what makes drift visible";

/** How a session with no intent yet reads. */
export const NO_INTENT_OPEN = "(no prompt yet)";

/** How a session that ended without ever being given one reads. */
export const NO_INTENT_ENDED = "(no prompt)";

/**
 * The intent as any view prints it.
 *
 * A passive session that has not had a prompt yet has no words to show, and a
 * session that ended before one arrived never will. Both say so rather than
 * printing an empty column: a blank would read as a session whose intent was
 * lost, and nothing was lost — nothing was ever said.
 */
export function intentOf(session: Pick<Session, "intent" | "endedAt">): string {
  if (session.intent !== null) {
    return session.intent;
  }
  return session.endedAt === null ? NO_INTENT_OPEN : NO_INTENT_ENDED;
}
