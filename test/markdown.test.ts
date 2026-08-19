import { describe, expect, it } from "vitest";
import type { RateTable } from "../src/pricing.js";
import { formatRange, renderMarkdownWeek, workCell } from "../src/render/markdown.js";
import { zeroCost, type Session, type SessionCost } from "../src/store.js";

/** At $15 per million input tokens, 100,000 input tokens is exactly $1.50. */
const RATES: RateTable = new Map([
  ["claude-opus-4-1", { input: 15, cacheRead: 1.5, cacheCreation: 18.75, output: 75 }],
]);
const priced = { rates: RATES };

/**
 * A fixed clock, so the heading is a fact about the arguments rather than
 * about the day the suite runs. Built from a local-time Date for the reason
 * `terminal.test.ts` gives: the formatter prints wall-clock dates, and pinning
 * a timezone here would only test the pin.
 */
const NOW = new Date(2026, 7, 18, 17, 0);

function on(day: number, month = 7): string {
  return new Date(2026, month, day, 9, 14).toISOString();
}

function cost(overrides: Partial<SessionCost> = {}): SessionCost {
  return { ...zeroCost(), model: "claude-opus-4-1", turns: 5, apiCalls: 20, ...overrides };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    repo: "remote:github.com/acme/tool",
    intent: "add rate limiting to /orders",
    scope: ["src/api/"],
    baseline: [],
    reality: ["src/api/orders.ts"],
    drift: [],
    cost: cost({ inputTokens: 100_000 }),
    outcome: "merged",
    startedAt: on(12),
    endedAt: on(12),
    startCommit: "abc1234",
    ...overrides,
  };
}

/** The rendered document, split so a test can point at one line. */
function lines(sessions: readonly Session[], days = 7): string[] {
  return renderMarkdownWeek(sessions, days, priced, NOW).split("\n");
}

describe("formatRange", () => {
  it("names one month once", () => {
    expect(formatRange(new Date(2026, 7, 12), new Date(2026, 7, 18))).toBe("12–18 Aug");
  });

  it("names both months when the window crosses one", () => {
    expect(formatRange(new Date(2026, 6, 28), new Date(2026, 7, 3))).toBe("28 Jul – 3 Aug");
  });

  it("names both years when the window crosses one", () => {
    expect(formatRange(new Date(2025, 11, 28), new Date(2026, 0, 3))).toBe(
      "28 Dec 2025 – 3 Jan 2026",
    );
  });

  it("gives a date rather than a range for a single day", () => {
    expect(formatRange(new Date(2026, 7, 18), new Date(2026, 7, 18))).toBe("18 Aug");
  });
});

describe("workCell", () => {
  it("escapes a pipe, which would otherwise split the row into two cells", () => {
    const cell = workCell(session({ intent: "fix `grep foo | wc -l` in the build script" }));

    expect(cell).toBe("fix `grep foo \\| wc -l` in the build script");
    expect(cell).not.toMatch(/[^\\]\|/);
  });

  it("escapes every pipe, not just the first", () => {
    expect(workCell(session({ intent: "a | b | c" }))).toBe("a \\| b \\| c");
  });

  it("keeps a pipe from breaking the table it lands in", () => {
    // The whole point of the escape: the row still has exactly five cells.
    const rendered = lines([session({ intent: "why does a | b || c fail" })]);
    const row = rendered.find((line) => line.includes("why does")) as string;

    expect(row.split(/(?<!\\)\|/)).toHaveLength(7); // five cells, plus both ends
  });

  it("flattens a newline, which would end the row where it fell", () => {
    expect(workCell(session({ intent: "first line\nsecond line" }))).toBe("first line second line");
  });

  it("truncates a long intent so one cell cannot swamp the table", () => {
    const cell = workCell(session({ intent: "x".repeat(200) }));

    expect([...cell]).toHaveLength(60);
    expect(cell.endsWith("…")).toBe(true);
  });

  it("counts what a reader sees, so escaping cannot push a cell over the limit", () => {
    const cell = workCell(session({ intent: "|".repeat(200) }));

    // Sixty visible characters; the backslashes are added on top of them.
    expect([...cell.replace(/\\\|/gu, "|")]).toHaveLength(60);
  });

  it("marks a captured intent the way the week table marks it", () => {
    const captured = session({ intentSource: "captured", intent: "why does /orders 500" });

    expect(workCell(captured)).toBe("~ why does /orders 500");
  });

  it("counts the marker against the width, since it has to fit too", () => {
    const captured = session({ intentSource: "captured", intent: "x".repeat(200) });

    expect([...workCell(captured)]).toHaveLength(60);
  });

  it("says a session was never given a prompt rather than leaving the cell blank", () => {
    const none = session({ intent: null, intentSource: "captured" });

    expect(workCell(none)).toBe("~ (no prompt)");
  });
});

