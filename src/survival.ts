// Whether merged work is still there weeks later. Pure: sessions in, figures
// out. Reading the repository happens in `commands/survival.ts`.
import { classOf, SESSION_CLASSES, type SessionClass } from "./classify.js";
import { MIN_SESSIONS } from "./estimate/figures.js";
import { observations } from "./outcome.js";
import { intentSourceOf, type IntentSource, type Session } from "./store.js";

/**
 * Merging is not the end of the question.
 *
 * A session merges and the tool records that it landed. Three weeks later the
 * file it wrote may hold none of what it wrote — reverted, rewritten by the
 * next person through, or deleted outright. That is the difference between
 * work that shipped and work that stuck, and nothing in the log answered it
 * until this: `outcome` says the blobs reached the branch once, which is a
 * fact about a moment and not about what came after.
 *
 * So the check is repeated on a schedule — at 14 and at 30 days past the merge
 * — and **written down**. It has to be written down, because it cannot be
 * recomputed: the branch tip today says what is there today, and a session
 * whose file was rewritten on day 20 and restored on day 40 looks untouched to
 * anyone asking in year two. An observation stamped with the day it was made
 * is the only form this answer keeps.
 *
 * Everything here is a share of paths that were still holding the session's
 * blobs when somebody looked. No model, no judgement about whether being
 * rewritten was deserved — being rewritten is not failure, and the tool does
 * not say it is. It reports the figure and the benchmark, and what to make of
 * that is the reader's.
 */

/** Days after the merge a check falls due. */
export const SURVIVAL_WINDOWS = [14, 30] as const;

export type SurvivalWindow = (typeof SURVIVAL_WINDOWS)[number];

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long after a window closes a check still counts as that window's.
 *
 * A week, because nobody runs a tool daily and a check on day 15 is plainly
 * still the fourteen-day answer. Past that it is not: the branch tip on day
 * 200 says what is true on day 200, and a file rewritten on day 20 and
 * restored on day 60 would be recorded as having survived a window it did not.
 * Those are `missed` — the question was answerable once and is not now, which
 * is a different thing from the answer being no.
 */
export const CHECK_GRACE_DAYS = 7;

/**
 * The published figures this reports against: above 90% of code surviving,
 * below 10% churned.
 *
 * One threshold, quoted from both ends — churn here is exactly the share that
 * did not survive, so 90% survival and 10% churn are the same line. It is
 * stated as one constant for that reason; two would be two things to keep in
 * step, and the day they disagreed the report would contradict itself in
 * consecutive lines.
 *
 * It is somebody else's number, not a measurement this tool made. It is here
 * so a reader has something to sit their own figure against, and it is one
 * constant so that disagreeing with it is a one-line change.
 */
export const SURVIVAL_BENCHMARK = 0.9;

/** What became of one path's content by the time somebody looked. */
export type PathFate = "survived" | "rewritten" | "deleted";

/**
 * A dated answer to "is it still there", written into the log.
 *
 * Recorded per path rather than as a rate: the rate is arithmetic anybody can
 * redo, and the paths are the evidence it was done on. A record holding only
 * `0.75` could never be checked, split by directory, or read by somebody who
 * wanted to know *which* file went.
 */
export interface SurvivalObservation {
  /** Which check this is: 14 days after the merge, or 30. */
  window: SurvivalWindow;
  /** When the check was made. ISO-8601. */
  observedAt: string;
  /** The default branch's tip it was made against. */
  commit: string;
  /** The branch it was checked on, e.g. `origin/main`. */
  branch: string;
  /** One entry per path the session left an end state for. */
  fates: Record<string, PathFate>;
}

// --- reading one session -------------------------------------------------

/** Every survival check recorded against a session, oldest first. */
export function survivalObservations(session: Session): readonly SurvivalObservation[] {
  return session.survival ?? [];
}

/**
 * When the merge was first observed, which is what the windows count from.
 *
 * The first observation saying `merged`, not the session's own end and not the
 * date of any commit. It is worth being exact about what this is: nothing on
 * disk records the moment work landed, and nothing can — a squash merge writes
 * a new commit with its own dates and keeps none of the originals. What the
 * log holds is the day somebody looked and found it there, so that is what the
 * fourteen days are counted from, and a session settled late has late windows.
 *
 * Undefined for a session no `settle` or `mark` has yet called merged. There
 * is no date to count from, so there is no check to be due — see `unsettled`
 * on the report, which counts them rather than dropping them.
 */
