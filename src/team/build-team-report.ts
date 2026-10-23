// The team report: aggregateTeam's groups and totals, with the costliest unshipped sessions filled in. Pure.
import type { RepoFacts } from "../outcome.js";
import type { RateTable } from "../pricing.js";
import { aggregateTeam, startedWithin } from "./aggregate-team.js";
import { costliestUnshipped } from "./costliest-unshipped.js";
import type { TeamRecord } from "./load-team-records.js";
import type { TeamReport } from "./team-report.js";

/** Both parts read the same in-window records. */
export function buildTeamReport(records: readonly TeamRecord[], facts: RepoFacts | undefined, rates: RateTable, window: TeamReport["window"]): TeamReport {
  const inWindow = records.filter((record) => startedWithin(record, window));
  return { ...aggregateTeam(inWindow, facts, rates, window), costliestUnshipped: costliestUnshipped(inWindow, facts, rates) };
}
