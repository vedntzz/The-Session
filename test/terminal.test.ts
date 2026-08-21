import { describe, expect, it } from "vitest";
import type { RateTable } from "../src/pricing.js";
import { plainPalette, type Palette } from "../src/render/palette.js";
import {
  formatBrief,
  formatCommands,
  formatHome,
  formatSession,
  formatWeek,
  type View,
} from "../src/render/terminal.js";
import { zeroCost, zeroTokens, type Session, type SessionCost } from "../src/store.js";

/**
 * Built from a local-time Date, so the clock reads 14:02 wherever the test
 * runs. The formatter prints wall-clock time, which is timezone-dependent by
 * design; pinning the timezone here would only test the pin.
 */
function at(hour: number, minute: number, day = 15): string {
  return new Date(2026, 0, day, hour, minute).toISOString();
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    repo: "remote:github.com/acme/tool",
    intent: "add rate limiting to /orders",
    scope: [],
    baseline: [],
    reality: [],
    drift: [],
    cost: zeroCost(),
    outcome: "open",
    startedAt: at(14, 2),
    endedAt: at(14, 39),
    startCommit: "abc1234",
    ...overrides,
  };
}

/**
 * One model at one price, so the dollar figures in these tests can be checked
 * by hand: at $15 per million input tokens, 84,200 input tokens is $1.263.
 */
const RATES: RateTable = new Map([
  ["claude-opus-4-1", { input: 15, cacheRead: 1.5, cacheCreation: 18.75, output: 75 }],
]);

/** What the CLI passes in. Every cost here is on a model the table knows. */
const priced: View = { rates: RATES };

function cost(overrides: Partial<SessionCost> = {}): SessionCost {
  return { ...zeroCost(), model: "claude-opus-4-1", ...overrides };
}

/** Renders with no colour, which is what the layout assertions care about. */
function render(overrides: Partial<Session> = {}, view: View = priced): string[] {
  return formatSession(session(overrides), plainPalette, view);
}

/**
 * Marks up where colour lands, by role rather than by ink: these tests assert
 * that the drift path is treated as drift, not that drift is red. Which ink a
 * role gets is `palette.test.ts`'s business.
 */
const tagged: Palette = {
  intent: (text) => `<intent>${text}</intent>`,
  drift: (text) => `<drift>${text}</drift>`,
  waste: (text) => `<waste>${text}</waste>`,
  path: (text) => `<path>${text}</path>`,
  meta: (text) => `<meta>${text}</meta>`,
  merged: (text) => `<merged>${text}</merged>`,
  abandoned: (text) => `<abandoned>${text}</abandoned>`,
};

/** Strips the markup `tagged` adds, leaving what the reader would see. */
function visible(text: string): string {
  return text.replace(/<\/?(?:intent|drift|waste|path|meta|merged|abandoned)>/g, "");
}

function line(lines: string[], label: string): string | undefined {
  return lines.find((text) => visible(text).trimStart().startsWith(label));
}

