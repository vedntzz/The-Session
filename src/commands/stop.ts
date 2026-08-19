import { captureCost, type Adapter } from "../capture/index.js";
import { classifyPaths } from "../classify.js";
import { changedFilesSince, endStateOf } from "../git.js";
import {
  getOpenSession,
  isCaptured,
  totalTokens,
  updateSession,
  type Session,
  type StoreOptions,
} from "../store.js";
import { intentOf } from "../render/terminal.js";

/** What `session stop` needs, on top of where the store lives. */
export interface StopOptions extends StoreOptions {
  /** Transcript adapters to read. Defaults to every tool `session` knows. */
  adapters?: readonly Adapter[];
}

/** Strips the `./` prefix and trailing slashes so entries compare uniformly. */
function normalizeEntry(entry: string): string {
  return entry.trim().replace(/^\.\//, "").replace(/\/+$/, "");
}

/**
 * True when `path` falls under `entry`. Scope entries are path prefixes that
 * stop at directory boundaries, so `api/middleware/` covers
 * `api/middleware/rate_limit.py` but `api/order` never covers `api/orders.py`.
 */
function covers(entry: string, path: string): boolean {
  const prefix = normalizeEntry(entry);
  if (prefix === "" || prefix === ".") {
    return true; // the whole repo was declared
  }
  return path === prefix || path.startsWith(`${prefix}/`);
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
  return reality.filter((path) => !scope.some((entry) => covers(entry, path)));
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
  let changed: string[];
  try {
    changed = await changedFilesSince(open.startCommit, cwd);
  } catch (error) {
    throw new Error(
      `Cannot diff against the commit this session started from ` +
        `(${open.startCommit.slice(0, 7)}). If the history was rewritten, run ` +
        `session stop from a checkout that still has that commit.`,
      { cause: error },
    );
  }

  const reality = computeReality(changed, open.baseline);
  const endedAt = new Date().toISOString();
  const cost = await captureCost(
    { from: open.startedAt, to: endedAt, cwd },
    options.adapters ?? undefined,
  );

  return updateSession(
    open.id,
    {
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
    },
    options,
  );
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
export function formatStopped(session: Session): string[] {
  const changed = session.reality.length > 0 ? session.reality.join("  ") : "nothing";
  const lines = [`  stopped  ${intentOf(session)}`, `  changed  ${changed}`];
  if (session.drift.length > 0) {
    lines.push(`  outside  ${session.drift.join("  ")}`);
  }
  if (session.cost.apiCalls > 0) {
    const { turns, emptyTurns, apiCalls, callsWithoutEdits } = session.cost;
    lines.push(
      `  cost     ${totalTokens(session.cost).toLocaleString("en-US")} tokens  ` +
        `${turns} turns, ${emptyTurns} without edits  ` +
        `(${apiCalls} api calls, ${callsWithoutEdits} without edits)`,
    );
  }
  return lines;
}
