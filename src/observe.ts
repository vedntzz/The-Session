import { gatherRepoFacts } from "./git.js";
import { effectiveOutcome, type RepoFacts } from "./outcome.js";
import type { Session } from "./store.js";

/**
 * The I/O half of `outcome.ts`: asks the repository where a set of sessions
 * ended up, and hands back what it found.
 *
 * One gather for the whole set. Twenty sessions over a week touch the same
 * files repeatedly, and the answer to "is this blob in the branch" does not
 * depend on which session is asking.
 */

/** Facts covering every path the given sessions left an end state for. */
export async function factsFor(
  sessions: readonly Session[],
  cwd: string = process.cwd(),
): Promise<RepoFacts | undefined> {
  // Gathered even when there are no paths to look up. A session that left
  // nothing behind is still decidable — there is nothing of it anywhere, which
  // is an answer — and returning no facts here would push it into the "cannot
  // tell" fallback instead.
  return gatherRepoFacts(
    sessions.flatMap((session) => (session.endState ? Object.keys(session.endState) : [])),
    cwd,
  );
}

/**
 * The same sessions, with `outcome` replaced by what the repository says now.
 *
 * Overwriting the field rather than carrying a second one beside it is the
 * point: every reader downstream — the terminal view, the HTML page, the week
 * filters — then works from the computed answer without having to know it was
 * computed, and the stored field can never be the one that reaches a screen.
 * The record on disk is untouched.
 */
export async function withOutcomes(
  sessions: readonly Session[],
  cwd: string = process.cwd(),
): Promise<Session[]> {
  const facts = await factsFor(sessions, cwd);
  return sessions.map((session) => ({ ...session, outcome: effectiveOutcome(session, facts) }));
}