describe("formatSession", () => {
  it("renders the whole session the way the readme shows it", () => {
    const lines = render({
      scope: ["api/orders.py", "api/middleware/"],
      reality: ["api/middleware/rate_limit.py", "api/orders.py", "db/schema.py"],
      drift: ["db/schema.py"],
      cost: cost({
        inputTokens: 1_200,
        cacheReadTokens: 70_000,
        cacheCreationTokens: 12_000,
        outputTokens: 1_000,
        turns: 3,
        emptyTurns: 1,
        apiCalls: 41,
        callsWithoutEdits: 30,
        emptyTurnTokens: {
          inputTokens: 400,
          cacheReadTokens: 20_000,
          cacheCreationTokens: 0,
          outputTokens: 200,
        },
      }),
    });

    expect(lines).toEqual([
      "",
      "  add rate limiting to /orders                          14:02 → 14:39",
      "",
      "  declared    api/orders.py  api/middleware/",
      "  changed     api/middleware/rate_limit.py  api/orders.py",
      "  outside     ! db/schema.py                            ← you did not declare this",
      "",
      "  cost        $0.42                                     3 turns, 1 without edits",
      "  no edits    $0.05                                     41 api calls, 30 without edits",
      "  outcome     open",
    ]);
  });

  it("leads with the money, and keeps the counts beside it", () => {
    const lines = render({ cost: cost({ outputTokens: 1_000_000, turns: 2, apiCalls: 5 }) });

    // $75 per million output tokens, so this is a whole million of them.
    expect(line(lines, "cost")).toContain("$75.00");
    expect(lines.some((text) => text.includes("tokens"))).toBe(false);
  });

  it("prices the turns that changed no files from what was counted, not from a share", () => {
    const lines = render({
      cost: cost({
        outputTokens: 1_000_000,
        turns: 4,
        emptyTurns: 1,
        apiCalls: 5,
        // A quarter of the turns, but four fifths of the money. Apportioning by
        // the turn count would have reported $18.75 and called it a measurement.
        emptyTurnTokens: { ...zeroTokens(), outputTokens: 800_000 },
      }),
    });

    expect(line(lines, "no edits")).toContain("$60.00");
  });

  it("says the split is not recorded rather than inventing one", () => {
    const old = cost({ outputTokens: 1_000_000, turns: 4, emptyTurns: 2, apiCalls: 5 });
    delete old.emptyTurnTokens;

    expect(line(render({ cost: old }), "no edits")).toContain("not recorded");
  });

  it("reports tokens and names the unpriced model rather than guessing a price", () => {
    const lines = render({
      cost: cost({ model: "claude-opus-5", inputTokens: 84_200, turns: 3, apiCalls: 4 }),
    });

    expect(line(lines, "cost")).toContain("84,200 tokens, claude-opus-5 unpriced");
    expect(lines.some((text) => text.includes("$"))).toBe(false);
  });

  it("spells out the four counters when --tokens asks for them", () => {
    const lines = render(
      {
        cost: cost({
          inputTokens: 1_200,
          cacheReadTokens: 70_000,
          cacheCreationTokens: 12_000,
          outputTokens: 1_000,
          turns: 3,
          apiCalls: 41,
        }),
      },
      { ...priced, tokens: true },
    );

    expect(line(lines, "tokens")).toBe(
      "  tokens      1,200 in · 70,000 cache read · 12,000 cache write · 1,000 out",
    );
  });

  it("has no tests line: the record has no test results in it", () => {
    const lines = render({ reality: ["a.py"], cost: cost({ turns: 1, apiCalls: 2 }) });
    expect(lines.some((text) => text.includes("tests"))).toBe(false);
  });

  it("puts the times in the gutter, at the same column as the counts", () => {
    const lines = render({ cost: cost({ turns: 3, apiCalls: 4, inputTokens: 10 }) });

    const times = lines[1] as string;
    const spend = line(lines, "cost") as string;
    expect(times.indexOf("14:02")).toBe(56);
    expect(spend.indexOf("3 turns")).toBe(56);
  });

  it("keeps a gap in front of the gutter when the left side runs long", () => {
    const lines = render({ intent: "x".repeat(80) });
    expect(lines[1]).toBe(`  ${"x".repeat(80)}  14:02 → 14:39`);
  });

  it("splits reality into what stayed in scope and what drifted, listing each path once", () => {
    const lines = render({
      scope: ["api/"],
      reality: ["api/orders.py", "db/schema.py", "web/app.ts"],
      drift: ["db/schema.py", "web/app.ts"],
    });

    expect(line(lines, "changed")).toBe("  changed     api/orders.py");
    expect(line(lines, "outside")).toBe(
      "  outside     ! db/schema.py  ! web/app.ts" +
        " ".repeat(14) +
        "← you did not declare these",
    );
  });

  it("marks every drift path, so drift survives being piped somewhere colourless", () => {
    const lines = render({ reality: ["a.py", "b.py"], drift: ["a.py", "b.py"] });
    expect(line(lines, "outside")).toContain("! a.py  ! b.py");
  });

  it("marks the declared and in-scope paths as paths and the drift as drift", () => {
    const lines = formatSession(
      session({
        scope: ["api/"],
        reality: ["api/orders.py", "db/schema.py"],
        drift: ["db/schema.py"],
      }),
      tagged,
    );

    expect(line(lines, "declared")).toBe("  <meta>declared    </meta><path>api/</path>");
    expect(line(lines, "changed")).toBe("  <meta>changed     </meta><path>api/orders.py</path>");
    expect(line(lines, "outside")).toContain("<drift>! db/schema.py</drift>");
    expect(line(lines, "outside")).not.toContain("<path>! db/schema.py</path>");
  });

  it("aligns the drift note against the visible text, not the colour codes", () => {
    const lines = formatSession(
      session({ reality: ["db/schema.py"], drift: ["db/schema.py"] }),
      tagged,
    );

    const outside = line(lines, "outside") as string;
    expect(visible(outside).indexOf("←")).toBe(56);
  });

  it("omits the outside line entirely when nothing drifted", () => {
    const lines = render({ scope: ["api/"], reality: ["api/orders.py"] });
    expect(lines.some((text) => text.includes("outside"))).toBe(false);
  });

  it("says nothing changed when the session changed nothing", () => {
    expect(line(render(), "changed")).toBe("  changed     nothing");
  });

  it("omits the changed line when every path that changed drifted", () => {
    const lines = render({ reality: ["db/schema.py"], drift: ["db/schema.py"] });

    expect(lines.some((text) => text.includes("changed"))).toBe(false);
    expect(line(lines, "outside")).toContain("! db/schema.py");
  });

  it("says so when no scope was declared", () => {
    expect(line(render(), "declared")).toBe("  declared    none declared");
  });

  it("omits the cost lines when no adapter reported anything", () => {
    const lines = render({ reality: ["a.py"] });

    expect(lines.some((text) => text.includes("turns"))).toBe(false);
    expect(lines.some((text) => text.includes("api call"))).toBe(false);
  });

  it("counts turns and calls that produced nothing, rather than dropping them", () => {
    const lines = render({ cost: cost({ turns: 4, emptyTurns: 4, apiCalls: 9, callsWithoutEdits: 9 }) });

    expect(line(lines, "cost")).toContain("4 turns, 4 without edits");
    expect(line(lines, "no edits")).toContain("9 api calls, 9 without edits");
  });

  it("keeps a single turn and a single call singular", () => {
    const lines = render({ cost: cost({ turns: 1, emptyTurns: 0, apiCalls: 1 }) });

    expect(line(lines, "cost")).toContain("1 turn, 0 without edits");
    expect(line(lines, "no edits")).toContain("1 api call, 0 without edits");
  });

  it("totals the four token counters when it cannot price them", () => {
    const lines = render({
      cost: cost({
        model: "claude-opus-5",
        inputTokens: 1_200,
        cacheReadTokens: 70_000,
        cacheCreationTokens: 12_000,
        outputTokens: 1_000,
        turns: 1,
        apiCalls: 1,
      }),
    });

    expect(line(lines, "cost")).toContain("84,200 tokens");
  });

  it("reports the outcome", () => {
    expect(line(render({ outcome: "merged" }), "outcome")).toBe("  outcome     merged");
  });

  it("says a session is still running when it has no end time", () => {
    expect(render({ endedAt: null })[1]).toContain("14:02 → still running");
  });

  it("measures the intent in code points, so an astral character does not shift the gutter", () => {
    // "𝚡" is one character and two UTF-16 units; measuring it as two would
    // pull the times a column to the left.
    const lines = render({ intent: "fix the 𝚡 spacing" });
    expect([...(lines[1] as string)].indexOf("1")).toBe(56);
  });
});