describe("renderMarkdownWeek", () => {
  it("heads the document with the range the window covers", () => {
    expect(lines([session()])[0]).toBe("### AI-assisted work · 12–18 Aug");
  });

  it("counts the window in whole days ending today", () => {
    expect(lines([session()], 1)[0]).toBe("### AI-assisted work · 18 Aug");
    expect(lines([session()], 30)[0]).toBe("### AI-assisted work · 20 Jul – 18 Aug");
  });

  it("leads with spend, what shipped, and what went outside plan", () => {
    const week = [
      session({ startedAt: on(12) }),
      session({ startedAt: on(13), outcome: "open", drift: ["src/store.ts", "rates.json"] }),
    ];

    expect(lines(week)[2]).toBe(
      "**$3.00 spent · 1 change shipped · 2 files touched outside plan**",
    );
  });

  it("says one change and one file in the singular", () => {
    expect(lines([session({ drift: ["src/store.ts"] })])[2]).toBe(
      "**$1.50 spent · 1 change shipped · 1 file touched outside plan**",
    );
  });

  it("names the five columns in order", () => {
    expect(lines([session()])[4]).toBe("| Date | Work | Outcome | Cost | Unplanned |");
  });

  it("right-aligns the two columns that hold figures, and only those", () => {
    expect(lines([session()])[5]).toBe("|---|---|---|---:|---:|");
  });

  it("ticks a merged session and leaves every other outcome unticked", () => {
    const week = [
      session({ startedAt: on(12), outcome: "merged" }),
      session({ startedAt: on(13), outcome: "abandoned" }),
      session({ startedAt: on(14), outcome: "open" }),
    ];
    const rows = lines(week).filter((line) => line.startsWith("| 1"));

    expect(rows[0]).toBe("| 12 Aug | add rate limiting to /orders | ✅ | $1.50 | 0 |");
    expect(rows[1]).toBe("| 13 Aug | add rate limiting to /orders |  | $1.50 | 0 |");
    expect(rows[2]).toBe("| 14 Aug | add rate limiting to /orders |  | $1.50 | 0 |");
  });

  it("closes the table with a bold total row", () => {
    const week = [
      session({ startedAt: on(12) }),
      session({ startedAt: on(13), outcome: "open", drift: ["a.ts", "b.ts"] }),
    ];

    expect(lines(week).find((line) => line.includes("**Total**"))).toBe(
      "| **Total** | **2 sessions** | **1 ✅** | **$3.00** | **2** |",
    );
  });

  it("leaves the tick off the total row when nothing shipped", () => {
    expect(lines([session({ outcome: "open" })]).find((line) => line.includes("**Total**"))).toBe(
      "| **Total** | **1 session** |  | **$1.50** | **0** |",
    );
  });

  it("closes with what each shipped change cost, over everything spent", () => {
    const week = [
      session({ startedAt: on(12), outcome: "merged" }),
      // Money that never landed is part of what the change that did land cost.
      session({ startedAt: on(13), outcome: "abandoned" }),
    ];

    expect(lines(week).at(-1)).toBe("**$3.00 per shipped change.**");
  });

  it("omits that line entirely when nothing merged", () => {
    const document = renderMarkdownWeek([session({ outcome: "open" })], 7, priced, NOW);

    expect(document).not.toContain("per shipped change");
    expect(document).not.toContain("—");
  });

  it("omits it when no session could be priced, rather than dividing nothing", () => {
    const unpriced = session({ cost: cost({ model: "mystery-9", inputTokens: 100_000 }) });

    expect(renderMarkdownWeek([unpriced], 7, priced, NOW)).not.toContain("per shipped change");
  });
});

