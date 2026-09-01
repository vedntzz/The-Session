import { captureCost, type Adapter } from "../capture/index.js";
import { classifyPaths } from "../classify.js";
import { changedFilesSince, endStateOf } from "../git.js";
import {
  getOpenSession,
  isCaptured,
  totalTokens,
  updateSession,
  type Session,
  type SessionCost,
  type SessionPatch,
  type StoreOptions,
} from "../store.js";
import { isPriced, priceSession, type RateTable } from "../pricing.js";
import { inScope } from "../scope.js";
import { describePaths, intentOf, unpricedTokens } from "../render/terminal.js";
import { plural } from "../render/terminal/text.js";
import { emptyTurnsOf, reconcileEmpty } from "../empty.js";

/** What `session stop` needs, on top of where the store lives. */
export interface StopOptions extends StoreOptions {
  /** Transcript adapters to read. Defaults to every tool `session` knows. */
  adapters?: readonly Adapter[];
}

/**
 * What this session changed: everything different from the start commit,
 * less whatever was already dirty when it opened. A file the session touched
 * on top of pre-existing edits is still excluded, since git reports only that
 * it differs from HEAD, not who made which hunk.
 */
export function computeReality(changed: readonly string[], baseline: readonly string[]): string[] {
  const before = new Set(baseline);
  return changed.filter((path) => !before.has(path));
}

/**
 * What changed that nobody declared: `reality` minus `scope`. Order follows
 * `reality`, which git already returns sorted.
 */
export function computeDrift(reality: readonly string[], scope: readonly string[]): string[] {
  return reality.filter((path) => !inScope(scope, path));
}

/**
 * The drift a session is recorded with. Nothing, for a session nobody
 * declared.
 *
 * A passive session has an empty scope because no scope was asked for, not
 * because the developer said the work would touch nothing — and running the
 * rule over it would call every file it touched drift, which would make the
 * word mean "changed" and empty it of the only thing it says. Drift is the
 * distance between a declaration and reality. Without a declaration there is
 * no distance to measure, and an unmeasured quantity is recorded as absent
 * rather than as zero-by-way-of-everything.
 *
 * This is why `session start --scope` still earns its keep once the hook is
 * recording everything: declaring a scope is what turns a record of what
 * changed into a record of what changed that you did not expect.
 */
export function driftOf(session: Session, reality: readonly string[]): string[] {
  return isCaptured(session) ? [] : computeDrift(reality, session.scope);
}

/**
 * Closes the open session: diffs the repo against the commit it started from,
 * records what actually changed and what drifted outside the declared scope,
 * and stamps the end time.
 *
 * Drift is recorded, never blocked — a session that wandered still closes
 * normally. `outcome` stays `open` until the work merges or is abandoned.
 */
export async function stopSession(options: StopOptions = {}): Promise<Session> {
  const open = await getOpenSession(options);
  if (!open) {
    throw new Error("No session is open. Run session start before session stop.");
  }

  const cwd = options.cwd ?? process.cwd();
  const changed = await diffSince(open.startCommit, cwd);
  const reality = computeReality(changed, open.baseline);
  const endedAt = new Date().toISOString();
  const captured = await captureCost(
    { from: open.startedAt, to: endedAt, cwd },
    options.adapters ?? undefined,
  );
  // The one place both halves are in hand: what the agent spent, and what the
  // repository has to show for it. An adapter cannot do this for itself — a
  // transcript names the tool a call used, never what it did to the disk.
  const cost = reconcileEmpty(captured, reality.length > 0);

  return updateSession(open.id, await closingPatch(open, reality, cost, endedAt, cwd), options);
}

/** What changed since the session opened, or why that cannot be answered. */
async function diffSince(startCommit: string, cwd: string): Promise<string[]> {
  try {
    return await changedFilesSince(startCommit, cwd);
  } catch (error) {
    throw new Error(
      `Cannot diff against the commit this session started from ` +
        `(${startCommit.slice(0, 7)}). If the history was rewritten, run ` +
        `session stop from a checkout that still has that commit.`,
      { cause: error },
    );
  }
}

/** Everything `stop` writes onto the record, gathered in one place. */
async function closingPatch(
  open: Session,
  reality: string[],
  cost: SessionCost,
  endedAt: string,
  cwd: string,
): Promise<SessionPatch> {
  return {
    reality,
    drift: driftOf(open, reality),
    // Derived here rather than at display time so the log says what the
    // session was about without anything having to re-run the rules over it.
    // The rules are pure and the input is on the record, so a reader that
    // does re-run them gets the same answer — see `classify.ts`.
    class: classifyPaths(reality),
    // What the session left at each path. Recorded now because it cannot be
    // recovered later: this is what `settle` goes looking for in the default
    // branch, and by then the working tree has moved on.
    endState: await endStateOf(reality, cwd),
    cost,
    endedAt,
  };
}

/**
 * `stop` for the editor hook: closes the open session, or does nothing at all.
 *
 * The hook fires when any Claude Code session ends, most of which were not
 * declared. A missing session is the ordinary case there, not a mistake worth
 * an error in someone's editor.
 */
export async function stopIfOpen(options: StopOptions = {}): Promise<Session | undefined> {
  if (!(await getOpenSession(options))) {
    return undefined;
  }
  return stopSession(options);
}

/**
 * The lines `session stop` prints. The `outside` line appears only when the
 * session drifted, so a clean session stays quiet about it.
 */
/**
 * The tokens, and the model where no rate covers it.
 *
 * `stop` reports tokens rather than money — it is the line printed the moment
 * an agent finishes, and the money is what `show` and `week` are for. What it
 * owes the reader is the model, in the same words `week` and `scan` use, so a
 * session that turns up unpriced in the week is recognisable here.
 *
 * Without a rate table nothing is claimed either way. `stop` is called in
 * places that have no rates to hand, and "unpriced" would then mean "nobody
 * asked" rather than "no rate covers this".
 */
function tokensSpent(cost: SessionCost, rates?: RateTable): string {
  const tokens = `${totalTokens(cost).toLocaleString("en-US")} tokens`;
  if (rates === undefined || isPriced(priceSession(cost, rates))) {
    return tokens;
  }
  return unpricedTokens(cost);
}

export function formatStopped(session: Session, rates?: RateTable): string[] {
  // Capped the same way `show` caps its sentence, by the same function: a
  // reader who learned the rule in one view should not meet a different
  // answer in the other. Two spaces, because this is a column and not prose.
  const changed =
    session.reality.length > 0 ? describePaths(session.reality, "  ") : "nothing";
  const lines = [`  stopped  ${intentOf(session)}`, `  changed  ${changed}`];
  if (session.drift.length > 0) {
    lines.push(`  outside  ${describePaths(session.drift, "  ")}`);
  }
  if (session.cost.apiCalls > 0) {
    const { turns, apiCalls } = session.cost;
    // No count of calls that changed nothing, here or anywhere: a transcript
    // cannot say which call wrote a file, and the figure it used to print was
    // the tool-name guess. The turn figure is dropped the same way when the
    // diff cannot settle it — see `emptyTurnsOf`.
    const empty = emptyTurnsOf(session);
    const produced = empty === undefined ? "" : `, ${empty} that produced nothing`;
    lines.push(
      `  cost     ${tokensSpent(session.cost, rates)}  ` +
        `${plural(turns, "turn", "turns")}${produced}  (${plural(apiCalls, "api call", "api calls")})`,
    );
  }
  return lines;
}