/** The three sessions the week tests read against. */
function week(): Session[] {
  return [
    session({
      intent: "add rate limiting to /orders",
      startedAt: at(9, 14),
      cost: cost({ inputTokens: 84_200, turns: 3, emptyTurns: 1, apiCalls: 41 }),
      outcome: "open",
    }),
    session({
      intent: "refactor the transcript store adapter",
      startedAt: at(11, 2),
      cost: cost({ inputTokens: 412_900, turns: 12, emptyTurns: 5, apiCalls: 130 }),
      outcome: "merged",
    }),
    session({
      intent: "try the websocket thing",
      startedAt: at(8, 31, 16),
      cost: cost({ inputTokens: 103_110, turns: 4, emptyTurns: 4, apiCalls: 22 }),
      outcome: "abandoned",
    }),
  ];
}

/**
 * Where a cell ends, which is the column right-aligned figures share. The
 * cell has to stand alone: a bare "1" also occurs inside "01-15 09:14".
 */
function endOf(text: string, cell: string): number {
  const at = visible(text).search(new RegExp(`(?<=\\s)${cell}(?=\\s|$)`));
  expect(at, `${cell} not found in ${text}`).toBeGreaterThan(-1);
  return at + cell.length;
}

describe("a session the hook recorded", () => {
  /** As the hook leaves one: intent from the first prompt, no scope. */
  const captured = { intentSource: "captured" as const, scope: [] };

  it("says the intent was captured rather than declared", () => {
    const lines = render({ ...captured, reality: ["api/orders.py"] });

    expect(visible(line(lines, "intent") as string)).toBe(
      "  intent      captured from the first prompt, not declared",
    );
  });

  it("says nothing of the sort for a session somebody declared", () => {
    // The ordinary case says so by having no line about it.
    expect(line(render({ reality: ["api/orders.py"] }), "intent")).toBeUndefined();
  });

  it("says there was no scope to drift from, rather than 'none declared'", () => {
    const lines = render({ ...captured, reality: ["api/orders.py"] });

    expect(visible(line(lines, "declared") as string)).toContain(
      "no scope — nothing was declared to drift from",
    );
  });

  it("points at what makes drift visible", () => {
    const lines = render({ ...captured, reality: ["api/orders.py"] });

    expect(visible(line(lines, "declared") as string)).toContain(
      "← session start --scope is what makes drift visible",
    );
  });

  it("prints no outside line, because there is no drift to print", () => {
    const lines = render({ ...captured, reality: ["api/orders.py", "db/schema.py"] });

    expect(line(lines, "outside")).toBeUndefined();
    expect(visible(line(lines, "changed") as string)).toBe(
      "  changed     api/orders.py  db/schema.py",
    );
  });

  it("lays the whole thing out with the scope line where a scope would be", () => {
    expect(render({ ...captured, reality: ["api/orders.py"] }, {})).toEqual([
      "",
      "  add rate limiting to /orders                          14:02 → 14:39",
      "",
      "  intent      captured from the first prompt, not declared",
      "  declared    no scope — nothing was declared to drift from" +
        "  ← session start --scope is what makes drift visible",
      "  changed     api/orders.py",
      "",
      "  outcome     open",
    ]);
  });

  it("says so where the intent goes when no prompt ever arrived", () => {
    const lines = render({ ...captured, intent: null });

    expect(lines[1]).toContain("(no prompt)");
  });

  it("says the prompt is still to come while the session is running", () => {
    const lines = render({ ...captured, intent: null, endedAt: null });

    expect(lines[1]).toContain("(no prompt yet)");
    expect(lines[1]).toContain("still running");
  });

  it("marks the intent as the intent, whether it was declared or captured", () => {
    const lines = formatSession(session({ ...captured }), tagged, priced);

    expect(lines[1]).toContain("<intent>add rate limiting to /orders</intent>");
  });
});

