// What agent sessions already on disk have cost, added up. Pure: sessions and
// rates in, one report out. Nothing here reads a file, runs git, or knows
// where a transcript lives — see `commands/scan.ts` for that half.
//
// The split is the point. Reading fourteen megabytes of somebody else's JSONL
// is awkward to test and the arithmetic on top of it is what goes on an
// invoice, so the arithmetic is kept somewhere it can be tested with a
// literal.
import { isPriced, priceSession, type Price, type RateTable } from "./pricing.js";
import type { SessionCost } from "./store.js";

/**
 * One transcript, read as a session.
 *
 * Not a `Session`: nothing here was declared, nothing was scoped, and no
 * record of it exists. `scan` reports what it finds without writing anything
 * down, so this shape is what a transcript can say for itself and no more.
 */
export interface ScannedSession {
  /** The transcript's own id — its file name, which Claude Code makes a uuid. */
  id: string;
  /**
   * The checkout the work ran in: the repo root where there is one, else the
   * working directory the transcript reported. Empty where it reported none.
   */
  repo: string;
  /** The first prompt of the session, for use as a label. */
  label: string;
  /** ISO-8601, the first call counted. */
  startedAt: string;
  /** ISO-8601, the last call counted. */
  endedAt: string;
  cost: SessionCost;
  /**
   * Whether this session's window overlaps commits that landed on the default
   * branch. Absent where the repo is not a git checkout or has no default
   * branch — which is not the same as `false`, and is why this is optional
   * rather than defaulted.
   *
   * An overlap is a coincidence in time, never a claim that this session
   * produced that commit. Nothing here has a diff to compare, so nothing here
   * may say what `outcome.ts` says.
   */
  landed?: boolean;
}

/**
 * Money over a set of scanned sessions, and what could not be answered.
 *
 * The same shape `spendOf` returns for recorded sessions, less `unmerged`:
 * scan has no outcome to divide the money by, and inventing one from a
 * timestamp overlap would be a figure with a fact's shape.
 */
export interface ScanSpend {
  usd: number;
  /** Of that, what went on turns that changed no files. */
  emptyUsd: number;
  /** How many sessions carried a model no rate covers. */
  unpriced: number;
  /** Which models those were, distinct and sorted. */
  unpricedModels: string[];
}

/** One repository's row in the table. */
export interface RepoRow {
  repo: string;
  sessions: number;
  spend: ScanSpend;
  turns: number;
  /** Turns that produced nothing — the figure the table is for. */
  emptyTurns: number;
}

/** What `scan` found, in the order it is reported. */
export interface ScanReport {
  days: number;
  sessions: number;
  spend: ScanSpend;
  turns: number;
  emptyTurns: number;
  /** One row per repository, dearest first. */
  repos: RepoRow[];
  /** The three dearest sessions. Fewer where fewer could be priced. */
  top: TopSession[];
  /**
   * Sessions whose window overlapped a commit reaching the default branch.
   *
   * A coincidence in time. Nothing here compares a diff, so this is never
   * called merged — see `ScannedSession.landed`.
   */
  landed: number;
  /**
   * Sessions in a checkout that could not be asked: no git, no default
   * branch, a directory since deleted. Counted apart from `landed` because
   * not knowing is not the same answer as no.
   */
  landingUnknown: number;
  /**
   * How many sessions could not be ranked, because no rate covers the model
   * they ran on. Named rather than dropped: three dearest out of a set where
   * nine were unpriceable is not the three dearest.
   */
  unrankable: number;
}

/** A session that could be priced, and what it came to. */
export interface TopSession {
  session: ScannedSession;
  usd: number;
}

/** Where a session with no working directory is filed. */
export const UNKNOWN_REPO = "";

function emptyScanSpend(): ScanSpend {
  return { usd: 0, emptyUsd: 0, unpriced: 0, unpricedModels: [] };
}

/**
 * What a set of scanned sessions cost.
 *
 * Unpriced sessions are counted, never dropped and never priced at a nearby
 * model's rate — the same rule `spendOf` follows, for the same reason: a
 * total with a silent hole in it is the kind of number that reaches an
 * invoice.
 *
 * A session that moved no tokens at all needs no rate, so it is not reported
 * as a gap. That keeps `unpriced` meaning "money nobody can work out" rather
 * than "a transcript with nothing in it".
 */
