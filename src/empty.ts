// Which turns produced nothing, answered from the diff rather than from the
// names of the tools an agent happened to call.
//
// Every view goes through here, the way every view goes through `outcomeOf`
// for where the work went. Two readers of `cost.emptyTurns` would be two
// answers to "was this session wasted", and the field alone cannot be read:
// what it means depends on which rule wrote it.
import { totalTokens, type EmptySource, type Session, type SessionCost, type TokenCounts } from "./store.js";

/**
 * Which rule decided a record's empty turns.
 *
 * Absent reads as `tools`, like `intentSource`'s absent reading as `declared`:
 * nothing but the tool-name test could have written those records, so it is a
 * fact about them rather than a guess about them.
 */
export function emptySourceOf(cost: SessionCost): EmptySource {
  return cost.emptySource ?? "tools";
}

/**
 * How many turns produced nothing, or **nothing at all** where the record
 * cannot say.
 *
 * Three cases, and the middle one is the change:
 *
 * - **The session changed no files.** Then every turn in it produced nothing,
 *   whatever any rule recorded — git has settled it, and this is the case the
 *   waste figure exists for.
 * - **The session changed files, under the `git` rule.** Which turn wrote them
 *   is not on the record and cannot be recovered from it: a diff is one
 *   answer for the whole session. So there is no figure, and a nought would be
 *   the wrong kind of wrong — it has the shape of a measurement and it would
 *   say nothing was wasted.
 * - **The session changed files, under the old `tools` rule.** Its figure is
 *   kept, since for a session that used `Edit` and `Write` it is right, and
 *   throwing away every old record's figure would discard months of correct
 *   ones. The exception is the figure git contradicts outright: a session
 *   that changed files cannot have had *every* turn produce nothing, and that
 *   is exactly what the old rule reported for an agent working through the
 *   shell. Those are refused rather than shown.
 */
export function emptyTurnsOf(session: Pick<Session, "cost" | "reality">): number | undefined {
  const { cost } = session;

  if (session.reality.length === 0) {
    return cost.turns;
  }
  if (emptySourceOf(cost) === "git" || cost.emptyTurns === undefined) {
    return undefined;
  }
  // Files changed, so "every turn produced nothing" is not a figure that can
  // be true. It is the signature of the tool-name rule meeting an agent that
  // wrote through the shell, and it is the one old figure git can refute.
  return cost.emptyTurns === cost.turns ? undefined : cost.emptyTurns;
}

/**
 * What the turns that produced nothing cost, or nothing where that is not a
 * measurement.
 *
 * Follows `emptyTurnsOf` exactly — a token figure standing where the turn
 * count is absent would be a share of a session invented to fill the column.
 * Where every turn was empty it is the session's own four counters, which is
 * a measurement and not an apportionment.
 */
export function emptyTokensOf(session: Pick<Session, "cost" | "reality">): TokenCounts | undefined {
  const { cost } = session;
  if (emptyTurnsOf(session) === undefined) {
    return undefined;
  }
  if (session.reality.length === 0) {
    return {
      inputTokens: cost.inputTokens,
      cacheReadTokens: cost.cacheReadTokens,
      cacheCreationTokens: cost.cacheCreationTokens,
      outputTokens: cost.outputTokens,
    };
  }
  return cost.emptyTurnTokens;
}

/** Every token spent in a turn that produced nothing, or nothing where unknown. */
export function emptyTokenTotal(session: Pick<Session, "cost" | "reality">): number | undefined {
  const tokens = emptyTokensOf(session);
  return tokens === undefined ? undefined : totalTokens(tokens);
}

/**
 * A captured cost, settled against what the session actually left behind.
 *
 * Called once, at `stop`, where the diff is in hand. An adapter cannot do this
 * itself: it reads a transcript, and a transcript records which tool was
 * called rather than what the call did to the disk. `Bash` is the most-used
 * tool by some distance and it writes files constantly — through a heredoc, a
 * `sed`, a script — so a rule keyed on tool names reports the sessions that
 * did the most work as the ones that did none.
 *
 * What git can settle is whether the session wrote anything. That is enough
 * for the figure that matters — a session that spent money and left nothing —
 * and it is not enough to divide the waste between turns. So the second is not
 * reported rather than being estimated into existence.
 */
export function reconcileEmpty(cost: SessionCost, wroteFiles: boolean): SessionCost {
  if (wroteFiles) {
    return { ...cost, emptySource: "git" };
  }
  return {
    ...cost,
    emptySource: "git",
    emptyTurns: cost.turns,
    emptyTurnTokens: {
      inputTokens: cost.inputTokens,
      cacheReadTokens: cost.cacheReadTokens,
      cacheCreationTokens: cost.cacheCreationTokens,
      outputTokens: cost.outputTokens,
    },
  };
}

/**
 * How many turns produced nothing across a set of sessions, or nothing at all
 * where any one of them cannot say.
 *
 * All or nothing on purpose. A total that quietly left out the sessions whose
 * figure is unknown would be smaller than the truth and would look exactly
 * like a total that counted everything — the same defect as a week of
 * unpriced sessions totalling `$0.00`. The views that print this say beside it
 * how many sessions could not be counted.
 */
export function emptyTurnsTotal(
  sessions: readonly Pick<Session, "cost" | "reality">[],
): number | undefined {
  let total = 0;
  for (const session of sessions) {
    const empty = emptyTurnsOf(session);
    if (empty === undefined) {
      return undefined;
    }
    total += empty;
  }
  return total;
}

/** How many of these sessions cannot say which of their turns produced nothing. */
export function unmeasuredEmpty(sessions: readonly Pick<Session, "cost" | "reality">[]): number {
  return sessions.filter((session) => emptyTurnsOf(session) === undefined).length;
}