describe("formatWeek", () => {
  it("renders one row per session, with a totals footer", () => {
    expect(formatWeek(week(), 7, plainPalette, {}, priced)).toEqual([
      "",
      "  started      intent                         cost  turns  empty  outcome",
      "  01-15 09:14  add rate limiting to /orders  $1.26      3      1  open",
      "  01-15 11:02  refactor the transcript sto…  $6.19     12      5  merged",
      "  01-16 08:31  try the websocket thing       $1.55      4      4  abandoned",
      "",
      "  3 sessions                                 $9.00     19     10",
      "  $9.00 spent, $2.81 of it on changes that never merged",
      "  10 of 19 turns changed no files",
    ]);
  });

  it("leaves the class column out until --class asks for it", () => {
    const lines = formatWeek(week(), 7, plainPalette, {}, priced);

    expect(lines[1]).not.toContain("class");
  });

  it("adds the class column when --class asks for it", () => {
    const classed = [
      session({ intent: "rate limit /orders", reality: ["src/api/orders.ts"] }),
      session({ intent: "restyle the header", reality: ["src/components/Header.tsx"] }),
    ];

    const lines = formatWeek(classed, 7, plainPalette, {}, { ...priced, classes: true });

    expect(lines[1]).toContain("class");
    expect(lines[2]).toContain("api");
    expect(lines[3]).toContain("ui");
  });

  it("marks the rows the hook recorded, and says underneath what the mark means", () => {
    const rows = [
      session({ intent: "add rate limiting", startedAt: at(9, 14), cost: cost({ turns: 1 }) }),
      session({
        intent: "why does /orders 500",
        intentSource: "captured",
        startedAt: at(11, 2),
        cost: cost({ turns: 1 }),
      }),
    ];

    const lines = formatWeek(rows, 7, plainPalette, {}, priced);

    expect(lines[2]).toContain("add rate limiting");
    expect(lines[2]).not.toContain("~");
    expect(lines[3]).toContain("~ why does /orders 500");
    expect(lines.at(-1)).toBe(
      "  ~ 1 session recorded by the hook: intent captured from the first prompt, " +
        "no scope declared",
    );
  });

  it("says nothing about the mark when no row carries one", () => {
    const lines = formatWeek(week(), 7, plainPalette, {}, priced);

    expect(lines.some((text) => text.includes("recorded by the hook"))).toBe(false);
  });

  it("counts the marked rows in the plural", () => {
    const rows = [
      session({ intent: "one", intentSource: "captured", cost: cost({ turns: 1 }) }),
      session({ intent: "two", intentSource: "captured", cost: cost({ turns: 1 }) }),
    ];

    expect(formatWeek(rows, 7, plainPalette, {}, priced).at(-1)).toContain("~ 2 sessions");
  });

  it("keeps the marked intent inside its column", () => {
    const long = session({
      intent: "why does /orders 500 when the cart is empty and the user is new",
      intentSource: "captured",
      cost: cost({ turns: 1 }),
    });

    const [, headings, row] = formatWeek([long], 7, plainPalette, {}, priced) as string[];

    // The marker lives inside the intent column, so the figures beside it
    // still line up under their headings.
    expect((row as string).includes("~ why does /orders 500 when…")).toBe(true);
    expect(endOf(row as string, "1")).toBe(endOf(headings as string, "turns"));
  });

  it("keeps the totals label spanning the columns on the left", () => {
    const lines = formatWeek(week(), 7, plainPalette, {}, { ...priced, classes: true });
    const [, headings, , , , , totals] = lines as string[];

    // The figures still line up under their headings once a column is added.
    expect(endOf(totals as string, "19")).toBe(endOf(headings as string, "turns"));
  });

  it("adds the tokens column back when --tokens asks for it", () => {
    const lines = formatWeek(week(), 7, plainPalette, {}, { ...priced, tokens: true });

    expect(lines[1]).toBe(
      "  started      intent                         cost  turns   tokens  empty  outcome",
    );
    expect(lines[2]).toBe("  01-15 09:14  add rate limiting to /orders  $1.26      3   84,200      1  open");
  });

  it("right-aligns every figure under its heading, footer included", () => {
    const lines = formatWeek(week(), 7, plainPalette, {}, priced);
    const headings = lines[1] as string;
    // The three session rows, then the totals row: all four share the columns.
    const rows = [lines[2], lines[3], lines[4], lines[6]] as string[];

    for (const [heading, cells] of [
      ["cost", ["$1.26", "$6.19", "$1.55", "$9.00"]],
      ["turns", ["3", "12", "4", "19"]],
      ["empty", ["1", "5", "4", "10"]],
    ] as const) {
      const edge = headings.indexOf(heading) + heading.length;
      for (const [index, cell] of cells.entries()) {
        const row = rows[index] as string;
        expect(row.slice(edge - cell.length, edge)).toBe(cell);
        // Whatever precedes the figure is padding, never another column.
        expect(row[edge - cell.length - 1]).toBe(" ");
      }
    }
  });

  it("left-aligns the intents in one column", () => {
    const rows = formatWeek(week(), 7, plainPalette, {}, priced).slice(2, 5);
    const starts = rows.map((row) => row.indexOf("  ", 2) + 2);

    expect(new Set(starts).size).toBe(1);
  });

  it("truncates an intent that would widen the table, and marks the cut", () => {
    const [, , , second] = formatWeek(week(), 7, plainPalette, {}, priced) as string[];

    expect(second).toContain("refactor the transcript sto…");
    expect(second).not.toContain("adapter");
  });

  it("leaves an intent that fits exactly alone", () => {
    // 28 characters: the width of the column, so nothing should be cut.
    const [, , first] = formatWeek(week(), 7, plainPalette, {}, priced) as string[];
    expect(first).toContain("add rate limiting to /orders");
  });

  it("writes off abandoned sessions and leaves the others in normal weight", () => {
    const lines = formatWeek(week(), 7, tagged, {}, priced);

    expect(lines[4]).toMatch(/^<abandoned> {2}01-16 08:31/);
    expect(lines[4]).toMatch(/abandoned<\/abandoned>$/);
    expect(lines[3]).not.toContain("<abandoned>");
    expect(lines[2]).not.toContain("<abandoned>");
  });

  it("writes off the whole row, so the eye can drop the figures too", () => {
    const abandoned = formatWeek(week(), 7, tagged, {}, priced)[4] as string;
    expect(visible(abandoned)).toBe(formatWeek(week(), 7, plainPalette, {}, priced)[4]);
    // One ink and no other: nothing inside a row that has been written off
    // gets to argue with the strike.
    expect(abandoned.match(/<abandoned>/g)).toHaveLength(1);
    expect(abandoned).not.toContain("<intent>");
  });

  it("marks a merged outcome, and leaves an open one in the terminal's own colour", () => {
    const lines = formatWeek(week(), 7, tagged, {}, priced);

    expect(lines[3]).toMatch(/<merged>merged<\/merged>$/);
    expect(lines[2]).toMatch(/ {2}open$/);
  });

  it("marks each live row's intent, and nothing else in it", () => {
    const [, , first] = formatWeek(week(), 7, tagged, {}, priced) as string[];

    expect(first).toContain("<intent>add rate limiting to /orders</intent>");
    expect(visible(first as string)).toBe(formatWeek(week(), 7, plainPalette, {}, priced)[2]);
  });

  it("does not pad past the outcome, so a struck row has no trailing rule", () => {
    for (const line of formatWeek(week(), 7, plainPalette, {}, priced)) {
      expect(line).toBe(line.trimEnd());
    }
  });

  it("treats the headings and the waste line as metadata, not the rows", () => {
    const lines = formatWeek(week(), 7, tagged, {}, priced);

    expect(lines[1]).toMatch(/^<meta>.*<\/meta>$/);
    expect(lines.at(-1)).toBe("<meta>  10 of 19 turns changed no files</meta>");
    expect(lines[2]).not.toContain("<meta>");
  });

  it("totals cost, turns and empty turns across the week", () => {
    const footer = formatWeek(week(), 7, plainPalette, {}, priced).at(-3) as string;
    expect(footer).toBe("  3 sessions                                 $9.00     19     10");
  });

  it("counts every session in the footer, abandoned ones included", () => {
    // Abandoned work still cost money; leaving it out would flatter the week.
    const footer = formatWeek(week(), 7, plainPalette, {}, priced).at(-3) as string;
    expect(footer).toContain("3 sessions");
  });

  it("says what the week cost and how much of it never merged", () => {
    const lines = formatWeek(week(), 7, plainPalette, {}, priced);

    // $1.26 open plus $1.55 abandoned; the $6.19 that merged is not waste.
    expect(lines.at(-2)).toBe("  $9.00 spent, $2.81 of it on changes that never merged");
  });

  it("omits the money when nothing in the window could be priced", () => {
    const unpriced = week().map((one) => ({
      ...one,
      cost: { ...one.cost, model: "claude-opus-5" },
    }));
    const lines = formatWeek(unpriced, 7, plainPalette, {}, priced);

    expect(lines.some((text) => text.includes("spent"))).toBe(false);
    expect(lines.at(-2)).toBe(
      "  3 sessions unpriced: claude-opus-5 — add rates to ~/.session/rates.json",
    );
  });

  it("admits how much of a total it could not price", () => {
    // Otherwise the total silently means "the sessions I happened to know a
    // rate for", which is exactly the number that ends up on an invoice.
    const [first, ...rest] = week();
    const mixed = [{ ...(first as Session), cost: { ...(first as Session).cost, model: "gpt-9" } }, ...rest];
    const lines = formatWeek(mixed, 7, plainPalette, {}, priced);

    expect(lines.at(-3)).toBe("  $7.74 spent, $1.55 of it on changes that never merged");
    expect(lines.at(-2)).toContain("1 session unpriced: gpt-9");
  });

  it("names the count of turns that changed no files", () => {
    expect(formatWeek(week(), 7, plainPalette, {}, priced).at(-1)).toBe("  10 of 19 turns changed no files");
  });

  it("keeps a lone turn singular in the waste line", () => {
    const one = session({ cost: cost({ turns: 1, emptyTurns: 0, apiCalls: 1 }) });
    expect(formatWeek([one], 7, plainPalette, {}, priced).at(-1)).toBe("  0 of 1 turn changed no files");
  });

  it("omits the waste line when no turns were captured at all", () => {
    const lines = formatWeek([session()], 7, plainPalette, {}, priced);
    expect(lines.some((text) => text.includes("changed no files"))).toBe(false);
  });

  it("says so when the window is empty", () => {
    expect(formatWeek([], 7, plainPalette, {}, priced)).toEqual(["", "  No sessions in the last 7 days"]);
  });

  it("names the window it found nothing in", () => {
    expect(formatWeek([], 1, plainPalette, {}, priced)[1]).toBe("  No sessions in the last 1 day");
    expect(formatWeek([], 30, plainPalette, {}, priced)[1]).toBe("  No sessions in the last 30 days");
  });

  it("dates each row, so a window wider than a day stays readable", () => {
    const rows = formatWeek(week(), 30, plainPalette, {}, priced).slice(2, 5);
    expect(rows.map((row) => row.slice(2, 13))).toEqual([
      "01-15 09:14",
      "01-15 11:02",
      "01-16 08:31",
    ]);
  });

  it("widens the figure columns rather than letting a big number break alignment", () => {
    const heavy = session({ cost: cost({ cacheReadTokens: 12_345_678, turns: 2, apiCalls: 9 }) });
    const [, headings, row] = formatWeek([heavy], 7, plainPalette, {}, {
      ...priced,
      tokens: true,
    }) as string[];

    expect(endOf(row as string, "12,345,678")).toBe(endOf(headings as string, "tokens"));
  });

  it("shows a session that is still running, with the outcome it has so far", () => {
    const running = session({ endedAt: null, outcome: "open" });
    expect(formatWeek([running], 7, plainPalette, {}, priced)[2]).toMatch(/ {2}open$/);
  });
});

