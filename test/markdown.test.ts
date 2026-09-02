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

  it("leads with what shipped, what did not, and what went outside plan", () => {
    const week = [
      session({ startedAt: on(12) }),
      session({ startedAt: on(13), outcome: "open", drift: ["src/store.ts", "rates.json"] }),
    ];

    expect(lines(week)[2]).toBe(
      "**1 change shipped · 0 did not · 1 still open · 2 files touched outside plan**",
    );
  });

  it("keeps money out of the headline entirely", () => {
    // The agents meter their own spend; the document closes on the figure
    // rather than opening on it.
    expect(lines([session()])[2]).not.toContain("$");
  });

  it("drops the open clause when no session is still running", () => {
    const week = [
      session({ startedAt: on(12) }),
      session({ startedAt: on(13), outcome: "abandoned" }),
    ];

    expect(lines(week)[2]).toBe(
      "**1 change shipped · 1 did not · 0 files touched outside plan**",
    );
  });

  it("says one change and one file in the singular", () => {
    expect(lines([session({ drift: ["src/store.ts"] })])[2]).toBe(
      "**1 change shipped · 0 did not · 1 file touched outside plan**",
    );
  });

  it("names the five columns in week's order, cost last", () => {
    expect(lines([session()])[4]).toBe("| Date | Work | Outcome | Unplanned | Cost |");
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

    expect(rows[0]).toBe("| 12 Aug | add rate limiting to /orders | ✅ | 0 | $1.50 |");
    expect(rows[1]).toBe("| 13 Aug | add rate limiting to /orders |  | 0 | $1.50 |");
    expect(rows[2]).toBe("| 14 Aug | add rate limiting to /orders |  | 0 | $1.50 |");
  });

  it("closes the table with a bold total row", () => {
    const week = [
      session({ startedAt: on(12) }),
      session({ startedAt: on(13), outcome: "open", drift: ["a.ts", "b.ts"] }),
    ];

    expect(lines(week).find((line) => line.includes("**Total**"))).toBe(
      "| **Total** | **2 sessions** | **1 ✅** | **2** |  |",
    );
  });

  it("leaves the cost cell of the total row empty, so the closing line is the only total", () => {
    const document = renderMarkdownWeek([session()], 7, priced, NOW);
    const total = lines([session()]).find((line) => line.includes("**Total**")) as string;

    expect(total).not.toContain("$");
    expect(document.split("\n").at(-1)).toBe("**$1.50 spent · $1.50 per shipped change**");
  });

  it("leaves the tick off the total row when nothing shipped", () => {
    expect(lines([session({ outcome: "open" })]).find((line) => line.includes("**Total**"))).toBe(
      "| **Total** | **1 session** |  | **0** |  |",
    );
  });

  it("closes on what the week cost, and what each shipped change cost", () => {
    const week = [
      session({ startedAt: on(12), outcome: "merged" }),
      // Money that never landed is part of what the change that did land cost.
      session({ startedAt: on(13), outcome: "abandoned" }),
    ];

    expect(lines(week).at(-1)).toBe("**$3.00 spent · $3.00 per shipped change**");
  });

  it("still closes on the spend when nothing merged, without the ratio", () => {
    const document = renderMarkdownWeek([session({ outcome: "open" })], 7, priced, NOW);

    expect(document.split("\n").at(-1)).toBe("**$1.50 spent**");
    expect(document).not.toContain("per shipped change");
    expect(document).not.toContain("—");
  });

  it("omits the ratio when no session could be priced, rather than dividing nothing", () => {
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
    // "Below", since the figure it points at is the closing line now.
    expect(lines(week).find((line) => line.startsWith("The cost below"))).toBe(
      "The cost below covers 1 of 2 sessions. 1 session ran on a model with no rate (mystery-9).",
    );
  });

  it("never gives a total that quietly leaves them out", () => {
    const document = renderMarkdownWeek(week, 7, priced, NOW);

    // The total is $1.50, and the document says out loud that it is a total of
    // one of the two rows rather than of both.
    // Two sessions merged; only one of them could be priced, and the ratio is
    // over both — which is exactly why the note above says so out loud.
    expect(document.split("\n").at(-1)).toBe("**$1.50 spent · $0.75 per shipped change**");
    expect(document).toContain("covers 1 of 2 sessions");
  });

  it("says a session with nothing captured was not captured, never $0.00", () => {
    // No turns on the record, so nothing was captured to price — and it may
    // still have changed files and been billed for. `$0.00` would say the work
    // was free; `unpriced` would send the reader to a rates file that cannot
    // help, since there is no model on the record to give a rate to.
    const document = renderMarkdownWeek([session({ cost: zeroCost() })], 7, priced, NOW);

    expect(document).toContain("| not captured |");
    expect(document).not.toContain("$0.00");
    expect(document).not.toContain("no rate (");
    // Counted, so no cell says something the note underneath does not.
    expect(document).toContain(
      "1 session had no turns on the record, so nothing was captured to price.",
    );
  });
});

