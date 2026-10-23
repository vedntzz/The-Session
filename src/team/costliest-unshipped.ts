// The costliest sessions whose work did not ship, for the team report. Pure.
import type { RepoFacts } from "../outcome.js";
import type { RateTable } from "../pricing.js";
import { agentLabel, pricedUsdOf } from "./aggregate-team.js";
import { classifyOutcome, isWaste, NO_REVERT_DETECTION } from "./classify-outcome.js";
import type { TeamRecord } from "./load-team-records.js";
import type { CostlyUnshipped, OutcomeSplit } from "./team-report.js";

/** The label each waste bucket renders as. */
const OUTCOME_LABEL: Readonly<Partial<Record<keyof OutcomeSplit, CostlyUnshipped["outcome"]>>> = {
  reverted: "reverted",
  neverMerged: "never-merged",
};

interface Ranked { entry: CostlyUnshipped; startedAt: number }

/** Waste sessions, priced highest first, unpriced last, newest first on a tie; at most `limit`. */
export function costliestUnshipped(records: readonly TeamRecord[], facts: RepoFacts | undefined, rates: RateTable, limit = 5): CostlyUnshipped[] {
  const ranked = records.flatMap((record) => rankedEntry(record, facts, rates));
  return ranked.sort(byCostThenNewest).slice(0, limit).map((item) => item.entry);
}

function rankedEntry(record: TeamRecord, facts: RepoFacts | undefined, rates: RateTable): Ranked[] {
  const bucket = classifyOutcome(record, facts, NO_REVERT_DETECTION);
  const outcome = OUTCOME_LABEL[bucket];
  if (!isWaste(bucket) || outcome === undefined) return [];
  const entry = { date: record.startedAt.slice(0, 10), repo: record.repo, agent: agentLabel(record), outcome, usd: pricedUsdOf(record, rates) ?? null };
  return [{ entry, startedAt: Date.parse(record.startedAt) }];
}

function byCostThenNewest(a: Ranked, b: Ranked): number {
  return (b.entry.usd ?? -Infinity) - (a.entry.usd ?? -Infinity) || b.startedAt - a.startedAt;
}
