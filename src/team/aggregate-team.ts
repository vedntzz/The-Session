// Team records in a window, grouped by repo and agent, with totals that are the sum of the groups. Pure.
import { agentsOf } from "../agents.js";
import { knownAgents } from "../capture/index.js";
import type { RepoFacts } from "../outcome.js";
import { priceSession, wasMeasured, type RateTable } from "../pricing.js";
import { countOutcomes } from "./classify-outcome.js";
import type { TeamRecord } from "./load-team-records.js";
import type { OutcomeSplit, TeamGroup, TeamReport } from "./team-report.js";

type TeamWindow = TeamReport["window"];

/** The label for a session no adapter recognises: unknown, never a guessed agent. */
const UNKNOWN_AGENT = "unknown";

/** One group per repo and agent set; spend from priced sessions only, the rest counted. */
export function aggregateTeam(records: readonly TeamRecord[], facts: RepoFacts | undefined, rates: RateTable, window: TeamWindow): TeamReport {
  const inWindow = records.filter((record) => startedWithin(record, window));
  const groups = [...groupRecords(inWindow).values()].map((members) => toGroup(members, facts, rates));
  return { window: { ...window }, totals: totalsOf(groups), groups, costliestUnshipped: [] };
}

/** True for a session started inside [from, to], both ends included. */
export function startedWithin(record: TeamRecord, window: TeamWindow): boolean {
  const started = Date.parse(record.startedAt);
  return started >= Date.parse(window.from) && started <= Date.parse(window.to);
}

/** Every agent that captured the session, sorted and joined, so one session is one group. */
export function agentLabel(record: TeamRecord): string {
  return agentsOf(record.cost, knownAgents()).join("+") || UNKNOWN_AGENT;
}

function groupRecords(records: readonly TeamRecord[]): Map<string, TeamRecord[]> {
  const groups = new Map<string, TeamRecord[]>();
  for (const record of records) {
    const key = JSON.stringify([record.repo, agentLabel(record)]);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return groups;
}

/** The session's dollars, or undefined where no rate covers it or nothing was captured. */
export function pricedUsdOf(record: TeamRecord, rates: RateTable): number | undefined {
  if (!wasMeasured(record.cost)) return undefined;
  const price = priceSession(record.cost, rates);
  return price.priced ? price.usd : undefined;
}

function toGroup(members: readonly TeamRecord[], facts: RepoFacts | undefined, rates: RateTable): TeamGroup {
  const prices = members.map((record) => pricedUsdOf(record, rates));
  const priced = prices.filter((usd): usd is number => usd !== undefined);
  const first = members[0]!;
  return { repo: first.repo, agent: agentLabel(first), sessions: members.length,
    pricedUsd: sum(priced), unpricedSessions: members.length - priced.length, outcomes: countOutcomes(members, facts) };
}

function totalsOf(groups: readonly TeamGroup[]): TeamReport["totals"] {
  return { sessions: sum(groups.map((group) => group.sessions)), pricedUsd: sum(groups.map((group) => group.pricedUsd)),
    unpricedSessions: sum(groups.map((group) => group.unpricedSessions)), outcomes: sumOutcomes(groups) };
}

function sumOutcomes(groups: readonly TeamGroup[]): OutcomeSplit {
  const total: OutcomeSplit = { shipped: 0, reverted: 0, neverMerged: 0, stillOpen: 0, noChanges: 0 };
  const buckets = Object.keys(total) as (keyof OutcomeSplit)[];
  for (const group of groups) for (const bucket of buckets) total[bucket] += group.outcomes[bucket];
  return total;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