describe("attribution on show", () => {
  it("lists each declared field on its own labelled line", () => {
    const lines = formatSession(
      session({
        attribution: {
          client: "Acme",
          project: "orders-api",
          sow: "SOW-2026-014",
          billingCode: "ACME-ORD-1",
        },
      }),
      plainPalette,
    );

    expect(lines).toContain("  client      Acme");
    expect(lines).toContain("  project     orders-api");
    expect(lines).toContain("  sow         SOW-2026-014");
    expect(lines).toContain("  billingCode ACME-ORD-1");
  });

  it("says nothing at all when the session records none", () => {
    const lines = formatSession(session(), plainPalette);

    expect(lines.some((line) => line.includes("client"))).toBe(false);
  });

  it("keeps them next to the outcome, where what it was for belongs", () => {
    const lines = formatSession(session({ attribution: { client: "Acme" } }), plainPalette);

    expect(lines.at(-1)).toContain("outcome");
    expect(lines.at(-2)).toBe("  client      Acme");
  });
});

describe("a filtered week", () => {
  it("says what it was narrowed to, so the totals are not read as everything", () => {
    const lines = formatWeek(week(), 7, plainPalette, { client: "Acme" }, priced);

    expect(lines[1]).toBe("  only client Acme");
  });

  it("names both filters when both were given", () => {
    const lines = formatWeek(week(), 7, plainPalette, { client: "Acme", project: "orders-api" }, priced);

    expect(lines[1]).toBe("  only client Acme, project orders-api");
  });

  it("says nothing when the week was not narrowed", () => {
    expect(formatWeek(week(), 7, plainPalette, {}, priced)[1]).not.toContain("only");
  });

  it("names an intent-source filter, which nothing else in the table would say", () => {
    // A table of nothing but declared sessions carries no marker on any row,
    // which reads exactly like an unfiltered week.
    const lines = formatWeek(week(), 7, plainPalette, { intent: "declared" }, priced);

    expect(lines[1]).toBe("  only declared intents");
  });

  it("names it beside the others when both were given", () => {
    const lines = formatWeek(week(), 7, plainPalette, { client: "Acme", intent: "captured" }, priced);

    expect(lines[1]).toBe("  only client Acme, captured intents");
  });

  it("says which filter came up empty rather than just 'no sessions'", () => {
    const lines = formatWeek([], 7, plainPalette, { client: "Initech" }, priced);

    expect(lines).toEqual(["", "  No sessions in the last 7 days for client Initech"]);
  });

  it("says so for an intent-source filter that found nothing too", () => {
    const lines = formatWeek([], 7, plainPalette, { intent: "captured" }, priced);

    expect(lines).toEqual(["", "  No sessions in the last 7 days for captured intents"]);
  });

  it("still says the plain thing when an unfiltered week is empty", () => {
    expect(formatWeek([], 7, plainPalette, {}, priced)).toEqual(["", "  No sessions in the last 7 days"]);
  });
});