describe("a week with sessions no rate covers", () => {
  const week = [
    session({ startedAt: on(12) }),
    session({ startedAt: on(13), cost: cost({ model: "mystery-9", inputTokens: 100_000 }) }),
  ];

  it("prices the ones it can and says so in the cell", () => {
    const rows = lines(week).filter((line) => line.startsWith("| 1"));

    expect(rows[0]).toContain("$1.50");
    expect(rows[1]).toContain("unpriced");
  });

  it("says plainly how much of the table the money covers", () => {
    expect(lines(week).find((line) => line.startsWith("The cost above"))).toBe(
      "The cost above covers 1 of 2 sessions. 1 session ran on a model with no rate (mystery-9).",
    );
  });

  it("never gives a total that quietly leaves them out", () => {
    const document = renderMarkdownWeek(week, 7, priced, NOW);

    // The total is $1.50, and the document says out loud that it is a total of
    // one of the two rows rather than of both.
    expect(document).toContain("**$1.50**");
    expect(document).toContain("covers 1 of 2 sessions");
  });

  it("calls a session with nothing captured $0.00 rather than unpriced", () => {
    // Nothing ran, so it moved no tokens and there is no rate it is missing.
    // Calling it unpriced would open a hole the note below would not count.
    const document = renderMarkdownWeek([session({ cost: zeroCost() })], 7, priced, NOW);

    expect(document).toContain("| $0.00 |");
    expect(document).not.toContain("unpriced");
    expect(document).not.toContain("The cost above covers");
  });
});

describe("sessions that changed nothing", () => {
  const week = [
    session({ startedAt: on(12) }),
    session({
      startedAt: on(13),
      outcome: "empty",
      reality: [],
      cost: cost({ inputTokens: 20_000 }),
    }),
  ];

  it("keeps them out of the table", () => {
    const rows = lines(week).filter((line) => line.startsWith("| 1"));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("12 Aug");
  });

  it("names them in a line below it, with what they cost", () => {
    expect(lines(week).find((line) => line.startsWith("1 session changed"))).toBe(
      "1 session changed no files and is not in the table, costing $0.30.",
    );
  });

  it("keeps them out of every figure above, so the table adds up to its own total", () => {
    // $1.50, not $1.80: the total row is a total of the rows above it, and the
    // $0.30 is accounted for in its own line rather than folded in silently.
    expect(lines(week)[2]).toContain("$1.50 spent");
    expect(lines(week).find((line) => line.includes("**Total**"))).toContain("**$1.50**");
  });

  it("says so and stops when every session in the window was one", () => {
    const document = renderMarkdownWeek([week[1] as Session], 7, priced, NOW);

    expect(document).toContain("No sessions with any changes in them");
    expect(document).toContain("1 session changed no files");
    expect(document).not.toContain("| Date |");
  });

  it("leaves the cost off when they cost nothing", () => {
    const free = session({ outcome: "empty", reality: [], cost: zeroCost() });
    const document = renderMarkdownWeek([session(), free], 7, priced, NOW);

    expect(document).toContain("1 session changed no files and is not in the table.");
  });
});

describe("a week the hook recorded", () => {
  it("explains the marker, and only when a row carries one", () => {
    const captured = session({ intentSource: "captured", scope: [] });

    expect(renderMarkdownWeek([captured], 7, priced, NOW)).toContain(
      "~ 1 session recorded by the editor hook: intent captured from the first prompt, " +
        "no scope declared.",
    );
    expect(renderMarkdownWeek([session()], 7, priced, NOW)).not.toContain("recorded by the editor");
  });
});

describe("an empty window", () => {
  it("says so under the heading rather than printing an empty table", () => {
    expect(renderMarkdownWeek([], 7, priced, NOW).split("\n")).toEqual([
      "### AI-assisted work · 12–18 Aug",
      "",
      "No sessions with any changes in them were recorded in this window.",
    ]);
  });
});

describe("the document as a whole", () => {
  const week = [
    session({ startedAt: on(12) }),
    session({ startedAt: on(13), intentSource: "captured", outcome: "open" }),
    session({ startedAt: on(14), outcome: "empty", reality: [] }),
  ];

  it("is plain Markdown: no escape codes, no box drawing", () => {
    const document = renderMarkdownWeek(week, 7, priced, NOW);

    // Written as escapes rather than as the characters themselves, so the
    // assertion survives being copied through an editor that cannot show them.
    expect(document).not.toMatch(/\u001b\[/u);
    expect(document).not.toMatch(/[\u2500-\u257f]/u);
  });

  it("ends without a trailing newline, so a paste carries no blank line", () => {
    expect(renderMarkdownWeek(week, 7, priced, NOW).endsWith("\n")).toBe(false);
  });

  it("separates every block with exactly one blank line", () => {
    expect(renderMarkdownWeek(week, 7, priced, NOW)).not.toContain("\n\n\n");
  });
});