describe("a week where nothing could be priced", () => {
  const unpriced = (day: number, over: Partial<Session> = {}): Session =>
    session({
      startedAt: on(day),
      cost: cost({ model: "mystery-9", inputTokens: 100_000 }),
      ...over,
    });

  it("says nothing could be priced rather than claiming the week cost nothing", () => {
    const week = [unpriced(12), unpriced(13, { outcome: "open" })];

    // The dash and the wording are `week`'s, through `spentFigure`: the
    // terminal and this document must answer "what did it cost" the same way.
    expect(lines(week).at(-1)).toBe("**— spent: nothing here could be priced**");
  });

  it("never puts $0.00 anywhere in a week nobody can price", () => {
    expect(renderMarkdownWeek([unpriced(12)], 7, priced, NOW)).not.toContain("$0.00");
  });

  it("names every model it has no rate for", () => {
    const week = [unpriced(12), unpriced(13, { cost: cost({ model: "other-7", inputTokens: 5000 }) })];

    expect(renderMarkdownWeek(week, 7, priced, NOW)).toContain("no rate (mystery-9, other-7)");
  });

  it("leaves the total row's cost cell empty, dash and all", () => {
    const week = [unpriced(12), unpriced(13)];

    expect(lines(week).find((line) => line.includes("**Total**"))).toBe(
      "| **Total** | **2 sessions** | **2 ✅** | **0** |  |",
    );
  });

  it("says how many sessions that was, and what to do about it", () => {
    const week = [unpriced(12), unpriced(13)];

    expect(lines(week).find((line) => line.includes("no rate"))).toBe(
      "2 sessions ran on a model with no rate (mystery-9). Add one to ~/.session/rates.json.",
    );
  });

  it("does not point at a cost that covers none of them", () => {
    // The other shape of this note reads "The cost below covers 0 of 2
    // sessions", which sends the reader looking for a figure the document
    // deliberately did not print.
    const document = renderMarkdownWeek([unpriced(12), unpriced(13)], 7, priced, NOW);

    expect(document).not.toContain("The cost below");
  });

  it("still omits the cost per shipped change", () => {
    expect(renderMarkdownWeek([unpriced(12)], 7, priced, NOW)).not.toContain("per shipped change");
  });

  it("leaves a week that genuinely cost nothing reading $0.00", () => {
    // A session that ran, on a model with a rate, and moved nothing worth
    // charging for: the nought was measured. This is why the test is not
    // simply `usd === 0`, and why it is not `no tokens` either.
    const free = session({ cost: cost() });
    const document = renderMarkdownWeek([free], 7, priced, NOW);

    expect(document.split("\n").at(-1)).toBe("**$0.00 spent**");
    expect(document).toContain("| $0.00 |");
    expect(document).not.toContain("—");
  });

  it("says nothing could be priced when the only priced session cost nothing", () => {
    // One session with a rate and no tokens, one with tokens and no rate. The
    // total is $0.00 and it is not the week's cost, so it is not printed.
    const free = session({ startedAt: on(12), cost: cost() });
    const document = renderMarkdownWeek([free, unpriced(13)], 7, priced, NOW);

    expect(document.split("\n").at(-1)).toBe("**— spent: nothing here could be priced**");
    expect(document).not.toContain("$0.00 spent");
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
    // $1.50, not $1.80: every figure is over the rows the table lists, and the
    // $0.30 is accounted for in its own line rather than folded in silently.
    const document = renderMarkdownWeek(week, 7, priced, NOW);

    expect(document.split("\n").at(-1)).toBe("**$1.50 spent · $1.50 per shipped change**");
    expect(document).toContain("costing $0.30");
    expect(lines(week)[2]).toBe("**1 change shipped · 0 did not · 0 files touched outside plan**");
  });

  it("says so and stops when every session in the window was one", () => {
    const document = renderMarkdownWeek([week[1] as Session], 7, priced, NOW);

    expect(document).toContain("No sessions with any changes in them");
    expect(document).toContain("1 session changed no files");
    expect(document).not.toContain("| Date |");
  });

  it("leaves the cost off when they cost nothing", () => {
    const free = session({ outcome: "empty", reality: [], cost: cost() });
    const document = renderMarkdownWeek([session(), free], 7, priced, NOW);

    expect(document).toContain("1 session changed no files and is not in the table.");
  });

  it("says nothing was captured rather than naming a model it does not have", () => {
    // These sessions are not in the table, so this line is the only place the
    // document can admit the gap. Silence would read like the free session
    // above, and `an amount no rate covers ()` would admit a gap and then fail
    // to say what it was.
    const uncaptured = session({ outcome: "empty", reality: [], cost: zeroCost() });
    const document = renderMarkdownWeek([session(), uncaptured], 7, priced, NOW);

    expect(document).toContain(
      "1 session changed no files and is not in the table, and nothing was captured " +
        "to say what they cost.",
    );
  });

  it("says the cost is uncoverable rather than dropping it, when no rate covers it", () => {
    // These sessions are not in the table, so the unpriced note above never
    // counts them: this line is the only place the document can admit that
    // some of the bill has no rate behind it. Silence here would read exactly
    // like the free session above.
    const mystery = session({
      outcome: "empty",
      reality: [],
      cost: cost({ model: "mystery-9", inputTokens: 100_000, turns: 3, apiCalls: 9 }),
    });
    const document = renderMarkdownWeek([session(), mystery], 7, priced, NOW);

    expect(document).toContain(
      "1 session changed no files and is not in the table, " +
        "costing an amount no rate covers (mystery-9).",
    );
    expect(document).not.toContain("costing $0.00");
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