describe("a week where nothing could be priced", () => {
  const unpriced = cost({ model: "mystery-9", inputTokens: 100_000, turns: 3, apiCalls: 9 });

  it("puts a dash in the total row rather than a nought", () => {
    const lines = formatWeek([session({ cost: unpriced })], 7, plainPalette, {}, priced);
    const totals = lines.find((line) => line.includes("1 session")) as string;

    expect(totals).toContain("—");
    expect(totals).not.toContain("$0.00");
  });

  it("says nothing was spent rather than that nothing cost anything", () => {
    // The rule `--md` follows: a total of nought that exists only because no
    // rate was found is not a figure, so no figure is printed.
    const rendered = formatWeek([session({ cost: unpriced })], 7, plainPalette, {}, priced).join("\n");

    expect(rendered).not.toContain("$0.00 spent");
    expect(rendered).toContain("1 session unpriced: mystery-9");
  });

  it("says nothing about rates for a week that genuinely cost nothing", () => {
    // Nothing was captured, so no rate is missing and there is no gap to
    // report — the distinction `--md` draws with the same two counters.
    const free = formatWeek([session({ cost: cost() })], 7, plainPalette, {}, priced);

    expect(free.join("\n")).not.toContain("unpriced");
  });

  it("totals a week that genuinely cost nothing at $0.00, not a dash", () => {
    // The other half of the rule. The rows above read $0.00, so a dash in the
    // total row is an absence written over a column of noughts the reader can
    // see — a table that visibly does not add up.
    const free = formatWeek([session({ cost: cost() })], 7, plainPalette, {}, priced);
    const totals = free.find((line) => line.includes("1 session")) as string;

    expect(totals).toContain("$0.00");
    expect(totals).not.toContain("—");
  });

  it("dashes the total when the only priced session cost nothing", () => {
    // One session with a rate and no tokens, one with tokens and no rate.
    // The sum is nought and it is not what the week cost, so no figure.
    const mixed = formatWeek(
      [session({ cost: cost() }), session({ cost: unpriced })],
      7,
      plainPalette,
      {},
      priced,
    );
    const totals = mixed.find((line) => line.includes("2 sessions")) as string;

    expect(totals).toContain("—");
    expect(totals).not.toContain("$0.00");
  });
});

