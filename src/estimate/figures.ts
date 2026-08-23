// What past sessions of a class came to. Pure: sessions in, figures out.
import { classOf, classifyIntent, classifyPaths, type SessionClass } from "../classify.js";
import { isTerminal, observations } from "../outcome.js";
import { isPriced, priceSession, type RateTable } from "../pricing.js";
import { intentSourceOf, type IntentSource, type Session, type SessionOutcome } from "../store.js";

/**
 * What sessions like this one have cost before.
 *
 * Every figure here is a fact about sessions that already ran, restated. There
 * is no model of the work and no prediction: the median of nine past api
 * sessions is the median of nine past api sessions, and whether the tenth
 * behaves like them is the reader's call, not this file's.
 *
 * Which is also why a thin sample reports nothing. Below `MIN_SESSIONS` the
 * count is printed and the figures are not — a median of two is a number that
 * looks like knowledge and is not.
 */

/** How many past sessions it takes before any figure is worth printing. */
export const MIN_SESSIONS = 5;

/** How many drift paths are listed. Past this it stops being a short answer. */
export const DRIFT_SHOWN = 5;

export const DAY_MS = 24 * 60 * 60 * 1000;

/** What the question was. */
export interface EstimateRequest {
  /** What the developer is setting out to do, in their words. */
  intent: string;
  /** The paths they expect to touch, if they said. A better signal than words. */
  scope?: string[];
  /** A class stated outright, when neither the words nor the paths get it right. */
  class?: SessionClass;
  /** Epoch ms; sessions that started before it are left out. */
  since?: number;
}

/** Where the class being estimated came from. Printed, so a bad one is visible. */
export type ClassSource = "declared" | "scope" | "intent";

export interface ClassChoice {
  class: SessionClass;
  source: ClassSource;
}

/** One path that kept turning up outside the scope somebody declared. */
export interface DriftCount {
  path: string;
  /** How many of the matched sessions drifted onto it. */
  sessions: number;
}

/** The figures, present only once there are enough sessions to carry them. */
export interface EstimateFigures {
  /** Sessions that could be priced; the money below is over these. */
  priced: number;
  /** Sessions whose model no rate covers, left out of the money. */
  unpriced: number;
  /** Which models those were, distinct and sorted, so a stub can name them. */
  unpricedModels: string[];
  median: number;
  p90: number;
  /** Sessions that had landed the first time anyone looked. */
  mergedFirstTime: number;
  /** Sessions that were decided at all — the denominator of that rate. */
  decided: number;
  /** Matched sessions still in flight, which no rate can be asked about yet. */
  open: number;
  /** The paths that most often turned up as drift, commonest first. */
  drift: DriftCount[];
}

/**
 * One side of the sample: the sessions of this class whose intent came from
 * one place, and what they came to.
 *
 * The two are never pooled. A declared session is a commitment made before the
 * work — somebody wrote down what they were about to do and then did it — and
 * a captured one is a transcript of a prompt. Averaging them produces a figure
 * about neither: teams that adopt the hook record far more captured sessions
 * than declared ones, so a pooled median would drift towards whatever the hook
 * happened to catch and would move whenever the mix did, with nothing in the
 * output to say that was what changed.
 *
 * Which is also why `MIN_SESSIONS` applies to each side on its own. Six
 * declared and six captured sessions are not twelve of anything, and a
 * threshold that let them add up would be a way of reintroducing the pool
 * under a different name.
 */
export interface EstimateGroup {
  source: IntentSource;
  /** How many past sessions of this class and source — the empty ones aside. */
  matched: number;
  /**
   * Sessions of this class and source that changed no files, left out of
   * everything above. Counted and printed rather than silently dropped: how
   * often a session comes to nothing is worth knowing, and a sample that
   * quietly shrank would be a sample nobody could check.
   */
  empty: number;
  /** Absent when `matched` is under `MIN_SESSIONS`. */
  figures?: EstimateFigures;
}

export interface Estimate {
  /** The intent as it was asked, echoed so the answer names its question. */
  intent: string;
  class: SessionClass;
  source: ClassSource;
  /** The cutoff as a date, when `--since` set one. */
  since?: string;
  /** Sessions whose intent was written at `session start`, before the agent ran. */
  declared: EstimateGroup;
  /** Sessions whose intent was taken from the first prompt by the hook. */
  captured: EstimateGroup;
}

// --- reading the question ------------------------------------------------

/**
 * Reads `--since`: a number of days, or the date to start from.
 *
 * Both forms because both are asked: "the last month" and "since we moved off
 * the old model" are the same question with different anchors. Days are whole
 * for the reason `--days` on `week` gives — half a day is a boundary nobody
 * can hold in their head.
 */
