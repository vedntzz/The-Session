// The words on each `session agents` row, and the reader that finds write-check events.
import { describe, expect, it } from "vitest";
import type { AgentRow } from "../src/agents-report.js";
import { landed, spent, survived, windowOf, writes } from "../src/render/terminal/agents.js";
import { checksBySession } from "../src/write-checks.js";

const spend = { usd: 0, unmerged: 0, empty: 0, unpriced: 0, unpricedModels: [], uncaptured: 0 };
const row = (fields: Partial<AgentRow>): AgentRow => ({
  source: "declared", sessions: 1, mixed: 0, merged: 0, abandoned: 0, open: 0, empty: 0,
  survival: { measured: 0, pending: 0, due: 0, missed: 0 }, undated: 0, spend, ...fields,
});

describe("the row", () => {
  it("names the window", () => {
    expect(windowOf(undefined)).toBe("all recorded history");
    expect(windowOf(30)).toBe("the last 30 days");
  });

  it("prints where the work went as counts, never a merge rate", () => {
    expect(landed(row({ merged: 30, abandoned: 1, open: 2 }))).toBe("30 merged · 1 marked abandoned · 2 open · 0 changed no files");
    expect(landed(row({ merged: 30 }))).not.toMatch(/%/);
  });

  it("counts pending apart from the survival rate, and every other state by name", () => {
    const survival = { measured: 5, pending: 7, due: 1, missed: 0, figures: { paths: 10, survived: 9, rewritten: 1, deleted: 0, rate: 0.9, churn: 0.1 } };
    expect(survived(row({ survival }))).toBe("90% of 10 paths survived, 5 checked · 7 pending · 1 due");
    expect(survived(row({ survival: { measured: 0, pending: 2, due: 0, missed: 0 }, undated: 1 }))).toBe("0 checked, no rate · 2 pending · 1 undated");
    expect(survived(row({}))).toBe("nothing merged to check");
  });

  it("says no check was recorded rather than nought asked", () => {
    expect(writes(row({}))).toBe("no write check recorded");
    expect(writes(row({ writes: { asked: 2, denied: 0 } }))).toBe("2 asked · 0 denied");
  });

  it("keeps unknown calls and unpriced money off nought", () => {
    const unpriced = { ...spend, unpriced: 2, unpricedModels: ["gpt-6-astra"] };
    expect(spent(row({ spend: unpriced }), true)).toBe("— api calls · — spent: nothing here could be priced · 2 unpriced: gpt-6-astra");
    expect(spent(row({ calls: 1_234, spend: { ...spend, usd: 1.5 } }), true)).toBe("1,234 api calls · $1.50 spent");
    expect(spent(row({ spend: { ...spend, uncaptured: 3 } }), false)).toBe("— spent: nothing here could be priced · 3 uncaptured");
  });
});

describe("checksBySession", () => {
  it("collects write-check events by session and skips every other line", () => {
    const check = { type: "write-check", n: 1, tool: "Edit", path: "a", decision: "ask", reason: "r", agent: "claude-code" };
    const lines = [{ id: "s1", set: { writeCheck: check } }, { id: "s1", set: { intent: "x" } }, { id: "s2", set: { writeCheck: { ...check, n: 2 } } }]
      .map((record, i) => ({ no: i + 1, text: JSON.stringify(record) }));
    const found = checksBySession([{ file: "f", complete: true, lines: [...lines, { no: 9, text: "{not json" }] }]);
    expect([...found.keys()]).toEqual(["s1", "s2"]);
    expect(found.get("s1")).toEqual([check]);
  });
});
