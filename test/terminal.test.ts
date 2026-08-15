import { describe, expect, it } from "vitest";
import { formatSession, plainPalette, type Palette } from "../src/render/terminal.js";
import { zeroCost, type Session, type SessionCost } from "../src/store.js";

/**
 * Built from a local-time Date, so the clock reads 14:02 wherever the test
 * runs. The formatter prints wall-clock time, which is timezone-dependent by
 * design; pinning the timezone here would only test the pin.
 */
function at(hour: number, minute: number): string {
  return new Date(2026, 0, 15, hour, minute).toISOString();
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
};

/** Strips the markup `tagged` adds, leaving what the reader would see. */
function visible(text: string): string {
  return text.replace(/<\/?(?:dim|bright)>/g, "");
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
