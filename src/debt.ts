// The files nobody ever meant to touch, and keeps touching. Pure: sessions and
// rates in, one report out. Nothing here reads a file or runs git — see
// `commands/debt.ts` for that half.
import { classOfPath, type SessionClass } from "./classify.js";
import { isPriced, priceSession, wasMeasured, type RateTable } from "./pricing.js";
import { inScope } from "./scope.js";
import type { Session } from "./store.js";

/**
 * Session debt: a file that keeps turning up outside the plan and has never
 * since been planned for.
 *
 * Drift on its own is a fact about one session — the agent went somewhere it
 * was not sent, which happens and is usually fine. Drift onto the same file in
 * session after session is a fact about the repository: something there is
 * load-bearing and nobody has said so out loud. That is the whole claim this
 * file makes, and it is made from the record alone — how often a path appeared
 * in `drift`, whether a later session declared it in `scope`, and what those
 * sessions cost. No model is asked whether the file is bad code.
 *
 * Three thresholds carry it, and each one is a refusal to say more than the
 * log supports:
 *
 * - **Three drifts, not one.** Once is an accident and twice is a coincidence;
 *   a list that started at one would be a list of everything that changed.
 * - **A later declaration clears it.** The moment somebody writes the path
 *   into a scope, the gap between plan and reality closes — that is the tool
 *   working, and a file that stayed on the list afterwards would punish the
 *   person who fixed it.
 * - **Three sessions of history, or no answer at all.** Below that a repo has
 *   no pattern to have, and "no debt" and "not enough to tell" are different
 *   statements — see `RepoDebt.files`.
 */

/** How many sessions have to drift onto a path before it is debt. */
export const MIN_DRIFTS = 3;

/** How many recorded sessions a repo needs before any of this is worth saying. */
export const MIN_HISTORY = 3;

/**
 * Classes that are never debt, however often they drift.
 *
 * Docs, config and build files are touched by everything and owned by nobody:
 * a lockfile, a CI workflow and a changelog turn up outside the plan of half
 * the sessions in any repo, because the plan was about the code and these came
 * along with it. Leaving them in would put the same four paths at the top of
 * every repo's list and bury the ones that mean something.
 *
 * Read off `classify.ts`, the same table `week --class` and `estimate` use.
 * A repo whose layout keeps landing the wrong file here is fixed by a line in
 * that table, not by a second list of exceptions here.
 */
export const IGNORED_CLASSES: readonly SessionClass[] = ["docs", "config", "build"];

/**
 * What the sessions behind one debt file cost.
 *
 * The same rule the rest of the tool follows: what can be priced is totalled,
 * what cannot is counted and named, and no model is ever priced at a nearby
 * model's rate. Rendered through `unpricedThroughout`, so a file whose
 * sessions could none of them be priced says so rather than reading `$0.00`.
 */
export interface DebtSpend {
  usd: number;
  /** How many of those sessions carried a model no rate covers. */
  unpriced: number;
  /** Which models those were, distinct and sorted. */
  unpricedModels: string[];
  /**
   * How many of them had nothing captured at all — no turns, so no tokens and
   * no model. Kept apart from `unpriced` for the reason `Spend.uncaptured`
   * is: a rate fixes one of these and nothing fixes the other.
   */
  uncaptured: number;
}

/** One file that keeps being changed by sessions that never declared it. */
export interface DebtFile {
  path: string;
  /** How many sessions drifted onto it. Counted once per session. */
  sessions: number;
  /**
   * When the last of them touched it: that session's end, or its start while
   * it is still running. ISO-8601.
   *
   * The end, because drift is observed at `stop` — that is when the file was
   * seen to have changed. A session still open has not been observed yet, and
   * its start is the last thing about it that is known.
   */
  lastTouched: string;
  /**
   * What the sessions that drifted onto it cost, in total.
   *
   * The whole of each session, not a share of it: there is no way to divide a
   * session's tokens between the files it touched, and inventing one would put
   * a made-up figure next to measured ones. It is the cost of the sessions
   * this file was part of, and the view says it in those words.
   *
   * Which is also why these never add up. One session drifting onto four files
   * appears in four rows, so a column of them has no total — nothing here
   * offers one, and no view may print one.
   */
  spend: DebtSpend;
}

/** One repository's debt, and how much history it was read off. */
export interface RepoDebt {
  repo: string;
  /** Sessions recorded for this repo — the history the answer rests on. */
  history: number;
  /**
   * The files, worst first. **Absent** — not empty — when `history` is under
   * `MIN_HISTORY`.
   *
   * The distinction is the point. An empty list says this repo has no debt,
   * which is a finding; an absent one says the log is too short to have found
   * anything, which is not the same statement and must not be printed as if it
   * were. Same shape as `EstimateGroup.figures`, for the same reason.
   */
  files?: DebtFile[];
}

/** What `session debt` found: one entry per repository, never a total. */
export interface DebtReport {
  repos: RepoDebt[];
}