describe("formatBrief", () => {
  /** Renders the short `show` with no colour, which is the contract. */
  function brief(overrides: Partial<Session> = {}, view: View = priced): string[] {
    return formatBrief(session(overrides), plainPalette, view);
  }

  it("leads with what was asked for, in the developer's own words and quoted", () => {
    expect(brief()[1]).toBe('  You asked for "add rate limiting to /orders".');
  });

  it("says a captured intent was a prompt rather than a declaration", () => {
    const lines = brief({ intentSource: "captured", intent: "why does /orders 500" });

    expect(lines[1]).toBe(
      '  Your first prompt was "why does /orders 500", and you declared nothing up front.',
    );
  });

  it("says so plainly when nothing was ever asked", () => {
    expect(brief({ intent: null, intentSource: "captured" })[1]).toBe(
      "  Nothing was ever asked: the session ended before a prompt arrived.",
    );
  });

  it("names what went outside the scope, and how many", () => {
    const lines = brief({
      scope: ["src/api/"],
      reality: ["src/api/orders.ts", "src/store.ts"],
      drift: ["src/store.ts"],
    });

    expect(lines[2]).toBe("  1 file changed outside what you declared: src/store.ts.");
  });

  it("counts the rest rather than naming twelve paths in a sentence", () => {
    const drift = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"];
    const lines = brief({ scope: ["src/"], reality: drift, drift });

    // The count in front is exact; the list is what fits. `--full` has all five.
    expect(lines[2]).toBe("  5 files changed outside what you declared: a.ts, b.ts, c.ts, and 2 more.");
  });

  it("says when everything stayed inside", () => {
    const lines = brief({ scope: ["src/api/"], reality: ["src/api/orders.ts"] });

    expect(lines[2]).toBe("  Everything it changed stayed inside what you declared.");
  });

  it("says a session changed nothing before it says nothing was declared", () => {
    // The stronger fact. A session that changed nothing had nothing to go
    // outside a scope, so sending the reader to --scope answers nothing.
    expect(brief({ scope: [], reality: [] })[2]).toBe("  It changed no files at all.");
  });

  it("sends a reader with no scope to the flag that would have given them one", () => {
    const lines = brief({ scope: [], reality: ["src/store.ts"] });

    expect(lines[2]).toBe(
      "  Nothing was declared to compare against — run session start --scope to see drift.",
    );
  });

  it("puts the cost, the turns and the empty turns on one line and stops", () => {
    const lines = brief({
      cost: cost({ inputTokens: 100_000, turns: 9, emptyTurns: 3, apiCalls: 40 }),
    });

    expect(lines.at(-1)).toBe("  $1.50 · 9 turns · 3 produced nothing");
    // The api-call counters and the token breakdown are --full's business.
    expect(lines.join("\n")).not.toContain("api call");
    expect(lines.join("\n")).not.toContain("no edits");
  });

  it("reports an unpriced model rather than pricing it at a guess", () => {
    const lines = brief({
      cost: cost({ model: "mystery-9", inputTokens: 100_000, turns: 4, apiCalls: 9 }),
    });

    expect(lines.at(-1)).toContain("100,000 tokens, mystery-9 unpriced");
  });

  it("leaves the figures out when nothing was captured", () => {
    // A row of zeroes reads as a measurement of nothing rather than as an
    // absence of measurement.
    const lines = brief({ cost: zeroCost() });

    expect(lines).toHaveLength(3);
    expect(lines.join("\n")).not.toContain("turn");
  });

  it("inks the intent as intent and the drift as drift, and nothing else", () => {
    const lines = formatBrief(
      session({ scope: ["src/api/"], reality: ["src/store.ts"], drift: ["src/store.ts"] }),
      tagged,
      priced,
    );

    expect(lines[1]).toBe('  You asked for "<intent>add rate limiting to /orders</intent>".');
    expect(lines[2]).toBe("  1 file changed outside what you declared: <drift>src/store.ts</drift>.");
  });

  it("gives back the plain bytes when the ink is off", () => {
    // The same contract the rest of the terminal output keeps: colour is an
    // addition to a terminal, never a change to the output.
    const marked = formatBrief(session({ drift: ["src/store.ts"], scope: ["src/api/"] }), tagged, priced);
    const plain = brief({ drift: ["src/store.ts"], scope: ["src/api/"] });

    expect(marked.map((line) => line.replace(/<\/?\w+>/g, ""))).toEqual(plain);
  });
});

