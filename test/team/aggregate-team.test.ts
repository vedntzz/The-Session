// TM-3: team records grouped by repo and agent, and totals that are the sum of the groups.
import { describe, expect, it } from "vitest";
import type { Session } from "../../src/store.js";
import { aggregateTeam } from "../../src/team/aggregate-team.js";
import { countOutcomes } from "../../src/team/classify-outcome.js";
import type { TeamRecord } from "../../src/team/load-team-records.js";
import type { OutcomeSplit, TeamGroup } from "../../src/team/team-report.js";
import { cost, RATES, session } from "../fixtures/markdown.js";

const WINDOW = { from: "2026-10-01T00:00:00.000Z", to: "2026-10-07T23:59:59.999Z" };
const TOOL = "remote:github.com/acme/tool";
const SITE = "remote:github.com/acme/site";

/** A record in the window, $1.50 at RATES unless overridden. */
function record(id: string, overrides: Partial<Session> = {}): TeamRecord {
  return { ...session({ id, startedAt: "2026-10-03T09:00:00.000Z", ...overrides }), sourceRef: "refs/session/a" };
}

const claude = (extra: Partial<Session["cost"]> = {}) => cost({ inputTokens: 100_000, agents: ["claude-code"], ...extra });

function groupOf(groups: readonly TeamGroup[], repo: string, agent: string): TeamGroup | undefined {
  return groups.find((group) => group.repo === repo && group.agent === agent);
}

function sumOutcomes(groups: readonly TeamGroup[]): OutcomeSplit {
  const sum: OutcomeSplit = { shipped: 0, reverted: 0, neverMerged: 0, stillOpen: 0, noChanges: 0 };
  for (const group of groups) for (const key of Object.keys(sum) as (keyof OutcomeSplit)[]) sum[key] += group.outcomes[key];
  return sum;
}

const MIXED: TeamRecord[] = [
  record("a", { cost: claude() }),
  record("b", { cost: claude(), reality: [] }),
  record("c", { cost: claude({ agents: ["codex", "claude-code"] }) }),
  record("d", { repo: SITE, cost: claude({ model: "no-such-model" }) }),
  record("e", { repo: SITE, cost: claude({ turns: 0 }) }),
];

describe("aggregateTeam", () => {
  it("groups by repo and agent, one group for a session several agents captured", () => {
    const report = aggregateTeam(MIXED, undefined, RATES, WINDOW);
    expect(report.groups.map((group) => [group.repo, group.agent, group.sessions]).sort()).toEqual([
      [SITE, "claude-code", 2],
      [TOOL, "claude-code+codex", 1],
      [TOOL, "claude-code", 2],
    ]);
    expect(groupOf(report.groups, TOOL, "claude-code+codex")!.pricedUsd).toBeCloseTo(1.5);
  });

  it("uses the repo identity each record carries", () => {
    const report = aggregateTeam(MIXED, undefined, RATES, WINDOW);
    expect(new Set(report.groups.map((group) => group.repo))).toEqual(new Set([TOOL, SITE]));
  });

  it("sums only priced sessions and counts the rest, unpriced or uncaptured, apart", () => {
    const report = aggregateTeam(MIXED, undefined, RATES, WINDOW);
    const site = groupOf(report.groups, SITE, "claude-code")!;
    expect(site.pricedUsd).toBe(0);
    expect(site.unpricedSessions).toBe(2);
    expect(groupOf(report.groups, TOOL, "claude-code")!.pricedUsd).toBeCloseTo(3);
  });

  it("takes each group's outcomes from countOutcomes", () => {
    const report = aggregateTeam(MIXED, undefined, RATES, WINDOW);
    const tool = groupOf(report.groups, TOOL, "claude-code")!;
    expect(tool.outcomes).toEqual(countOutcomes([MIXED[0]!, MIXED[1]!], undefined));
    expect(tool.outcomes.noChanges).toBe(1);
  });

  it("totals equal the sum of the groups", () => {
    const { groups, totals } = aggregateTeam(MIXED, undefined, RATES, WINDOW);
    expect(totals.sessions).toBe(groups.reduce((sum, group) => sum + group.sessions, 0));
    expect(totals.pricedUsd).toBeCloseTo(groups.reduce((sum, group) => sum + group.pricedUsd, 0));
    expect(totals.unpricedSessions).toBe(groups.reduce((sum, group) => sum + group.unpricedSessions, 0));
    expect(totals.outcomes).toEqual(sumOutcomes(groups));
    expect(totals).toMatchObject({ sessions: 5, unpricedSessions: 2 });
  });

  it("keeps only sessions started inside the window, ends included, and echoes it", () => {
    const edges = [
      record("before", { startedAt: "2026-09-30T23:59:59.999Z" }),
      record("first", { startedAt: WINDOW.from }),
      record("last", { startedAt: WINDOW.to }),
      record("after", { startedAt: "2026-10-08T00:00:00.000Z" }),
    ];
    const report = aggregateTeam(edges, undefined, RATES, WINDOW);
    expect(report.totals.sessions).toBe(2);
    expect(report.window).toEqual(WINDOW);
  });

  it("carries no per-person field anywhere", () => {
    const json = JSON.stringify(aggregateTeam(MIXED, undefined, RATES, WINDOW));
    expect(json).not.toMatch(/"(name|email|author|login)"/);
  });
});
