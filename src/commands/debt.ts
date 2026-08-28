// The I/O half of `debt.ts`: every log on this machine, read and folded.
import { readdir } from "node:fs/promises";
import path from "node:path";
import { debtOf, type DebtReport } from "../debt.js";
import type { RateTable } from "../pricing.js";
import {
  currentIdentityOf,
  foldLog,
  foldLogs,
  readLogFile,
  relabel,
  storeHome,
  type RawLog,
  type Session,
  type StoreOptions,
} from "../store.js";

/**
 * `session debt` reads every repository's log, not just this one's.
 *
 * Debt is a fact about a codebase that only shows up over months, and the
 * question it answers — "which files does work keep landing in that nobody
 * plans for" — is one somebody asks about all their repositories at once,
 * usually from whichever one they happen to be standing in. Restricting it to
 * the current checkout would mean running it once per repo to find out which
 * repo to run it in.
 *
 * Reading them all is safe here because nothing in this report needs the
 * repository itself: drift, scope, timestamps and cost are all on the record.
 * Nothing asks git a question about a checkout it is not in, beyond the one in
 * `sameRepo` below, and nothing displays an outcome — see `spendOfDebt`.
 */

/** The extension every log in the store has; nothing else there is one. */
const LOG_SUFFIX = ".jsonl";

/** A log, and what the repo it belongs to was called when it was written. */
interface IdentifiedLog {
  identity: string;
  log: RawLog;
  /** Its own sessions, folded once — reused where nothing merges into it. */
  sessions: Session[];
}

/**
 * Every session recorded on this machine, one repository at a time, with the
 * logs of a repository that changed identity folded back together.
 *
 * Files are read in name order so two runs fold the same records in the same
 * order; each repository's sessions are sorted by start time by the fold, so
 * the order between files never reaches a figure.
 *
 * A store that does not exist yet is no sessions, not an error: `debt` is a
 * question somebody may ask before they have recorded anything, and a stack
 * trace is a poor way to say "nothing yet".
 */
export async function readAllSessions(options: StoreOptions = {}): Promise<Session[]> {
  const logs = await readAllLogs(options);
  const merged = await mergeByRepo(logs);
  return [...merged].flatMap(([identity, group]) => sessionsOf(identity, group));
}

/** Every log in the store, folded once each, in file-name order. */
async function readAllLogs(options: StoreOptions): Promise<IdentifiedLog[]> {
  const home = storeHome(options);

  let entries: string[];
  try {
    entries = await readdir(home);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const logs: IdentifiedLog[] = [];
  for (const name of entries.filter((name) => name.endsWith(LOG_SUFFIX)).sort()) {
    const log = await readLogFile(path.join(home, name));
    const sessions = foldLog(log);
    // What the log is called is read off the records rather than off the file
    // name, which is only a hash of it. A log holding nothing has no identity
    // and nothing to contribute to anyone else's.
    const identity = sessions[0]?.repo;
    if (identity !== undefined) {
      logs.push({ identity, log, sessions });
    }
  }
  return logs;
}

/**
 * The logs grouped by which repository they are actually about.
 *
 * A repo that gains an origin remote changes identity and starts a second log
 * under the new key, leaving everything recorded before it in the first. The
 * two are one repository, and reported apart they would be two rows with
 * halved histories — quite possibly two rows that each fall under the
 * three-session floor and so report nothing at all, which is the worst version
 * of this: months of history, and a report saying it cannot judge.
 *
 * So each path-keyed log's directory is asked what its origin is now. Only a
 * remote another log is already keyed on merges: the resolution is evidence
 * that two logs are one repo, and with nothing to merge into it says nothing
 * worth acting on. A directory that has been deleted, is no longer a repo, or
 * still has no remote answers nothing, and its log stays where it is.
 */
async function mergeByRepo(logs: readonly IdentifiedLog[]): Promise<Map<string, IdentifiedLog[]>> {
  const known = new Set(logs.map((entry) => entry.identity));
  const resolved = new Map<string, string>();

  await Promise.all(
    [...new Set(logs.map((entry) => entry.identity))].map(async (identity) => {
      const now = await currentIdentityOf(identity);
      if (now !== undefined && now !== identity && known.has(now)) {
        resolved.set(identity, now);
      }
    }),
  );

  const groups = new Map<string, IdentifiedLog[]>();
  for (const entry of logs) {
    const key = resolved.get(entry.identity) ?? entry.identity;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return groups;
}

/**
 * One repository's sessions, under what it is called now.
 *
 * A group of one is already folded and already named right. A group of several
 * is folded again as one stream, oldest identity first, because a session can
 * span two of them: a `settle` after the remote was added writes its patch
 * into the new log for a session created in the old one, and folding the two
 * apart would drop that patch as dangling.
 */
function sessionsOf(identity: string, group: readonly IdentifiedLog[]): Session[] {
  if (group.length === 1 && group[0]?.identity === identity) {
    return group[0].sessions;
  }

  // Path-keyed logs first — they are the ones that predate the remote — and by
  // identity within each kind, so two runs fold in the same order.
  const ordered = [...group].sort(
    (a, b) =>
      Number(a.identity === identity) - Number(b.identity === identity) ||
      a.identity.localeCompare(b.identity),
  );
  return relabel(foldLogs(ordered.map((entry) => entry.log)), identity);
}

/** What every repository on this machine owes, worked out from the logs. */
export async function debtReport(
  rates: RateTable,
  options: StoreOptions = {},
): Promise<DebtReport> {
  return debtOf(await readAllSessions(options), rates);
}
