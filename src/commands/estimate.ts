import {
  classOf,
  classifyIntent,
  classifyPaths,
  type SessionClass,
} from "../classify.js";
import { withOutcomes } from "../observe.js";
import { isTerminal, observations } from "../outcome.js";
import { formatUsd, isPriced, priceSession, type RateTable } from "../pricing.js";
import {
  isCaptured,
  readSessions,
  type Session,
  type SessionOutcome,
  type StoreOptions,
} from "../store.js";

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
const DRIFT_SHOWN = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

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
  median: number;
  p90: number;
  /** Sessions that had landed the first time anyone looked. */
  mergedFirstTime: number;
  /** Sessions that were decided at all — the denominator of that rate. */
  decided: number;
  /** Matched sessions still in flight, which no rate can be asked about yet. */
  open: number;
  /**
   * Matched sessions that declared a scope to drift from — the denominator of
   * the drift counts, and not the same as `matched` once the hook is
   * recording sessions nobody declared. Those cannot drift, so counting them
   * in would report a path as rarer than it was.
   */
  declared: number;
  /** The paths that most often turned up as drift, commonest first. */
  drift: DriftCount[];
}

export interface Estimate {
  /** The intent as it was asked, echoed so the answer names its question. */
  intent: string;
  class: SessionClass;
  source: ClassSource;
  /** The cutoff as a date, when `--since` set one. */
  since?: string;
  /** How many past sessions of this class were found — the empty ones aside. */
  matched: number;
  /**
   * Sessions of this class that changed no files, left out of everything
   * above. Counted and printed rather than silently dropped: how often a
   * session comes to nothing is worth knowing, and a sample that quietly
   * shrank would be a sample nobody could check.
   */
  empty: number;
  /** Absent when `matched` is under `MIN_SESSIONS`. */
  figures?: EstimateFigures;
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
 * The figures over a set of matched sessions. Pure; the rates come from above.
 *
 * Expects the empty sessions to be out already — `estimateFor` removes them
 * before anything here counts anything.
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
    // Zero when nothing could be priced. The `priced` count beside it is what
    // says whether that is a figure or a hole, and the view prints both.
    median: costs.length > 0 ? median(costs) : 0,
    p90: costs.length > 0 ? percentile(costs, 0.9) : 0,
    mergedFirstTime: decided.filter((outcome) => outcome === "merged").length,
    decided: decided.length,
    open: sessions.length - decided.length,
    declared: sessions.filter((session) => !isCaptured(session)).length,
    drift: driftPaths(sessions),
  };
}

// --- reading the log -----------------------------------------------------

/**
 * Past sessions of the class this intent reads as, and what they came to.
 *
 * Only sessions that stopped: an open one has no cost worth quoting and no end
 * to have merged. Outcomes are resolved for the matches alone — which class a
 * session was is a fact about its paths, so the repository need only be asked
 * about the ones that survive the filter.
 *
 * Sessions that changed no files come out before anything is counted. The
 * question this answers is what work like this has cost and how often it
 * landed, and a session that attempted nothing is not an instance of the work:
 * it would drag the median down, and it would sit in the merge rate's
 * denominator as a session that failed to merge when there was nothing to
 * merge. What it did cost is real, which is why it is still reported — as its
 * own count, in its own words.
 */
export async function estimateFor(
  request: EstimateRequest,
  rates: RateTable,
  options: StoreOptions = {},
): Promise<Estimate> {
  const choice = chooseClass(request);
  const sessions = await readSessions(options);

  const past = sessions.filter(
    (session) =>
      session.endedAt !== null &&
      (request.since === undefined || Date.parse(session.startedAt) >= request.since) &&
      classOf(session) === choice.class,
  );
  const resolved = await withOutcomes(past, options.cwd ?? process.cwd());
  const matched = resolved.filter((session) => session.outcome !== "empty");

  return {
    intent: request.intent,
    class: choice.class,
    source: choice.source,
    ...(request.since === undefined
      ? {}
      : { since: new Date(request.since).toISOString().slice(0, 10) }),
    matched: matched.length,
    empty: resolved.length - matched.length,
    ...(matched.length >= MIN_SESSIONS ? { figures: summarize(matched, rates) } : {}),
  };
}