describe("formatHome", () => {
  it("says what is recording, and offers two commands", () => {
    const lines = formatHome({ running: session({ endedAt: null }) }, plainPalette, priced);

    expect(lines[1]).toBe("  Recording since 14:02: add rate limiting to /orders.");
    expect(lines.filter((line) => line.trim() !== "")).toHaveLength(3);
    expect(lines.at(-2)).toContain("session stop");
    expect(lines.at(-1)).toContain("session week");
  });

  it("says a passive session has not been given a prompt yet", () => {
    const running = session({ endedAt: null, intent: null, intentSource: "captured" });

    expect(formatHome({ running }, plainPalette, priced)[1]).toBe(
      "  Recording since 14:02: nothing asked yet.",
    );
  });

  it("names the last session and what it cost once nothing is running", () => {
    const last = session({ cost: cost({ inputTokens: 100_000 }) });

    expect(formatHome({ last }, plainPalette, priced)[1]).toBe(
      "  Nothing is recording. The last session ended at 14:39, costing $1.50.",
    );
  });

  it("leaves the money off a session no rate covers", () => {
    const last = session({ cost: cost({ model: "mystery-9", inputTokens: 100_000 }) });

    expect(formatHome({ last }, plainPalette, priced)[1]).toBe(
      "  Nothing is recording. The last session ended at 14:39.",
    );
  });

  it("tells an empty repo what to type", () => {
    const lines = formatHome({}, plainPalette, priced);

    expect(lines[1]).toBe("  No sessions recorded in this repo yet.");
    expect(lines.at(-2)).toContain('session start "…"');
    expect(lines.at(-1)).toContain("session hook install");
  });

  it("never offers more than two commands", () => {
    const states = [{ running: session({ endedAt: null }) }, { last: session() }, {}];

    for (const state of states) {
      const said = formatHome(state, plainPalette, priced).filter((line) => line.trim() !== "");
      expect(said).toHaveLength(3);
    }
  });
});

describe("formatCommands", () => {
  const entries = [
    { name: "start", description: "Begin a new session" },
    { name: "config set", description: "Set an attribution field" },
  ];

  it("lines the descriptions up in a column of their own", () => {
    const lines = formatCommands(entries, plainPalette);

    expect(lines).toContain("  start       Begin a new session");
    expect(lines).toContain("  config set  Set an attribution field");
  });

  it("says where the short list is, so the two are not confused", () => {
    expect(formatCommands(entries, plainPalette)[1]).toContain("session --help");
  });
});
