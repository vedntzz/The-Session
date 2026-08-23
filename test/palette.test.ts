import { describe, expect, it } from "vitest";
import {
  ansiPalette,
  colorEnabled,
  paletteFor,
  plainPalette,
  type Palette,
} from "../src/render/palette.js";
import { formatSession, formatWeek, type View } from "../src/render/terminal.js";
import type { RateTable } from "../src/pricing.js";
import { zeroCost, zeroTokens, type Session, type SessionCost } from "../src/store.js";

const RATES: RateTable = new Map([
  ["claude-opus-4-1", { input: 15, cacheRead: 1.5, cacheCreation: 18.75, output: 75 }],
]);
const priced: View = { rates: RATES };

/** Local time, so the clock reads the same wherever this runs. */
function at(hour: number, minute: number, day = 15): string {
  return new Date(2026, 0, day, hour, minute).toISOString();
}

function cost(overrides: Partial<SessionCost> = {}): SessionCost {
  return { ...zeroCost(), model: "claude-opus-4-1", ...overrides };
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
 * Between them these three exercise every role the palette has: an intent, a
 * declared path, an in-scope path, a drift path, waste both spent and not, all
 * three outcomes, attribution, and a model with no price on it.
 */
const drifted = session({
  scope: ["api/orders.py", "api/middleware/"],
  reality: ["api/middleware/rate_limit.py", "api/orders.py", "db/schema.py"],
  drift: ["db/schema.py"],
  outcome: "merged",
  attribution: { client: "Acme", project: "orders-api" },
  cost: cost({
    inputTokens: 84_200,
    cacheReadTokens: 1_000_000,
    cacheCreationTokens: 12_000,
    outputTokens: 9_400,
    turns: 7,
    emptyTurns: 2,
    apiCalls: 31,
    callsWithoutEdits: 9,
    emptyTurnTokens: { ...zeroTokens(), inputTokens: 12_000, outputTokens: 800 },
  }),
});

const clean = session({
  intent: "extract the store",
  scope: ["src/store.ts"],
  reality: ["src/store.ts"],
  drift: [],
  outcome: "abandoned",
  startedAt: at(8, 31, 16),
  endedAt: at(9, 12, 16),
  cost: cost({
    inputTokens: 1000,
    outputTokens: 100,
    turns: 3,
    emptyTurns: 0,
    apiCalls: 4,
    callsWithoutEdits: 0,
    emptyTurnTokens: zeroTokens(),
  }),
});

const unpriced = session({
  intent: "try the new model",
  cost: cost({ model: "gpt-9", inputTokens: 500, turns: 1, apiCalls: 1 }),
  startedAt: at(10, 0, 17),
  endedAt: at(10, 30, 17),
});

/** Every view this renderer has, rendered with whichever palette is passed. */
function everything(palette: Palette): string[] {
  return [
    ...formatSession(drifted, palette, { ...priced, tokens: true }),
    ...formatSession(clean, palette, priced),
    ...formatSession(unpriced, palette, priced),
    ...formatSession(session(), palette),
    ...formatWeek([drifted, clean, unpriced], 7, palette, {}, {
      ...priced,
      classes: true,
      tokens: true,
    }),
    ...formatWeek([drifted], 7, palette, { client: "Acme" }, priced),
    ...formatWeek([], 7, palette, {}, priced),
  ];
}

/**
 * What these views printed before there was a palette to print them with,
 * copied out of the renderer as it stood.
 *
 * Colour is an addition to a terminal, never a change to the output: this is
 * what goes into a pipe, a file, a CI log and a bug report, and a palette that
 * moved a single space of it would have broken every one of those readers.
 * Kept as literals rather than a snapshot so that changing it takes saying so.
 */
const GOLDEN: readonly string[] = [
  "",
  "  add rate limiting to /orders                          14:02 → 14:39",
  "",
  "  declared    api/orders.py  api/middleware/",
  "  changed     api/middleware/rate_limit.py  api/orders.py",
  "  outside     ! db/schema.py                            ← you did not declare this",
  "",
  "  cost        $3.69                                     7 turns, 2 without edits",
  "  no edits    $0.24                                     31 api calls, 9 without edits",
  "  tokens      84,200 in · 1,000,000 cache read · 12,000 cache write · 9,400 out",
  "  client      Acme",
  "  project     orders-api",
  "  outcome     merged",
  "",
  "  extract the store                                     08:31 → 09:12",
  "",
  "  declared    src/store.ts",
  "  changed     src/store.ts",
  "",
  "  cost        $0.02                                     3 turns, 0 without edits",
  "  no edits    $0.00                                     4 api calls, 0 without edits",
  "  outcome     abandoned",
  "",
  "  try the new model                                     10:00 → 10:30",
  "",
  "  declared    none declared",
  "  changed     nothing",
  "",
  "  cost        500 tokens, gpt-9 unpriced                1 turn, 0 without edits",
  "  no edits    0 tokens                                  1 api call, 0 without edits",
  "  outcome     open",
  "",
  "  add rate limiting to /orders                          14:02 → 14:39",
  "",
  "  declared    none declared",
  "  changed     nothing",
  "",
  "  outcome     open",
  "",
  "  started      intent                        class   cost  turns     tokens  empty  outcome",
  "  01-15 14:02  add rate limiting to /orders  api    $3.69      7  1,105,600      2  merged",
  "  01-16 08:31  extract the store             other  $0.02      3      1,100      0  abandoned",
  "  01-17 10:00  try the new model             other      —      1        500      0  open",
  "",
  "  3 sessions                                        $3.72     11  1,107,200      2",
  "  $3.72 spent, $0.02 of it on changes that never merged",
  "  1 session unpriced: gpt-9 — save this as ~/.session/rates.json",
  "  {",
  '    "note": "Replace every 0 below with that model\'s published price in dollars per million tokens. A rate left at 0 prices the model at nothing, which is not the same as leaving it unpriced.",',
  '    "models": {',
  '      "gpt-9": { "input": 0, "cacheRead": 0, "cacheCreation": 0, "output": 0 }',
  "    }",
  "  }",
  "  2 of 11 turns changed no files",
  "",
  "  only client Acme",
  "  started      intent                         cost  turns  empty  outcome",
  "  01-15 14:02  add rate limiting to /orders  $3.69      7      2  merged",
  "",
  "  1 session                                  $3.69      7      2",
  "  $3.69 spent, all of it shipped",
  "  2 of 7 turns changed no files",
  "",
  "  No sessions in the last 7 days",
];

const ESCAPE = /\u001b\[/;

describe("the colourless render", () => {
  it("is byte for byte what it printed before there was a palette", () => {
    expect(everything(plainPalette)).toEqual([...GOLDEN]);
  });

  it("is what a pipe gets, since a pipe is not a terminal", () => {
    expect(everything(paletteFor({ env: {}, isTTY: false }))).toEqual([...GOLDEN]);
  });

  it("is what NO_COLOR gets, terminal or not", () => {
    expect(everything(paletteFor({ env: { NO_COLOR: "1" }, isTTY: true }))).toEqual([...GOLDEN]);
  });

  it("is what FORCE_COLOR=0 gets, terminal or not", () => {
    expect(everything(paletteFor({ env: { FORCE_COLOR: "0" }, isTTY: true }))).toEqual([...GOLDEN]);
  });

  it("carries no escape code anywhere in it", () => {
    for (const line of everything(plainPalette)) {
      expect(line).not.toMatch(ESCAPE);
    }
  });

  it("is what the coloured render says once the codes are taken back out", () => {
    // The two renders differ in ink and in nothing else — no extra space, no
    // dropped column, no marker that only appears in one of them.
    const stripped = everything(ansiPalette).map((line) =>
      line.replace(/\u001b\[[0-9;]*m/g, ""),
    );

    expect(stripped).toEqual([...GOLDEN]);
  });
});

describe("colorEnabled", () => {
  it("colours a terminal and nothing else", () => {
    expect(colorEnabled({ env: {}, isTTY: true })).toBe(true);
    expect(colorEnabled({ env: {}, isTTY: false })).toBe(false);
  });

  it("honours NO_COLOR, whatever it is set to, so long as it is set to something", () => {
    expect(colorEnabled({ env: { NO_COLOR: "1" }, isTTY: true })).toBe(false);
    expect(colorEnabled({ env: { NO_COLOR: "anything" }, isTTY: true })).toBe(false);
    // Empty is not set, per the convention: exporting an empty variable is how
    // a shell unsets one by accident.
    expect(colorEnabled({ env: { NO_COLOR: "" }, isTTY: true })).toBe(true);
  });

  it("lets FORCE_COLOR override both the terminal check and NO_COLOR", () => {
    expect(colorEnabled({ env: { FORCE_COLOR: "1" }, isTTY: false })).toBe(true);
    expect(colorEnabled({ env: { FORCE_COLOR: "1", NO_COLOR: "1" }, isTTY: false })).toBe(true);
    expect(colorEnabled({ env: { FORCE_COLOR: "0" }, isTTY: true })).toBe(false);
    expect(colorEnabled({ env: { FORCE_COLOR: "false" }, isTTY: true })).toBe(false);
  });

  it("does not colour a CI log just because it is CI", () => {
    // The opposite of what picocolors would do on its own. A CI log is a file
    // somebody reads later, and escape codes in it are noise.
    expect(colorEnabled({ env: { CI: "true" }, isTTY: false })).toBe(false);
  });
});

describe("which ink each role gets", () => {
  /** The SGR codes a role opens with, so the assertions read as intent. */
  const codes = (text: string): string[] =>
    [...text.matchAll(/\u001b\[(\d+)m/g)].map((match) => match[1] as string);

  const BOLD = "1";
  const DIM = "2";
  const STRIKE = "9";
  const RED = "31";
  const GREEN = "32";

  it("uses only the 16 basic colours, so the terminal's theme supplies the hues", () => {
    // 38 and 48 open the 256-colour and truecolor forms. Neither may appear:
    // this tool cannot see the background it is being read on.
    for (const role of Object.values(ansiPalette)) {
      const painted = role("x");
      expect(painted).not.toContain("\u001b[38;");
      expect(painted).not.toContain("\u001b[48;");
      for (const code of codes(painted)) {
        const number = Number(code);
        // An attribute (bold, dim, strikethrough and the codes that close
        // them), one of the eight colours, one of their bright halves, or the
        // reset back to the terminal's own foreground. Nothing else exists in
        // a 16-colour world.
        const attribute = number < 30;
        const basic = (number >= 30 && number <= 37) || (number >= 90 && number <= 97);
        const defaultForeground = number === 39;
        expect(attribute || basic || defaultForeground).toBe(true);
      }
    }
  });

  it("puts the intent in the terminal's own colour, brightened", () => {
    expect(codes(ansiPalette.intent("x"))).toContain(BOLD);
    expect(codes(ansiPalette.intent("x"))).not.toContain(RED);
  });

  it("puts drift and waste in red — the two things worth interrupting a reader for", () => {
    expect(codes(ansiPalette.drift("x"))).toContain(RED);
    expect(codes(ansiPalette.waste("x"))).toContain(RED);
  });

  it("dims declared paths and metadata alike", () => {
    expect(codes(ansiPalette.path("x"))).toContain(DIM);
    expect(codes(ansiPalette.meta("x"))).toContain(DIM);
  });

  it("puts merged in green", () => {
    expect(codes(ansiPalette.merged("x"))).toContain(GREEN);
  });

  it("strikes abandoned through and dims it", () => {
    expect(codes(ansiPalette.abandoned("x"))).toContain(STRIKE);
    expect(codes(ansiPalette.abandoned("x"))).toContain(DIM);
  });

  it("leaves the text itself alone, whichever role it goes through", () => {
    for (const role of Object.values(ansiPalette)) {
      expect(role("api/orders.py")).toContain("api/orders.py");
    }
  });
});

describe("red is kept for figures that are not zero", () => {
  /** The `no edits` line, which is the only dollar figure that can be waste. */
  function wasteLine(overrides: Partial<SessionCost>): string {
    const marked: Palette = { ...plainPalette, waste: (text) => `<waste>${text}</waste>` };
    const lines = formatSession(session({ cost: cost(overrides) }), marked, priced);
    return lines.find((line) => line.includes("no edits")) as string;
  }

  it("marks a session that spent money on turns that changed nothing", () => {
    expect(
      wasteLine({
        inputTokens: 84_200,
        turns: 7,
        emptyTurns: 2,
        apiCalls: 31,
        emptyTurnTokens: { ...zeroTokens(), inputTokens: 12_000 },
      }),
    ).toContain("<waste>$0.18</waste>");
  });

  it("leaves $0.00 alone, so the colour keeps meaning something", () => {
    const line = wasteLine({
      inputTokens: 1000,
      turns: 3,
      apiCalls: 4,
      emptyTurnTokens: zeroTokens(),
    });

    expect(line).toContain("$0.00");
    expect(line).not.toContain("<waste>");
  });

  it("marks unpriced waste by its tokens, and leaves nought tokens alone", () => {
    const unpricedCost = { model: "gpt-9", inputTokens: 500, turns: 2, apiCalls: 2 };

    expect(
      wasteLine({ ...unpricedCost, emptyTurnTokens: { ...zeroTokens(), inputTokens: 300 } }),
    ).toContain("<waste>300 tokens</waste>");
    expect(wasteLine({ ...unpricedCost, emptyTurnTokens: zeroTokens() })).not.toContain("<waste>");
  });

  it("leaves a session that never recorded the split alone", () => {
    const line = wasteLine({
      inputTokens: 1000,
      turns: 3,
      apiCalls: 4,
      emptyTurnTokens: undefined,
    });

    expect(line).toContain("not recorded");
    expect(line).not.toContain("<waste>");
  });
});
