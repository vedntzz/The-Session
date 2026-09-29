import { describe, expect, it } from "vitest";
import { formatSettle, type Settled, type SettleResult } from "../src/commands/settle.js";
import type { OutcomeVerdict } from "../src/outcome.js";
import { shortId } from "../src/render/terminal.js";
import { zeroCost, type Session, type SessionOutcome } from "../src/store.js";

/**
 * The rows `session settle` prints for the sessions it decided about.
 *
 * `settle.test.ts` drives the command against real repositories; what it
 * prints there is a branch and a count. This is the row under each decision —
 * what the session was called, whether that was news, and the evidence in a
 * few words — built from literals so every combination can be shown.
 */

const ID = "11111111-2222-3333-4444-555555555555";

function session(id = ID): Session {
  return {
    id,
    repo: "remote:github.com/acme/tool",
    intent: "add rate limiting to /orders",
    scope: [],
    baseline: [],
    reality: ["api/orders.ts"],
    drift: [],
    cost: zeroCost(),
    outcome: "open",
    startedAt: "2026-08-20T09:14:00.000Z",
    endedAt: "2026-08-20T09:51:00.000Z",
    startCommit: "abc1234",
  };
}

function verdict(over: Partial<OutcomeVerdict> = {}): OutcomeVerdict {
  return { outcome: "merged", landed: [], inFlight: [], lost: [], ...over };
}

function settled(outcome: SessionOutcome, over: Partial<Settled> = {}): Settled {
  return { session: session(), outcome, recorded: true, ...over };
}

function result(rows: Settled[], over: Partial<SettleResult> = {}): SettleResult {
  return { branch: "origin/main", settled: rows, stillOpen: 0, empty: 0, undecidable: 0, ...over };
}

/** The row for the session, found by its short id. */
function rowOf(lines: readonly string[], id = ID): string {
  const row = lines.find((line) => line.startsWith(`  ${shortId(id)}`));
  expect(row, `no row for ${id}`).toBeDefined();
  return row as string;
}

describe("formatSettle: one row per session decided about", () => {
  it("names the session by its short id, then the outcome, then why", () => {
    const lines = formatSettle(result([settled("merged", { verdict: verdict({ landed: ["a.ts", "b.ts"] }) })]));
    expect(rowOf(lines)).toBe(`  ${shortId(ID).padEnd(9)}${"merged".padEnd(20)}2 files in the branch`);
  });

  it("sits between the branch line and the count", () => {
    const lines = formatSettle(result([settled("merged", { verdict: verdict({ landed: ["a.ts"] }) })]));
    expect(lines[0]).toBe("  branch   origin/main");
    expect(lines[1]).toBe(rowOf(lines));
    expect(lines[2]).toBe("  settled  1 session recorded");
  });

  it("marks an outcome the log already said, and leaves it out of the count", () => {
    const lines = formatSettle(
      result([settled("abandoned", { recorded: false, verdict: verdict({ outcome: "abandoned", lost: ["a.ts"] }) })]),
    );
    expect(rowOf(lines)).toContain("abandoned (already)");
    expect(lines).toContain("  settled  0 sessions recorded");
  });

  it("keeps the evidence in one column whether or not the outcome is news", () => {
    const why = verdict({ landed: ["a.ts"] });
    const fresh = rowOf(formatSettle(result([settled("merged", { verdict: why })])));
    const again = rowOf(formatSettle(result([settled("merged", { verdict: why, recorded: false })])));
    expect(fresh.indexOf("1 file in the branch")).toBe(again.indexOf("1 file in the branch"));
  });

  it("prints one row per session, in the order given", () => {
    const other = "99999999-8888-7777-6666-555555555555";
    const lines = formatSettle(
      result([
        settled("merged", { verdict: verdict({ landed: ["a.ts"] }) }),
        settled("abandoned", { session: session(other), verdict: verdict({ outcome: "abandoned", lost: ["b.ts"] }) }),
      ]),
    );
    expect(lines.indexOf(rowOf(lines))).toBeLessThan(lines.indexOf(rowOf(lines, other)));
    expect(lines).toContain("  settled  2 sessions recorded");
  });

  it("ends the row at the outcome where there is no verdict, as for a manual mark", () => {
    const row = rowOf(formatSettle(result([settled("merged")])));
    expect(row).toBe(`  ${shortId(ID).padEnd(9)}merged`);
  });
});

describe("formatSettle: the evidence in a few words", () => {
  const why = (v: OutcomeVerdict): string =>
    rowOf(formatSettle(result([settled(v.outcome, { verdict: v })]))).slice(2 + 9 + 20);

  it("counts the files that reached the branch", () => {
    expect(why(verdict({ landed: ["a.ts"] }))).toBe("1 file in the branch");
    expect(why(verdict({ landed: ["a.ts", "b.ts", "c.ts"] }))).toBe("3 files in the branch");
  });

  it("counts the files still sitting in the working tree", () => {
    expect(why(verdict({ outcome: "abandoned", inFlight: ["a.ts"] }))).toBe("1 file still in the tree");
  });

  it("counts the files that are in neither place", () => {
    expect(why(verdict({ outcome: "abandoned", lost: ["a.ts", "b.ts"] }))).toBe("2 files nowhere");
  });

  it("gives every kind that applies, landed first, then in the tree, then nowhere", () => {
    expect(
      why(verdict({ outcome: "abandoned", landed: ["a.ts"], inFlight: ["b.ts", "c.ts"], lost: ["d.ts"] })),
    ).toBe("1 file in the branch, 2 files still in the tree, 1 file nowhere");
  });

  it("leaves out a kind with nothing in it rather than printing a nought", () => {
    const text = why(verdict({ outcome: "abandoned", landed: ["a.ts"], lost: ["b.ts"] }));
    expect(text).toBe("1 file in the branch, 1 file nowhere");
    expect(text).not.toMatch(/\b0 /);
  });

  it("says nothing was left behind where no file is in any of the three", () => {
    expect(why(verdict({ outcome: "merged" }))).toBe("nothing was left behind");
  });
});