/**
 * The debt in a set of sessions, one repository at a time.
 *
 * **Never aggregated across repos.** Debt is a claim about one codebase — the
 * same path means different things in two of them, and a file three repos
 * drifted onto once each is not a file three sessions drifted onto. Grouping
 * happens here, in the pure half, so no caller can pool them by accident.
 *
 * Expects sessions oldest first, as `readSessions` returns them. Order is what
 * decides "after": a scope clears a path when it was declared by a session
 * later in this list than the last one that drifted onto it. Timestamps would
 * be the same answer with a tie nobody can break — two sessions started in the
 * same second are ordered by the log, which is the order they were written in.
 */
export function debtOf(sessions: readonly Session[], rates: RateTable): DebtReport {
  const byRepo = new Map<string, Session[]>();
  for (const session of sessions) {
    const existing = byRepo.get(session.repo);
    if (existing) {
      existing.push(session);
    } else {
      byRepo.set(session.repo, [session]);
    }
  }

  const repos = [...byRepo]
    .map(([repo, group]) => repoDebt(repo, group, rates))
    // By name, not by how much debt each has. A league table across repos is
    // the aggregation this file refuses to do, arriving by way of a sort.
    .sort((a, b) => a.repo.localeCompare(b.repo));

  return { repos };
}

/** One repository: its history, and what that history is long enough to say. */
function repoDebt(repo: string, sessions: readonly Session[], rates: RateTable): RepoDebt {
  if (sessions.length < MIN_HISTORY) {
    return { repo, history: sessions.length };
  }
  return { repo, history: sessions.length, files: debtFiles(sessions, rates) };
}

/** Where a path stands: which sessions drifted onto it, and the last that did. */
interface Drifted {
  /** Indices into the session list, ascending. */
  sessions: number[];
  lastDrift: number;
}

/**
 * The files of one repository that are debt, worst first.
 *
 * Ties break on the path so two runs produce the same list; a report whose
 * rows move between runs is one nobody can diff.
 */
function debtFiles(sessions: readonly Session[], rates: RateTable): DebtFile[] {
  const drifted = driftIndex(sessions);

  const files: DebtFile[] = [];
  for (const [path, seen] of drifted) {
    if (seen.sessions.length < MIN_DRIFTS || declaredAfter(sessions, path, seen.lastDrift)) {
      continue;
    }
    const touched = seen.sessions.map((index) => sessions[index] as Session);
    files.push({
      path,
      sessions: touched.length,
      lastTouched: lastTouchedAt(touched[touched.length - 1] as Session),
      spend: spendOfDebt(touched, rates),
    });
  }

  return files.sort((a, b) => b.sessions - a.sessions || a.path.localeCompare(b.path));
}

/**
 * Every path that drifted, and where.
 *
 * Counted once per session — a session that touched one file forty times is
 * one session — and the classes nobody owns are dropped here, before anything
 * counts them, so they cannot reach a threshold they are exempt from anyway.
 */
function driftIndex(sessions: readonly Session[]): Map<string, Drifted> {
  const drifted = new Map<string, Drifted>();

  sessions.forEach((session, index) => {
    for (const path of new Set(session.drift)) {
      if (IGNORED_CLASSES.includes(classOfPath(path))) {
        continue;
      }
      const seen = drifted.get(path);
      if (seen) {
        seen.sessions.push(index);
        seen.lastDrift = index;
      } else {
        drifted.set(path, { sessions: [index], lastDrift: index });
      }
    }
  });

  return drifted;
}

/**
 * Whether anybody declared this path after the last session that drifted onto
 * it — which is what clears it.
 *
 * Through the same scope rule `stop` computes drift with, so a directory
 * declared as `src/api/` clears every file under it. Matching the path
 * literally instead would leave a file in debt for as long as its directory
 * was the thing declared, which is the normal way to declare it.
 */
function declaredAfter(sessions: readonly Session[], path: string, lastDrift: number): boolean {
  return sessions
    .slice(lastDrift + 1)
    .some((session) => inScope(session.scope, path));
}

/** When a session's changes were observed: at its stop, or not yet. */
function lastTouchedAt(session: Session): string {
  return session.endedAt ?? session.startedAt;
}

/**
 * What a debt file's sessions cost.
 *
 * Unpriced sessions are counted rather than dropped, and a session that moved
 * no tokens at all is not reported as a gap: it needs no rate, so nothing is
 * missing. The same two rules `spendOf` and `spendOfScanned` follow.
 *
 * Deliberately not `spendOf`. That one splits the money by `outcome`, and
 * `outcome` on a stored record is only what `settle` last wrote — this report
 * reads logs from repositories it is not standing in and cannot recompute it,
 * so it reports no figure that depends on it rather than quoting a stale one.
 */
function spendOfDebt(sessions: readonly Session[], rates: RateTable): DebtSpend {
  const models = new Set<string>();
  let usd = 0;
  let unpriced = 0;
  let uncaptured = 0;

  for (const session of sessions) {
    // `wasMeasured` first, as in `spendOf`: a session with no turns has no
    // model to look up, and totalling it as nought would say the work on this
    // file was free when what happened is that nothing was captured.
    if (!wasMeasured(session.cost)) {
      uncaptured += 1;
      continue;
    }
    const price = priceSession(session.cost, rates);
    if (isPriced(price)) {
      usd += price.usd;
    } else {
      unpriced += 1;
      models.add(session.cost.model === "" ? "unknown" : session.cost.model);
    }
  }

  return { usd, unpriced, unpricedModels: [...models].sort(), uncaptured };
}
