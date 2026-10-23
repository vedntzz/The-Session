// TM-4: the costliest sessions whose work did not ship, priced first, newest first on a tie.
import { describe, expect, it } from "vitest";
import type { Session } from "../../src/store.js";
import { costliestUnshipped } from "../../src/team/costliest-unshipped.js";
import type { TeamRecord } from "../../src/team/load-team-records.js";
import { cost, RATES, session } from "../fixtures/markdown.js";

const TOOL = "remote:github.com/acme/tool";

const abandoned = { observations: [
  { outcome: "abandoned" as const, observedAt: "2026-10-04T09:00:00Z", commit: "abc", branch: "main", source: "manual" as const }] };

/** An abandoned record costing `inputTokens` at RATES, started on `day`. */
function unshipped(id: string, inputTokens: number, day = "03", overrides: Partial<Session> = {}): TeamRecord {
  const priced = cost({ inputTokens, agents: ["claude-code"] });
  return { ...session({ id, startedAt: `2026-10-${day}T09:00:00.000Z`, cost: priced, ...abandoned, ...overrides }), sourceRef: "refs/session/a" };
}

const usdOf = (records: readonly TeamRecord[]) => costliestUnshipped(records, undefined, RATES).map((entry) => entry.usd);

describe("costliestUnshipped", () => {
  it("keeps only never-merged sessions; open and no-change ones never appear", () => {
    const open = unshipped("open", 900_000, "03", { observations: [] });
    const empty = unshipped("empty", 900_000, "03", { observations: [], reality: [] });
    const entries = costliestUnshipped([open, empty, unshipped("gone", 100_000)], undefined, RATES);
    expect(entries.map((entry) => entry.outcome)).toEqual(["never-merged"]);
  });

  it("sorts priced cost highest first, unpriced after every priced one with usd null", () => {
    const unpriced = unshipped("x", 900_000, "05", { cost: cost({ inputTokens: 900_000, model: "no-such-model" }) });
    const usd = usdOf([unshipped("a", 100_000), unpriced, unshipped("b", 300_000)]);
    expect(usd[0]).toBeGreaterThan(usd[1]!);
    expect(usd[2]).toBeNull();
  });

  it("returns at most 5 by default and honours a limit", () => {
    const many = ["01", "02", "03", "04", "05", "06", "07"].map((day, index) => unshipped(`s${index}`, 100_000, day));
    expect(costliestUnshipped(many, undefined, RATES)).toHaveLength(5);
    expect(costliestUnshipped(many, undefined, RATES, 2)).toHaveLength(2);
  });

  it("breaks ties by start time, newest first", () => {
    const entries = costliestUnshipped([unshipped("old", 100_000, "02"), unshipped("new", 100_000, "06")], undefined, RATES);
    expect(entries.map((entry) => entry.date)).toEqual(["2026-10-06", "2026-10-02"]);
  });

  it("carries date, repo, agent, outcome and usd only, never intent or a person", () => {
    const [entry] = costliestUnshipped([unshipped("a", 100_000, "03", { intent: "secret plan" })], undefined, RATES);
    expect(Object.keys(entry!).sort()).toEqual(["agent", "date", "outcome", "repo", "usd"]);
    expect(entry).toMatchObject({ date: "2026-10-03", repo: TOOL, agent: "claude-code", outcome: "never-merged" });
    expect(JSON.stringify(entry)).not.toContain("secret plan");
  });

  it("returns [] for no records", () => {
    expect(costliestUnshipped([], undefined, RATES)).toEqual([]);
  });
});
