import { changedFilesSince } from "../git.js";
import { getOpenSession, updateSession, type Session, type StoreOptions } from "../store.js";

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
 * normally. `cost` is left at zeros until the transcript adapter lands, and
 * `outcome` stays `open` until the work merges or is abandoned.
 */
export async function stopSession(options: StoreOptions = {}): Promise<Session> {
  const open = await getOpenSession(options);
  if (!open) {
    throw new Error("No session is open. Run session start before session stop.");
  }

  const cwd = options.cwd ?? process.cwd();
  let reality: string[];
  try {
    reality = await changedFilesSince(open.startCommit, cwd);
  } catch (error) {
    throw new Error(
      `Cannot diff against the commit this session started from ` +
        `(${open.startCommit.slice(0, 7)}). If the history was rewritten, run ` +
        `session stop from a checkout that still has that commit.`,
      { cause: error },
    );
  }

  return updateSession(
    open.id,
    {
      reality,
      drift: computeDrift(reality, open.scope),
      endedAt: new Date().toISOString(),
    },
    options,
  );
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
  return lines;
}