export function spendOfScanned(
  sessions: readonly ScannedSession[],
  rates: RateTable,
): ScanSpend {
  const models = new Set<string>();
  const spend = emptyScanSpend();

  for (const session of sessions) {
    const price = priceSession(session.cost, rates);
    if (!isPriced(price)) {
      if (moved(session.cost)) {
        spend.unpriced += 1;
        models.add(price.model === "" ? "unknown" : price.model);
      }
      continue;
    }
    spend.usd += price.usd;
    // Absent only on a cost captured before the split was recorded, which a
    // scan never produces — it reads the transcript itself, where which turn
    // a call belonged to is still known. Guarded anyway rather than asserted.
    spend.emptyUsd += price.emptyUsd ?? 0;
  }

  spend.unpricedModels = [...models].sort();
  return spend;
}

/** True when anything was captured for this session at all. */
function moved(cost: SessionCost): boolean {
  return cost.apiCalls > 0 || cost.turns > 0;
}

function sum(sessions: readonly ScannedSession[], of: (cost: SessionCost) => number): number {
  return sessions.reduce((running, session) => running + of(session.cost), 0);
}

/** How many sessions to name individually. Three is what a reader holds. */
export const TOP_SESSIONS = 3;

/**
 * The whole report, in the order it is read: what the window cost, how much of
 * that bought nothing, where it went, and which sessions were the dearest.
 */
export function summarizeScan(
  sessions: readonly ScannedSession[],
  rates: RateTable,
  days: number,
): ScanReport {
  return {
    days,
    sessions: sessions.length,
    spend: spendOfScanned(sessions, rates),
    turns: sum(sessions, (cost) => cost.turns),
    emptyTurns: sum(sessions, (cost) => cost.emptyTurns),
    repos: repoRows(sessions, rates),
    landed: sessions.filter((session) => session.landed === true).length,
    landingUnknown: sessions.filter((session) => session.landed === undefined).length,
    top: topSessions(sessions, rates),
    unrankable: sessions.filter(
      (session) => !isPriced(priceSession(session.cost, rates)) && moved(session.cost),
    ).length,
  };
}

/**
 * One row per repository, dearest first.
 *
 * Ties break on the repo's own name so the table is the same table twice
 * running; a report whose rows move between runs is one nobody can diff. A
 * repo whose sessions could none of them be priced sorts to the bottom on
 * `usd: 0` and says `unpriced` in its cost cell rather than `$0.00` — see the
 * renderer.
 */
function repoRows(sessions: readonly ScannedSession[], rates: RateTable): RepoRow[] {
  const byRepo = new Map<string, ScannedSession[]>();
  for (const session of sessions) {
    const existing = byRepo.get(session.repo);
    if (existing) {
      existing.push(session);
    } else {
      byRepo.set(session.repo, [session]);
    }
  }

  return [...byRepo]
    .map(([repo, group]) => ({
      repo,
      sessions: group.length,
      spend: spendOfScanned(group, rates),
      turns: sum(group, (cost) => cost.turns),
      emptyTurns: sum(group, (cost) => cost.emptyTurns),
    }))
    .sort((a, b) => b.spend.usd - a.spend.usd || a.repo.localeCompare(b.repo));
}

/**
 * The dearest sessions, most expensive first.
 *
 * Only sessions that could be priced are ranked at all. "The three most
 * expensive" is a claim about an order, and a session whose model has no rate
 * has no place in that order — putting it last would say it was cheap, and
 * leaving it first would say it was dear. How many were left out is on the
 * report as `unrankable`, so the list is never read as more than it is.
 */
function topSessions(sessions: readonly ScannedSession[], rates: RateTable): TopSession[] {
  return sessions
    .map((session) => ({ session, price: priceSession(session.cost, rates) }))
    .filter(
      (entry): entry is { session: ScannedSession; price: Extract<Price, { priced: true }> } =>
        isPriced(entry.price),
    )
    .map((entry) => ({ session: entry.session, usd: entry.price.usd }))
    .sort((a, b) => b.usd - a.usd || a.session.id.localeCompare(b.session.id))
    .slice(0, TOP_SESSIONS);
}
