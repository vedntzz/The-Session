import { captureCost, type Adapter } from "../capture/index.js";
import { changedFilesSince } from "../git.js";
import {
  getOpenSession,
  totalTokens,
  updateSession,
  type Session,
  type StoreOptions,
} from "../store.js";

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
      drift: computeDrift(reality, open.scope),
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
  const lines = [`  stopped  ${session.intent}`, `  changed  ${changed}`];
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