export function mergedAt(session: Session): string | undefined {
  return observations(session).find((observation) => observation.outcome === "merged")?.observedAt;
}

/** When a window closes for a session, in epoch ms. */
export function dueAt(session: Session, window: SurvivalWindow): number | undefined {
  const merged = mergedAt(session);
  return merged === undefined ? undefined : Date.parse(merged) + window * DAY_MS;
}

/** Where one session stands for one window. */
export type WindowState =
  /** Checked, and the answer is on the record. */
  | "measured"
  /** Merged too recently for the window to have closed. Never a failure. */
  | "pending"
  /** The window has closed and nobody has looked yet; still answerable. */
  | "due"
  /** Closed too long ago to answer: the tip today is not evidence about then. */
  | "missed"
  /** Merged, but nothing has recorded when — so no window can be placed. */
  | "unsettled";

/**
 * Where a session stands for a window, from the record and the clock alone.
 *
 * `pending` before anything else that is not already written down: a session
 * merged the day before yesterday has not failed to survive a fortnight, and
 * counting it anywhere but its own line would be counting the calendar as
 * churn.
 */
export function stateOf(session: Session, window: SurvivalWindow, now: number): WindowState {
  if (survivalObservations(session).some((observation) => observation.window === window)) {
    return "measured";
  }
  const due = dueAt(session, window);
  if (due === undefined) {
    return "unsettled";
  }
  if (now < due) {
    return "pending";
  }
  return now <= due + CHECK_GRACE_DAYS * DAY_MS ? "due" : "missed";
}

/**
 * What became of one path: the blob the session left, against what is at that
 * path on the branch now.
 *
 * A session that deleted a file left `null`, and the file staying gone is that
 * deletion surviving. Something back at the path means somebody put it there,
 * which is the deletion being undone — `rewritten`, the same word the other
 * direction gets, because from here they are the same event: what the session
 * left is not what is there.
 */
export function fateOf(recorded: string | null, current: string | undefined): PathFate {
  if (recorded === null) {
    return current === undefined ? "survived" : "rewritten";
  }
  if (current === undefined) {
    return "deleted";
  }
  return current === recorded ? "survived" : "rewritten";
}

/** The three counts and the total, over one observation's paths. */
export function countFates(observation: SurvivalObservation): SurvivalCounts {
  const counts: SurvivalCounts = { paths: 0, survived: 0, rewritten: 0, deleted: 0 };
  for (const fate of Object.values(observation.fates)) {
    counts.paths += 1;
    counts[fate] += 1;
  }
  return counts;
}

/**
 * One session's survival rate: the share of its paths that survived.
 *
 * Undefined for an observation over no paths, which is not a rate of nought —
 * see the report, which never renders one for a group with nothing in it.
 */
export function rateOf(observation: SurvivalObservation): number | undefined {
  const { paths, survived } = countFates(observation);
  return paths === 0 ? undefined : survived / paths;
}

// --- the report ----------------------------------------------------------

/** Paths, split by what became of them. */
export interface SurvivalCounts {
  paths: number;
  survived: number;
  rewritten: number;
  deleted: number;
}

/** What a group of measured sessions came to. */
export interface SurvivalFigures extends SurvivalCounts {
  /** Share of paths still holding what the session left. */
  rate: number;
  /** Share that did not: rewritten or deleted. The benchmark's other end. */
  churn: number;
}

/**
 * One group — every session, one class, or one intent source — at one window.
 *
 * The four session counts are always present and the figures may not be.
 * Nothing is inferred from a missing block: `measured` says how many sessions
 * the rate is over, `pending` how many are too young to ask about, `due` how
 * many are waiting on a check somebody has not run, and `missed` how many can
 * no longer be answered at all. A reader who sees no rate can tell which of
 * those four it is.
 */
export interface SurvivalSample {
  /** Sessions with a check on the record for this window. */
  measured: number;
  /** Merged too recently for the window to have closed. */
  pending: number;
  /** The window has closed, and the check has not been run. */
  due: number;
  /** Closed too long ago to be answerable now. */
  missed: number;
  /**
   * Absent below `MIN_SESSIONS` measured sessions, and absent when they hold
   * no paths between them. A rate over two sessions looks like knowledge and
   * is not — the same floor `estimate` prints its sample under.
   */
  figures?: SurvivalFigures;
}

