// The I/O half of `debt.ts`: every log on this machine, read and folded.
import { readdir } from "node:fs/promises";
import path from "node:path";
import { debtOf, type DebtReport } from "../debt.js";
import type { RateTable } from "../pricing.js";
import { foldLog, readLogFile, storeHome, type Session, type StoreOptions } from "../store.js";

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
 * Nothing asks git a question about a checkout it is not in, and nothing
 * displays an outcome — see `spendOfDebt`.
 */

/** The extension every log in the store has; nothing else there is one. */
const LOG_SUFFIX = ".jsonl";

/**
 * Every session recorded on this machine, one repository's log at a time.
 *
 * Files are read in name order so two runs fold the same records in the same
 * order; each log is sorted within itself by `foldLog`, and `debtOf` groups by
 * repo, so the order between files never reaches a figure.
 *
 * A store that does not exist yet is no sessions, not an error: `debt` is a
 * question somebody may ask before they have recorded anything, and a stack
 * trace is a poor way to say "nothing yet".
 */
export async function readAllSessions(options: StoreOptions = {}): Promise<Session[]> {
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

  const sessions: Session[] = [];
  for (const name of entries.filter((name) => name.endsWith(LOG_SUFFIX)).sort()) {
    sessions.push(...foldLog(await readLogFile(path.join(home, name))));
  }
  return sessions;
}

/** What every repository on this machine owes, worked out from the logs. */
export async function debtReport(
  rates: RateTable,
  options: StoreOptions = {},
): Promise<DebtReport> {
  return debtOf(await readAllSessions(options), rates);
}
