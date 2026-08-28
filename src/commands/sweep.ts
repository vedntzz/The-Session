// The daily sweep: settle what has landed, run the survival checks that have
// come due, and say nothing unless something was written.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { factsFor } from "../observe.js";
import type { RepoFacts } from "../outcome.js";
import { readSessions, repoKey, storeHome, type StoreOptions } from "../store.js";
import { settleSessions } from "./settle.js";
import { checkSurvival } from "./survival.js";

/**
 * Two commands nobody remembers to run.
 *
 * `settle` and `survival --check` both write down answers that stop being
 * available if nobody asks in time — a survival window closes for good a week
 * after it opens, and an outcome computed in a year is computed against a
 * branch that has moved. Leaving them to be typed by hand means a log full of
 * questions that were answerable once.
 *
 * So they run themselves: once a day per repository, off the back of whatever
 * the developer was already doing — the editor hook that closes a session, or
 * a `week`, `show` or bare `session` typed for another reason. Neither command
 * changes; this runs them.
 *
 * Three rules make that tolerable rather than intrusive:
 *
 * - **Silent unless something was written.** A sweep that found nothing to say
 *   says nothing. Every other command's output is unchanged on the days
 *   nothing lands, which is most days.
 * - **Once a day, per repo**, and the stamp is written before the work rather
 *   than after. A sweep that is cancelled halfway — the hook's budget runs out,
 *   the terminal is closed — therefore waits until tomorrow instead of running
 *   again on the next command. The alternative is a repo that sweeps on every
 *   invocation forever because the sweep never finishes, which would make the
 *   whole tool feel broken.
 * - **It cannot make the command it rode in on fail.** `sweepFirst` swallows
 *   what goes wrong: `session week` exists to print a week, and a repository
 *   whose branch has gone missing is not a reason to refuse to.
 */

/** How often a repo is swept. Once a day: the windows are measured in weeks. */
export const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** What the stamp file is called, beside the log it belongs to. */
export const SWEEP_SUFFIX = ".swept";

/** What a sweep did. Every count is of records actually written. */
export interface SweepResult {
  /** False when the sweep was not due, or there was nothing to sweep. */
  ran: boolean;
  /** Outcomes `settle` wrote. */
  settled: number;
  /** Survival checks recorded. */
  checks: number;
  /**
   * What the repository said, gathered once, for the caller to reuse.
   *
   * The gather is a `git log` per path and by far the most expensive thing
   * here. A `week` that swept and then gathered again for its own display
   * would take twice as long on sweep days, which is exactly the day a
   * developer would notice. Absent when nothing was gathered.
   */
  facts?: RepoFacts;
}

/** Nothing done, and nothing to hand back. */
function idle(): SweepResult {
  return { ran: false, settled: 0, checks: 0 };
}

/** Where this repo's sweep stamp lives: beside its log, under the same key. */
export async function sweepStampFile(options: StoreOptions = {}): Promise<string> {
  const key = await repoKey(options.cwd ?? process.cwd());
  return path.join(storeHome(options), `${key}${SWEEP_SUFFIX}`);
}

/**
 * When this repo was last swept, or nothing where it never has been.
 *
 * An unreadable or unparseable stamp reads as never swept. It is a stamp on a
 * cache of effort, not a record of anything — the log is where records live —
 * so the safe direction when it cannot be read is to do the work again.
 */
export async function lastSweep(file: string): Promise<number | undefined> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return undefined;
  }
  const at = Date.parse(text.trim());
  return Number.isNaN(at) ? undefined : at;
}

/**
 * Whether a sweep is owed.
 *
 * A stamp in the future is owed too. Clocks move backwards — a machine
 * correcting itself, a laptop crossing a timezone with a bad RTC — and a
 * stamp dated next March would otherwise stop this repo sweeping until then.
 */
export function isDue(last: number | undefined, now: number): boolean {
  return last === undefined || now < last || now - last >= SWEEP_INTERVAL_MS;
}

/** Writes the stamp, creating the store directory if this is its first record. */
async function stamp(file: string, now: number): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${new Date(now).toISOString()}\n`, { encoding: "utf8", mode: 0o600 });
}

/**
 * Settles and checks, if it is a day since the last time.
 *
 * Nothing is swept for a repo with no sessions in it, and no stamp is written
 * for one either: there is nothing to settle, and a `session week` in a repo
 * that has never recorded anything should leave the disk exactly as it found
 * it.
 */
export async function sweep(
  options: StoreOptions = {},
  now: number = Date.now(),
): Promise<SweepResult> {
  const sessions = await readSessions(options);
  if (sessions.length === 0) {
    return idle();
  }

  const file = await sweepStampFile(options);
  if (!isDue(await lastSweep(file), now)) {
    return idle();
  }
  // Before the work, not after. See the note at the top of this file.
  await stamp(file, now);

  const facts = await factsFor(sessions, options.cwd ?? process.cwd());
  if (!facts) {
    // No repository, or no default branch: `settle` would call every session
    // undecidable and the survival check would have no tip to look at. Both
    // would write nothing, so neither is run.
    return { ran: true, settled: 0, checks: 0 };
  }

  // Settle first. A session that merged today gets its date now, which is what
  // the survival windows are counted from — the check below will find nothing
  // due for it, correctly, and will a fortnight from now.
  const settled = await settleSessions(options, facts);
  const checked = await checkSurvival(options, now, facts);

  return {
    ran: true,
    settled: settled.settled.filter((one) => one.recorded).length,
    checks: checked.checked.length,
    facts,
  };
}

/** What a sweep rode in on, for the command it rode in on. */
export interface SweptFirst {
  /** The line to print above the view, empty when nothing was written. */
  notice: string[];
  /** The repository's answers, for the view to reuse. See `SweepResult`. */
  facts?: RepoFacts;
}

/**
 * The opportunistic sweep: run it, and hand back what the caller needs.
 *
 * Wrapped, because the sweep is something the developer did not ask for and a
 * command must not fail at a job it was not given. A missing branch, a lock
 * another process is holding, a repository somebody moved — none of that is a
 * reason for `session week` to refuse to print a week. The sweep is skipped
 * and the command carries on gathering for itself.
 */
export async function sweepFirst(
  options: StoreOptions = {},
  now: number = Date.now(),
): Promise<SweptFirst> {
  try {
    const result = await sweep(options, now);
    return { notice: formatSweep(result), ...(result.facts ? { facts: result.facts } : {}) };
  } catch {
    return { notice: [] };
  }
}

/**
 * What the sweep says, which is nothing at all unless it wrote something.
 *
 * One line, because this is a note about the record having changed under a
 * command the developer typed for another reason. What was written is worth
 * exactly one line; a sweep that found nothing is worth none, and printing
 * "nothing to settle" on every `session week` is how a tool teaches people to
 * stop reading its output.
 */
export function formatSweep(result: SweepResult): string[] {
  const parts: string[] = [];
  if (result.settled > 0) {
    parts.push(`${plural(result.settled, "outcome", "outcomes")}`);
  }
  if (result.checks > 0) {
    parts.push(`${plural(result.checks, "survival check", "survival checks")}`);
  }
  return parts.length === 0 ? [] : [`  recorded ${parts.join(", ")}`];
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
