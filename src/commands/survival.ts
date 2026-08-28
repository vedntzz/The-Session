// The half that asks the repository: what is at each path on the default
// branch now, and writing the answer into the log. The arithmetic on top of it
// is `survival.ts`.
import { blobIds, defaultBranch, repoRoot } from "../git.js";
import { isRepo } from "../git/run.js";
import { withOutcomes } from "../observe.js";
import {
  fateOf,
  mergedAt,
  stateOf,
  summarizeSurvival,
  survivalObservations,
  SURVIVAL_WINDOWS,
  type PathFate,
  type SurvivalObservation,
  type SurvivalReport,
  type SurvivalWindow,
} from "../survival.js";
import { readSessions, updateSession, type Session, type StoreOptions } from "../store.js";

/**
 * Going and looking, and writing down what was seen.
 *
 * `session survival` reads the log and reports; `session survival --check`
 * does the looking. They are one command because they are one question asked
 * at two moments, and a reader who runs the first is told when the second is
 * owed.
 *
 * The check is the only part that cannot be deferred. Every other figure in
 * this tool can be recomputed from the record whenever somebody asks — that is
 * what `outcome` being recomputed on every view is for — and this one cannot:
 * the branch says what it holds today, and nothing anywhere says what it held
 * on the fourteenth day after a merge unless somebody looked on the fourteenth
 * day and wrote it down.
 */

/** What one session's check came to. */
export interface Checked {
  session: Session;
  window: SurvivalWindow;
  observation: SurvivalObservation;
}

export interface CheckResult {
  /** The branch every check was made against. Absent where there is none. */
  branch?: string;
  /** The checks written, in the order they were written. */
  checked: Checked[];
  /** Sessions whose windows are all still open. Counted, never listed. */
  pending: number;
  /** Windows that closed too long ago to answer — see `CHECK_GRACE_DAYS`. */
  missed: number;
  /** Merged sessions with no observation saying when they merged. */
  unsettled: number;
}

/**
 * Runs every check that is due and records it.
 *
 * Due, and no more. A window still open is not checked early — the answer
 * would be about the wrong day — and one that closed weeks ago is not checked
 * late, because the tip today is not evidence about a fortnight that ended in
 * March. Both are counted and reported rather than quietly skipped.
 *
 * Re-running writes nothing new: a window already on the record is left alone.
 * The observation is never revised, only ever added to — a survival record
 * that could be rewritten would be worth exactly as much as recomputing it,
 * which is nothing.
 */
export async function checkSurvival(
  options: StoreOptions = {},
  now: number = Date.now(),
): Promise<CheckResult> {
  const cwd = options.cwd ?? process.cwd();
  const sessions = await withOutcomes(await readSessions(options), cwd);
  const merged = sessions.filter((session) => session.outcome === "merged");

  const result: CheckResult = {
    checked: [],
    pending: 0,
    missed: 0,
    unsettled: merged.filter((session) => mergedAt(session) === undefined).length,
  };

  const branch = (await isRepo(cwd)) ? await defaultBranch(await repoRoot(cwd)) : undefined;
  if (!branch) {
    // No branch to check against, so nothing is due and nothing is missed:
    // the question was never asked, which is not the same as going unanswered.
    return result;
  }
  result.branch = branch.name;

  const root = await repoRoot(cwd);
  const atTip = await blobsAtTip(root, branch.tip, pathsOf(merged));

  for (const session of merged) {
    for (const window of SURVIVAL_WINDOWS) {
      const state = stateOf(session, window, now);
      if (state === "pending") {
        result.pending += 1;
      } else if (state === "missed") {
        result.missed += 1;
      } else if (state === "due") {
        result.checked.push(await recordCheck(session, window, branch, atTip, now, options));
      }
    }
  }

  return result;
}

/** Every path any of these sessions left an end state for, asked about once. */
function pathsOf(sessions: readonly Session[]): string[] {
  return [...new Set(sessions.flatMap((session) => Object.keys(session.endState ?? {})))].sort();
}

/**
 * What each path holds on the branch tip, in one batch.
 *
 * Per path rather than per session, for the reason `gatherRepoFacts` gives:
 * twenty sessions touching the same handful of files ask the same question
 * over and over, and the answer does not depend on which is asking. A path
 * that is not in the tree at all is absent from the map rather than null — it
 * has no blob, which is what `fateOf` reads as gone.
 */
async function blobsAtTip(
  root: string,
  tip: string,
  paths: readonly string[],
): Promise<Map<string, string>> {
  const ids = await blobIds(root, paths.map((path) => `${tip}:${path}`));

  const found = new Map<string, string>();
  paths.forEach((path, index) => {
    const id = ids[index];
    if (id !== undefined) {
      found.set(path, id);
    }
  });
  return found;
}

/** Writes one window's answer onto the session, keeping the ones already there. */
async function recordCheck(
  session: Session,
  window: SurvivalWindow,
  branch: { name: string; tip: string },
  atTip: ReadonlyMap<string, string>,
  now: number,
  options: StoreOptions,
): Promise<Checked> {
  const observation: SurvivalObservation = {
    window,
    observedAt: new Date(now).toISOString(),
    commit: branch.tip,
    branch: branch.name,
    fates: fatesFor(session, atTip),
  };

  const updated = await updateSession(
    session.id,
    { survival: [...survivalObservations(session), observation] },
    options,
  );
  return { session: updated, window, observation };
}

/**
 * What became of every path the session left an end state for.
 *
 * The end state is the whole of the question: those are the paths whose
 * content this session is answerable for. A path it touched and left no blob
 * id for — a session stopped before end states were recorded — is not in there
 * and is not counted, since there is nothing to compare against.
 */
export function fatesFor(
  session: Session,
  atTip: ReadonlyMap<string, string>,
): Record<string, PathFate> {
  const fates: Record<string, PathFate> = {};
  for (const [path, recorded] of Object.entries(session.endState ?? {})) {
    fates[path] = fateOf(recorded, atTip.get(path));
  }
  return fates;
}

/**
 * The report, over outcomes resolved against the repository as it is now.
 *
 * `withOutcomes` first, like every other view: the stored `outcome` is only
 * what `settle` last wrote, and asking whether work survived of a session that
 * never merged is a question about nothing.
 */
export async function survivalReport(
  options: StoreOptions = {},
  now: number = Date.now(),
): Promise<SurvivalReport> {
  const sessions = await readSessions(options);
  return summarizeSurvival(await withOutcomes(sessions, options.cwd ?? process.cwd()), now);
}