/** One window's answer, whole. */
export interface WindowReport {
  window: SurvivalWindow;
  overall: SurvivalSample;
  /** One row per class that has a session in it, in the table's own order. */
  byClass: { class: SessionClass; sample: SurvivalSample }[];
  /** Sessions whose intent was declared at `session start`. */
  declared: SurvivalSample;
  /** Sessions whose intent the hook took from the first prompt. */
  captured: SurvivalSample;
}

export interface SurvivalReport {
  windows: WindowReport[];
  /**
   * Merged sessions with no observation saying when. Nothing can be placed in
   * a window for them; `session settle` is what gives them a date.
   */
  unsettled: number;
  /** Merged sessions the report is drawn from, whatever state they are in. */
  sessions: number;
}

/** True when a rate is at or above the published benchmark. */
export function meetsBenchmark(rate: number): boolean {
  return rate >= SURVIVAL_BENCHMARK;
}

/**
 * The whole report, over sessions whose outcomes have already been resolved.
 *
 * **Expects `outcome` to hold what the repository says now** — `withOutcomes`
 * has run — the same contract `week`'s filters work under. Reading the stored
 * field here would ask whether work survived of sessions that never merged.
 *
 * Only merged sessions are in scope at all. An abandoned one has nothing to
 * survive, and counting it as not surviving would be counting the same fact
 * twice under a second name.
 */
export function summarizeSurvival(
  sessions: readonly Session[],
  now: number = Date.now(),
): SurvivalReport {
  const merged = sessions.filter((session) => session.outcome === "merged");

  return {
    sessions: merged.length,
    unsettled: merged.filter((session) => mergedAt(session) === undefined).length,
    windows: SURVIVAL_WINDOWS.map((window) => windowReport(merged, window, now)),
  };
}

/** One window, split every way the report splits it. */
function windowReport(
  merged: readonly Session[],
  window: SurvivalWindow,
  now: number,
): WindowReport {
  const sampleOf = (group: readonly Session[]): SurvivalSample => sample(group, window, now);

  return {
    window,
    overall: sampleOf(merged),
    // Table order, and only the classes that have something in them: a row of
    // dashes for a class this repo has never worked in says nothing.
    byClass: SESSION_CLASSES.map((name) => ({
      class: name,
      sample: sampleOf(merged.filter((session) => classOf(session) === name)),
    })).filter((row) => hasSessions(row.sample)),
    declared: sampleOf(bySource(merged, "declared")),
    captured: sampleOf(bySource(merged, "captured")),
  };
}

function bySource(sessions: readonly Session[], source: IntentSource): Session[] {
  return sessions.filter((session) => intentSourceOf(session) === source);
}

/** True when a group has any session in it, in any state. */
function hasSessions(sample: SurvivalSample): boolean {
  return sample.measured + sample.pending + sample.due + sample.missed > 0;
}

/**
 * One group's counts, and its figures where there are enough sessions to carry
 * them.
 *
 * The rate is over **paths, not sessions**: a session that touched forty files
 * is forty files' worth of evidence about whether work sticks, and averaging
 * the session rates would weigh a one-file session the same. `MIN_SESSIONS`
 * still counts sessions, because the thing that has to be numerous enough to
 * generalise from is the work, not the files it happened to touch.
 */
export function sample(
  sessions: readonly Session[],
  window: SurvivalWindow,
  now: number,
): SurvivalSample {
  const states = sessions.map((session) => stateOf(session, window, now));
  const counted = (state: WindowState): number =>
    states.filter((value) => value === state).length;

  const result: SurvivalSample = {
    measured: counted("measured"),
    pending: counted("pending"),
    due: counted("due"),
    missed: counted("missed"),
  };

  const figures = figuresFor(sessions, window);
  if (result.measured >= MIN_SESSIONS && figures) {
    result.figures = figures;
  }
  return result;
}

/** The counts over every measured session in a group, or nothing to count. */
function figuresFor(
  sessions: readonly Session[],
  window: SurvivalWindow,
): SurvivalFigures | undefined {
  const counts: SurvivalCounts = { paths: 0, survived: 0, rewritten: 0, deleted: 0 };

  for (const session of sessions) {
    const observation = survivalObservations(session).find(
      (candidate) => candidate.window === window,
    );
    if (!observation) {
      continue;
    }
    const seen = countFates(observation);
    counts.paths += seen.paths;
    counts.survived += seen.survived;
    counts.rewritten += seen.rewritten;
    counts.deleted += seen.deleted;
  }

  if (counts.paths === 0) {
    return undefined;
  }
  return {
    ...counts,
    rate: counts.survived / counts.paths,
    churn: (counts.rewritten + counts.deleted) / counts.paths,
  };
}