export function parseSince(value: string, now: number = Date.now()): number {
  const wanted = value.trim();

  const days = /^(\d+)d?$/.exec(wanted);
  if (days) {
    const count = Number(days[1]);
    if (count < 1) {
      throw new Error(`--since takes a whole number of days, 1 or more. Got ${value}.`);
    }
    return now - count * DAY_MS;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(wanted)) {
    const at = Date.parse(wanted);
    if (!Number.isNaN(at)) {
      return at;
    }
  }

  throw new Error(
    `--since takes a number of days (30, 30d) or a date (2026-05-20). Got ${value}.`,
  );
}

/**
 * Which class is being asked about.
 *
 * Paths beat words, and a person beats both. An intent is a sentence written
 * before the work — "clean up the orders table code" reads as schema and may
 * touch none — while `--scope` is the same declaration `start` records and is
 * matched by the same rules the finished sessions were classified with.
 */
export function chooseClass(request: EstimateRequest): ClassChoice {
  if (request.class !== undefined) {
    return { class: request.class, source: "declared" };
  }
  if (request.scope && request.scope.length > 0) {
    return { class: classifyPaths(request.scope), source: "scope" };
  }
  return { class: classifyIntent(request.intent), source: "intent" };
}

// --- the figures ---------------------------------------------------------

/** The middle of the sorted values; the mean of the middle two when even. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] as number;
  }
  return ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/**
 * The value at a percentile, by nearest rank — an amount some session actually
 * cost, not one interpolated between two of them. With nine sessions there is
 * nothing to interpolate from, and a figure nobody was ever billed would read
 * as a measurement.
 */
export function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(fraction * sorted.length));
  return sorted[rank - 1] as number;
}

/**
 * Where the session stood the first time anyone looked.
 *
 * The first terminal observation on the record, which is the first time the
 * question was asked and answered. For a session nobody has settled, now is
 * that first look — `withOutcomes` has already put the computed answer on the
 * field by the time this runs.
 *
 * This is what makes the rate a rate about work rather than about persistence:
 * a session that was abandoned, revisited and landed a month later merged, but
 * it did not merge the first time.
 */
export function firstLook(session: Session): SessionOutcome {
  const first = observations(session).find((observation) => isTerminal(observation.outcome));
  return first ? first.outcome : session.outcome;
}

/**
 * The paths that turned up as drift most often, commonest first, ties broken
 * by path so two runs agree. Counted once per session: a session that drifted
 * onto one file is one session, however many times it touched it.
 */
export function driftPaths(
  sessions: readonly Session[],
  limit: number = DRIFT_SHOWN,
): DriftCount[] {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    for (const path of new Set(session.drift)) {
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
  }

  return [...counts]
    .map(([path, sessions]) => ({ path, sessions }))
    .sort((a, b) => b.sessions - a.sessions || a.path.localeCompare(b.path))
    .slice(0, limit);
}

/**
 * The figures over one group's matched sessions. Pure; the rates come from
 * above.
 *
 * Expects one intent source and no empty sessions — `groupFor` splits and
 * filters before anything here counts anything. It does not check either:
 * a summary of a mixed set is a summary of nothing in particular, and the
 * caller is the only thing that knows which set it handed over.
 */
export function summarize(
  sessions: readonly Session[],
  rates: RateTable,
): EstimateFigures {
  const prices = sessions.map((session) => priceSession(session.cost, rates));
  const costs = prices.filter(isPriced).map((price) => price.usd);

  const looks = sessions.map(firstLook);
  const decided = looks.filter(isTerminal);

  return {
    priced: costs.length,
    unpriced: sessions.length - costs.length,
    unpricedModels: [
      ...new Set(prices.filter((price) => !isPriced(price)).map((price) => price.model)),
    ].sort(),
    // Zero when nothing could be priced. The `priced` count beside it is what
    // says whether that is a figure or a hole, and the view prints both.
    median: costs.length > 0 ? median(costs) : 0,
    p90: costs.length > 0 ? percentile(costs, 0.9) : 0,
    mergedFirstTime: decided.filter((outcome) => outcome === "merged").length,
    decided: decided.length,
    open: sessions.length - decided.length,
    drift: driftPaths(sessions),
  };
}

// --- reading the log -----------------------------------------------------

/**
 * One group's counts and figures.
 *
 * The empty sessions come out here rather than before the split, so that each
 * side reports the ones that were its own. How often a session comes to
 * nothing is not the same question for work somebody declared and work the
 * hook happened to catch, and a single pooled count of empties would hide
 * exactly that difference.
 */
export function groupFor(
  source: IntentSource,
  sessions: readonly Session[],
  rates: RateTable,
): EstimateGroup {
  const matched = sessions.filter((session) => session.outcome !== "empty");

  return {
    source,
    matched: matched.length,
    empty: sessions.length - matched.length,
    ...(matched.length >= MIN_SESSIONS ? { figures: summarize(matched, rates) } : {}),
  };
}

/** True of a session this estimate can be made from: stopped, recent, alike. */
export function comparable(
  session: Session,
  request: EstimateRequest,
  wanted: SessionClass,
): boolean {
  return (
    session.endedAt !== null &&
    (request.since === undefined || Date.parse(session.startedAt) >= request.since) &&
    classOf(session) === wanted
  );
}