// --- the view ------------------------------------------------------------

const LABEL_WIDTH = 10;
/** Where the note beside the class starts, so the two read as two columns. */
const NOTE_COLUMN = 12;

function line(label: string, value: string): string {
  return `  ${label.padEnd(LABEL_WIDTH)}${value}`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** How the class was arrived at, said out loud so a wrong one can be seen. */
const SOURCES: Record<ClassSource, string> = {
  declared: "you said so",
  scope: "from --scope",
  intent: "from the intent",
};

function percent(part: number, whole: number): string {
  return `${Math.round((part / whole) * 100)}%`;
}

/**
 * The estimate as `session estimate` prints it.
 *
 * The sample comes before the figures, in that order on purpose: what the
 * numbers are made of decides how much to believe them, and a median with no
 * count beside it is a number pretending to be an answer.
 */
export function formatEstimate(estimate: Estimate): string[] {
  const window = estimate.since === undefined ? "" : ` since ${estimate.since}`;
  const sample = `${plural(estimate.matched, "session", "sessions")}${window}`;

  const lines = [
    "",
    line("estimate", estimate.intent),
    line("class", `${estimate.class.padEnd(NOTE_COLUMN)}${SOURCES[estimate.source]}`),
    line("like it", sample),
  ];

  // Beside the sample, not after the figures: it says what the sample is not,
  // and that belongs where the reader is deciding how much to believe it.
  if (estimate.empty > 0) {
    lines.push(
      line(
        "left out",
        `${plural(estimate.empty, "session", "sessions")} changed no files — nothing ` +
          `was attempted, so there is nothing to estimate from`,
      ),
    );
  }

  const figures = estimate.figures;
  if (!figures) {
    // What was found and what would make it enough. The alternative is a
    // median of two, which is the kind of number that ends up in a quote.
    lines.push(
      line("too few", `nothing is estimated from fewer than ${MIN_SESSIONS} sessions`),
      line("", "widen --since, or say --class if these were the wrong ones"),
    );
    return lines;
  }

  lines.push("");

  if (figures.priced > 0) {
    lines.push(line("median", formatUsd(figures.median)));
    lines.push(line("p90", formatUsd(figures.p90)));
  } else {
    lines.push(line("cost", "no price for any of these models — see ~/.session/rates.json"));
  }

  if (figures.decided > 0) {
    const rate = percent(figures.mergedFirstTime, figures.decided);
    const still = figures.open > 0 ? `, ${figures.open} still open` : "";
    lines.push(
      line("merged", `${figures.mergedFirstTime} of ${figures.decided} first time (${rate})${still}`),
    );
  } else {
    lines.push(line("merged", `nothing has been settled yet, so there is no rate to give`));
  }

  // The paths under a column of their own, so a list of five can be read down
  // rather than across. Only the first line carries the label.
  //
  // Counted over the sessions that declared a scope rather than over the whole
  // sample: a session the hook recorded had nothing to drift from, and putting
  // it in the denominator would report a path as turning up in a smaller share
  // of the work than it did.
  const width = figures.drift.reduce((widest, entry) => Math.max(widest, entry.path.length), 0);
  for (const [index, entry] of figures.drift.entries()) {
    const count = `${entry.sessions} of ${figures.declared}`;
    lines.push(line(index === 0 ? "drift" : "", `${entry.path.padEnd(width + 2)}${count}`));
  }

  // Said whenever the two differ, because "2 of 7" under a sample of twelve is
  // a figure the reader would otherwise have to reconcile on their own.
  if (figures.declared < estimate.matched) {
    lines.push(
      line(
        figures.drift.length > 0 ? "" : "drift",
        `${plural(estimate.matched - figures.declared, "session", "sessions")} here declared no ` +
          `scope, so nothing they changed counts as drift`,
      ),
    );
  }

  if (figures.unpriced > 0) {
    // Said out loud, because the figures above are over the rest.
    lines.push(
      line(
        "unpriced",
        `${plural(figures.unpriced, "session", "sessions")} ran on a model with no rate; ` +
          `the money above is the other ${figures.priced}`,
      ),
    );
  }

  return lines;
}
