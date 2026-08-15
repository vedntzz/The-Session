import { describe, expect, it } from "vitest";
import { formatSession, formatWeek, plainPalette, type Palette } from "../src/render/terminal.js";
import { zeroCost, type Session, type SessionCost } from "../src/store.js";

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

function cost(overrides: Partial<SessionCost> = {}): SessionCost {
  return { ...zeroCost(), ...overrides };
}

/** Renders with no colour, which is what the layout assertions care about. */
function render(overrides: Partial<Session> = {}): string[] {
  return formatSession(session(overrides), plainPalette);
}

/** Marks up where colour lands, so placement can be asserted exactly. */
const tagged: Palette = {
  dim: (text) => `<dim>${text}</dim>`,
  bright: (text) => `<bright>${text}</bright>`,
  struck: (text) => `<struck>${text}</struck>`,
};

/** Strips the markup `tagged` adds, leaving what the reader would see. */
function visible(text: string): string {
  return text.replace(/<\/?(?:dim|bright|struck)>/g, "");
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
        model: "claude-opus-5",
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
      "  3 turns, 1 without edits                              84,200 tokens",
      "  41 api calls, 30 without edits",
      "  outcome     open",
    ]);
  });

  it("has no tests line: the record has no test results in it", () => {
    const lines = render({ reality: ["a.py"], cost: cost({ turns: 1, apiCalls: 2 }) });
    expect(lines.some((text) => text.includes("tests"))).toBe(false);
  });

  it("puts the times in the gutter, at the same column as the token count", () => {
    const lines = render({ cost: cost({ turns: 3, apiCalls: 4, inputTokens: 10 }) });

    const times = lines[1] as string;
    const spend = line(lines, "3 turns") as string;
    expect(times.indexOf("14:02")).toBe(56);
    expect(spend.indexOf("10 tokens")).toBe(56);
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

  it("dims the declared and in-scope paths and brightens the drift", () => {
    const lines = formatSession(
      session({
        scope: ["api/"],
        reality: ["api/orders.py", "db/schema.py"],
        drift: ["db/schema.py"],
      }),
      tagged,
    );

    expect(line(lines, "declared")).toBe("  <dim>declared    </dim><dim>api/</dim>");
    expect(line(lines, "changed")).toBe("  <dim>changed     </dim><dim>api/orders.py</dim>");
    expect(line(lines, "outside")).toContain("<bright>! db/schema.py</bright>");
    expect(line(lines, "outside")).not.toContain("<dim>! db/schema.py</dim>");
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

    expect(line(lines, "4 turns")).toContain("4 turns, 4 without edits");
    expect(line(lines, "9 api calls")).toBe("  9 api calls, 9 without edits");
  });

  it("keeps a single turn and a single call singular", () => {
    const lines = render({ cost: cost({ turns: 1, emptyTurns: 0, apiCalls: 1 }) });

    expect(line(lines, "1 turn")).toContain("1 turn, 0 without edits");
    expect(line(lines, "1 api call")).toBe("  1 api call, 0 without edits");
  });

  it("totals the four token counters for display", () => {
    const lines = render({
      cost: cost({
        inputTokens: 1_200,
        cacheReadTokens: 70_000,
        cacheCreationTokens: 12_000,
        outputTokens: 1_000,
        turns: 1,
        apiCalls: 1,
      }),
    });

    expect(line(lines, "1 turn")).toContain("84,200 tokens");
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

describe("formatWeek", () => {
  it("renders one row per session, with a totals footer", () => {
    expect(formatWeek(week(), 7, plainPalette)).toEqual([
      "",
      "  started      intent                        turns   tokens  empty  outcome",
      "  01-15 09:14  add rate limiting to /orders      3   84,200      1  open",
      "  01-15 11:02  refactor the transcript sto…     12  412,900      5  merged",
      "  01-16 08:31  try the websocket thing           4  103,110      4  abandoned",
      "",
      "  3 sessions                                    19  600,210     10",
      "  10 of 19 turns changed no files",
    ]);
  });

  it("right-aligns every figure under its heading, footer included", () => {
    const lines = formatWeek(week(), 7, plainPalette);
    const headings = lines[1] as string;
    // The three session rows, then the totals row: all four share the columns.
    const rows = [lines[2], lines[3], lines[4], lines[6]] as string[];

    for (const [heading, cells] of [
      ["turns", ["3", "12", "4", "19"]],
      ["tokens", ["84,200", "412,900", "103,110", "600,210"]],
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
    const rows = formatWeek(week(), 7, plainPalette).slice(2, 5);
    const starts = rows.map((row) => row.indexOf("  ", 2) + 2);

    expect(new Set(starts).size).toBe(1);
  });

  it("truncates an intent that would widen the table, and marks the cut", () => {
    const [, , , second] = formatWeek(week(), 7, plainPalette) as string[];

    expect(second).toContain("refactor the transcript sto…");
    expect(second).not.toContain("adapter");
  });

  it("leaves an intent that fits exactly alone", () => {
    // 28 characters: the width of the column, so nothing should be cut.
    const [, , first] = formatWeek(week(), 7, plainPalette) as string[];
    expect(first).toContain("add rate limiting to /orders");
  });

  it("strikes through abandoned sessions and leaves merged ones in normal weight", () => {
    const lines = formatWeek(week(), 7, tagged);

    expect(lines[4]).toMatch(/^<struck> {2}01-16 08:31/);
    expect(lines[4]).toMatch(/abandoned<\/struck>$/);
    expect(lines[3]).not.toContain("<struck>");
    expect(lines[2]).not.toContain("<struck>");
  });

  it("strikes the whole row, so the eye can write off the figures too", () => {
    const abandoned = formatWeek(week(), 7, tagged)[4] as string;
    expect(visible(abandoned)).toBe(formatWeek(week(), 7, plainPalette)[4]);
    expect(abandoned.match(/<struck>/g)).toHaveLength(1);
  });

  it("does not pad past the outcome, so a struck row has no trailing rule", () => {
    for (const line of formatWeek(week(), 7, plainPalette)) {
      expect(line).toBe(line.trimEnd());
    }
  });

  it("dims the headings and the waste line, not the rows", () => {
    const lines = formatWeek(week(), 7, tagged);

    expect(lines[1]).toMatch(/^<dim>.*<\/dim>$/);
    expect(lines.at(-1)).toBe("<dim>  10 of 19 turns changed no files</dim>");
    expect(lines[2]).not.toContain("<dim>");
  });

  it("totals turns, tokens and empty turns across the week", () => {
    const footer = formatWeek(week(), 7, plainPalette).at(-2) as string;
    expect(footer).toBe("  3 sessions                                    19  600,210     10");
  });

  it("counts every session in the footer, abandoned ones included", () => {
    // Abandoned work still cost money; leaving it out would flatter the week.
    const footer = formatWeek(week(), 7, plainPalette).at(-2) as string;
    expect(footer).toContain("3 sessions");
  });

  it("names the count of turns that changed no files", () => {
    expect(formatWeek(week(), 7, plainPalette).at(-1)).toBe("  10 of 19 turns changed no files");
  });

  it("keeps a lone turn singular in the waste line", () => {
    const one = session({ cost: cost({ turns: 1, emptyTurns: 0, apiCalls: 1 }) });
    expect(formatWeek([one], 7, plainPalette).at(-1)).toBe("  0 of 1 turn changed no files");
  });

  it("omits the waste line when no turns were captured at all", () => {
    const lines = formatWeek([session()], 7, plainPalette);
    expect(lines.some((text) => text.includes("changed no files"))).toBe(false);
  });

  it("says so when the window is empty", () => {
    expect(formatWeek([], 7, plainPalette)).toEqual(["", "  No sessions in the last 7 days"]);
  });

  it("names the window it found nothing in", () => {
    expect(formatWeek([], 1, plainPalette)[1]).toBe("  No sessions in the last 1 day");
    expect(formatWeek([], 30, plainPalette)[1]).toBe("  No sessions in the last 30 days");
  });

  it("dates each row, so a window wider than a day stays readable", () => {
    const rows = formatWeek(week(), 30, plainPalette).slice(2, 5);
    expect(rows.map((row) => row.slice(2, 13))).toEqual([
      "01-15 09:14",
      "01-15 11:02",
      "01-16 08:31",
    ]);
  });

  it("widens the figure columns rather than letting a big number break alignment", () => {
    const heavy = session({ cost: cost({ cacheReadTokens: 12_345_678, turns: 2, apiCalls: 9 }) });
    const [, headings, row] = formatWeek([heavy], 7, plainPalette) as string[];

    expect(endOf(row as string, "12,345,678")).toBe(endOf(headings as string, "tokens"));
  });

  it("shows a session that is still running, with the outcome it has so far", () => {
    const running = session({ endedAt: null, outcome: "open" });
    expect(formatWeek([running], 7, plainPalette)[2]).toMatch(/ {2}open$/);
  });
});
