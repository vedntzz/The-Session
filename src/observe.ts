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
 * `gathered` is facts somebody has already asked the repository for — the
 * sweep that may have just run gathers over every session, which is a superset
 * of any subset a view then displays. Gathering is by far the most expensive
 * thing this tool does, a `git log` per path, and doing it twice in one command
 * is the whole reason this parameter exists. Passing facts that do not cover a
 * session's paths would report it abandoned, so only ever pass a superset.
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
  gathered?: RepoFacts,
): Promise<Session[]> {
  const facts = gathered ?? (await factsFor(sessions, cwd));
  return sessions.map((session) => ({ ...session, outcome: effectiveOutcome(session, facts) }));
}
