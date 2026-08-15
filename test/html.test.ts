import { describe, expect, it } from "vitest";
import { escapeHtml, hue, renderWeek, rowHeight } from "../src/render/html.js";
import { zeroCost, type Session, type SessionCost } from "../src/store.js";

/** Local-time, so the stamp reads the same wherever the test runs. */
function at(hour: number, minute: number, day = 15): string {
  return new Date(2026, 0, day, hour, minute).toISOString();
}

function cost(overrides: Partial<SessionCost> = {}): SessionCost {
  return { ...zeroCost(), ...overrides };
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
    startedAt: at(9, 14),
    endedAt: at(9, 51),
    startCommit: "abc1234",
    ...overrides,
  };
}

/** Three sessions whose spend differs by a lot, which is what heights encode. */
function week(): Session[] {
  return [
    session({
      intent: "add rate limiting to /orders",
      scope: ["api/"],
      reality: ["api/orders.py", "db/schema.py"],
      drift: ["db/schema.py"],
      cost: cost({ inputTokens: 84_200, turns: 3, emptyTurns: 1, apiCalls: 41 }),
    }),
    session({
      intent: "refactor the transcript store adapter",
      startedAt: at(11, 2),
      scope: ["src/"],
      reality: ["src/store.ts"],
      cost: cost({ inputTokens: 412_900, turns: 12, emptyTurns: 5, apiCalls: 130 }),
      outcome: "merged",
    }),
    session({
      intent: "try the websocket thing",
      startedAt: at(8, 31, 16),
      reality: ["web/app.ts", "db/schema.py"],
      drift: ["web/app.ts", "db/schema.py"],
      cost: cost({ inputTokens: 103_110, turns: 4, emptyTurns: 4, apiCalls: 22 }),
      outcome: "abandoned",
    }),
  ];
}

/** A session that wasted nothing: no empty turns, nothing outside its scope. */
function clean(overrides: Partial<Session> = {}): Session {
  return session({
    scope: ["api/"],
    reality: ["api/orders.py"],
    drift: [],
    cost: cost({ inputTokens: 1_000, turns: 3, emptyTurns: 0, apiCalls: 9 }),
    ...overrides,
  });
}

function rows(html: string): string[] {
  return html.match(/<li class="row[^]*?<\/li>/g) ?? [];
}

function heightOf(row: string): number {
  return Number(/style="height:(\d+)px"/.exec(row)?.[1]);
}

describe("escapeHtml", () => {
  it.each([
    ["<script>alert(1)</script>", "&lt;script&gt;alert(1)&lt;/script&gt;"],
    ["a & b", "a &amp; b"],
    ['say "this"', "say &quot;this&quot;"],
    ["it's", "it&#39;s"],
  ])("escapes %o", (raw, escaped) => {
    expect(escapeHtml(raw)).toBe(escaped);
  });

  it("escapes the ampersand first, so an entity is not double-built", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});

describe("rowHeight", () => {
  it("gives the heaviest session in the window the tallest row", () => {
    expect(rowHeight(400_000, 400_000)).toBe(180);
  });

  it("scales in proportion to spend", () => {
    expect(rowHeight(200_000, 400_000)).toBe(90);
    expect(rowHeight(100_000, 400_000)).toBe(45);
  });

  it("floors a cheap session at a readable height", () => {
    expect(rowHeight(1, 400_000)).toBe(44);
    expect(rowHeight(0, 400_000)).toBe(44);
  });

  it("gives every row the floor when nothing cost anything", () => {
    expect(rowHeight(0, 0)).toBe(44);
  });
});

describe("renderWeek", () => {
  it("is a whole HTML document", () => {
    const html = renderWeek(week(), 7);

    expect(html.startsWith("<!doctype html>\n")).toBe(true);
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<title>session — the last 7 days</title>");
    expect(html).toContain("<h1>The last 7 days</h1>");
  });

  it("fetches nothing: no scripts, no stylesheets, no webfonts, no images", () => {
    const html = renderWeek(week(), 7);

    for (const forbidden of ["<script", "<link", "<img", "@import", "url(", "http://", "https://"]) {
      expect(html).not.toContain(forbidden);
    }
  });

  it("draws no charts and no cards", () => {
    const html = renderWeek(week(), 7);

    for (const forbidden of ["<svg", "<canvas", "border-radius", "box-shadow"]) {
      expect(html).not.toContain(forbidden);
    }
  });

  it("uses the five palette tokens and no other colour", () => {
    const hexes = new Set(renderWeek(week(), 7).match(/#[0-9A-Fa-f]{3,8}\b/g) ?? []);

    expect([...hexes].sort()).toEqual(["#0A0B0C", "#16191C", "#6E747A", "#A62F3C", "#EDEBE7"]);
  });

  it("spends its two semantic hues on the intent and on waste, and nothing else", () => {
    const html = renderWeek(week(), 7);

    expect(html.match(/var\(--primary\)/g)).toHaveLength(1);
    expect(html.match(/var\(--waste\)/g)).toHaveLength(1);
    expect(html).toContain(".intent {\n  font-family: var(--prose);\n  font-size: 1.0625rem;\n  color: var(--primary);");
    expect(html).toContain(".waste { color: var(--waste); }");
  });

  it("sets the two typefaces by name, with fallbacks for a machine without them", () => {
    const html = renderWeek(week(), 7);

    expect(html).toContain('--data: "Spline Sans Mono", ui-monospace');
    expect(html).toContain('--prose: "Familjen Grotesk", ui-sans-serif');
  });

  it("sets prose in the prose face and data in the data face", () => {
    const html = renderWeek(week(), 7);

    // The intent is the developer's own sentence; everything measured is data.
    expect(html).toMatch(/\.intent \{\n {2}font-family: var\(--prose\);/);
    expect(html).toMatch(/h1 \{\n {2}font-family: var\(--prose\);/);
    expect(html).toMatch(/body \{[^}]*font-family: var\(--data\);/);
  });

  it("writes one row per session, in the order given", () => {
    const html = renderWeek(week(), 7);
    const listed = rows(html);

    expect(listed).toHaveLength(3);
    expect(listed[0]).toContain("add rate limiting to /orders");
    expect(listed[1]).toContain("refactor the transcript store adapter");
    expect(listed[2]).toContain("try the websocket thing");
  });

  it("stands each row in proportion to what it spent", () => {
    const listed = rows(renderWeek(week(), 7));
    const heights = listed.map(heightOf);

    // 412,900 is the heaviest, so it is the tallest; 103,110 is a quarter of
    // it, so its row is a quarter as tall.
    expect(heights[1]).toBe(180);
    expect(heights[2]).toBe(Math.round((103_110 / 412_900) * 180));
    expect(heights[0]).toBeLessThan(heights[2] as number);
  });

  it("keeps the whole intent, where the terminal cuts it to a column", () => {
    // The row is one line and the layout may ellipsize it on screen, but what
    // was declared is in the file, in full.
    const long = "refactor the transcript store adapter until it stops lying about turns";
    const html = renderWeek([session({ intent: long })], 7);

    expect(html).toContain(long);
    expect(html).not.toContain("…");
  });

  it("escapes an intent rather than letting it write markup", () => {
    const html = renderWeek([session({ intent: '<img src=x onerror="alert(1)">' })], 7);

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("marks abandoned sessions, and only those", () => {
    const listed = rows(renderWeek(week(), 7));

    expect(listed[2]).toContain('class="row abandoned"');
    expect(listed[0]).toContain('class="row"');
    expect(listed[1]).toContain('class="row"');
  });

  it("shows the turns that produced nothing in the waste hue", () => {
    const listed = rows(renderWeek(week(), 7));

    expect(listed[0]).toContain('<span class="figure empty waste">1 without edits</span>');
  });

  it("leaves a session that wasted nothing unmarked", () => {
    const listed = rows(renderWeek([clean()], 7));

    expect(listed[0]).toContain('<span class="figure empty quiet">0 without edits</span>');
  });

  it("counts every session, turn and token in the summary", () => {
    expect(renderWeek(week(), 7)).toContain(
      '<p class="summary">3 sessions · 19 turns · 600,210 tokens · ',
    );
  });

  it("names the turns that changed no files", () => {
    const html = renderWeek(week(), 7);

    expect(html).toContain('<span class="waste">10</span> of 19 turns changed no files');
  });

  it("omits the waste sentence when no turns were captured", () => {
    const html = renderWeek([session()], 7);

    expect(html).not.toContain("changed no files");
  });

  it("says so when the window is empty, and lists nothing", () => {
    const html = renderWeek([], 7);

    expect(html).toContain('<p class="nothing">No sessions in the last 7 days</p>');
    expect(rows(html)).toHaveLength(0);
    expect(html).not.toContain("<ol");
  });

  it("names the window it was given", () => {
    expect(renderWeek([], 1)).toContain("No sessions in the last 1 day");
    expect(renderWeek([], 30)).toContain("<h1>The last 30 days</h1>");
  });

  it("dates and times each row", () => {
    expect(rows(renderWeek(week(), 7))[0]).toContain('<span class="when">01-15 09:14</span>');
  });

  it("shows the outcome as recorded", () => {
    const listed = rows(renderWeek(week(), 7));

    expect(listed[0]).toContain('<span class="outcome">open</span>');
    expect(listed[1]).toContain('<span class="outcome">merged</span>');
    expect(listed[2]).toContain('<span class="outcome">abandoned</span>');
  });

  it("renders the same page twice for the same input", () => {
    expect(renderWeek(week(), 7)).toBe(renderWeek(week(), 7));
  });
});

describe("hue", () => {
  it("marks a count above zero as waste", () => {
    expect(hue(1)).toBe("waste");
    expect(hue(400)).toBe("waste");
  });

  it("leaves zero quiet", () => {
    expect(hue(0)).toBe("quiet");
  });
});

describe("renderWeek: the waste hue never lands on a zero", () => {
  it("keeps the red off the page entirely when nothing was wasted", () => {
    // The strongest form of the rule: a clean week has no red on an element
    // and none in the stylesheet either.
    const html = renderWeek([clean(), clean({ intent: "another clean one" })], 7);

    expect(html).not.toContain("#A62F3C");
    expect(html).not.toContain("waste");
  });

  it("mutes the footer count when no turn was empty", () => {
    const html = renderWeek([clean()], 7);

    expect(html).toContain('<span class="quiet">0</span> of 3 turns changed no files');
  });

  it("reddens the footer count as soon as one turn was empty", () => {
    const html = renderWeek([clean({ cost: cost({ turns: 3, emptyTurns: 1, apiCalls: 9 }) })], 7);

    expect(html).toContain('<span class="waste">1</span> of 3 turns changed no files');
  });

  it("mutes a zero drift total in the summary", () => {
    expect(renderWeek([clean()], 7)).toContain('<span class="quiet">0 outside</span>');
  });
});

describe("renderWeek: drift", () => {
  it("counts what a session changed outside its declared scope", () => {
    const listed = rows(renderWeek(week(), 7));

    expect(listed[0]).toContain('class="figure drift waste"');
    expect(listed[0]).toContain("1 outside");
    expect(listed[2]).toContain("2 outside");
  });

  it("lists the drifted paths on the element, rather than in another column", () => {
    const listed = rows(renderWeek(week(), 7));

    expect(listed[0]).toContain('title="db/schema.py"');
    expect(listed[2]).toContain('title="web/app.ts&#10;db/schema.py"');
  });

  it("mutes a session that stayed inside its scope, and gives it nothing to hover", () => {
    const listed = rows(renderWeek(week(), 7));

    expect(listed[1]).toContain('<span class="figure drift quiet">0 outside</span>');
    expect(listed[1]).not.toContain("title=");
  });

  it("escapes a drifted path rather than letting it write an attribute", () => {
    const nasty = session({ drift: ['a" onmouseover="alert(1)'] });
    const html = renderWeek([nasty], 7);

    expect(html).not.toContain('onmouseover="alert(1)"');
    expect(html).toContain("&quot; onmouseover=&quot;alert(1)");
  });

  it("totals the week's drift in the summary", () => {
    // 1 from the first session and 2 from the third: the rows add up.
    expect(renderWeek(week(), 7)).toContain('<span class="waste">3 outside</span>');
  });

  it("keeps to two hues: the intent, and everything wasted", () => {
    const html = renderWeek(week(), 7);

    expect(html.match(/var\(--primary\)/g)).toHaveLength(1);
    expect(html.match(/var\(--waste\)/g)).toHaveLength(1);
    // Drift and empty turns share the one waste rule rather than taking a
    // third hue between them.
    expect(html).toContain(".waste { color: var(--waste); }");
  });
});

describe("renderWeek: height reads as mass", () => {
  it("top-aligns the row, so height is not mistaken for padding", () => {
    expect(renderWeek(week(), 7)).toContain("align-items: start;");
    expect(renderWeek(week(), 7)).not.toContain("align-items: center;");
  });

  it("runs a rule down the left edge of every row, the full height of it", () => {
    const html = renderWeek(week(), 7);

    expect(html).toMatch(
      /\.row::before \{\n {2}content: "";\n {2}position: absolute;\n {2}left: 0;\n {2}top: 2px;\n {2}bottom: 2px;\n {2}width: 2px;\n {2}background: var\(--surface\);\n\}/,
    );
  });

  it("drops the footnote, now that the mass explains itself", () => {
    expect(renderWeek(week(), 7)).not.toContain("Row height is token spend");
  });
});

describe("renderWeek: the figure columns", () => {
  it("gives the tokens column room for a seven-figure count on one line", () => {
    const heavy = session({
      cost: cost({ cacheReadTokens: 4_244_694, turns: 9, apiCalls: 30 }),
    });
    const html = renderWeek([heavy], 7);
    // `minmax(8rem, 1fr)` is one track, not two, so it cannot be split on spaces.
    const declared = /grid-template-columns: ([^;]+);/.exec(html)?.[1] ?? "";
    const columns = declared.match(/minmax\([^)]*\)|\S+/g) ?? [];

    expect(html).toContain("4,244,694 tokens");
    // "4,244,694 tokens" is 16 monospace characters, about 8.4rem at this size.
    expect(Number.parseFloat(columns[4] as string)).toBeGreaterThanOrEqual(9);
    expect(html).toMatch(/\.figure \{[^}]*white-space: nowrap;/);
  });

  it("sets the token count lighter than the turns beside it", () => {
    const html = renderWeek(week(), 7);

    expect(html).toContain(".tokens { font-weight: 300; }");
    // Turns take the default weight, so the two do not read as equals.
    expect(html).not.toMatch(/\.turns \{[^}]*font-weight/);
  });

  it("says nothing rather than three zeroes when no cost was captured", () => {
    const listed = rows(renderWeek([session()], 7));

    expect(listed[0]).toContain('<span class="figure nocost quiet">—</span>');
    expect(listed[0]).not.toContain("0 turns");
    expect(listed[0]).not.toContain("0 tokens");
    expect(listed[0]).not.toContain("without edits");
  });

  it("still reports drift on a session with no captured cost", () => {
    // Cost comes from the transcript and may be missing; drift comes from git
    // and is known either way.
    const listed = rows(renderWeek([session({ drift: ["db/schema.py"] })], 7));

    expect(listed[0]).toContain("1 outside");
  });

  it("spans the dash across the three columns the figures would have filled", () => {
    expect(renderWeek([session()], 7)).toContain(".nocost { grid-column: span 3; }");
  });

  it("keeps the figures once there is any cost to report", () => {
    const listed = rows(renderWeek([clean()], 7));

    expect(listed[0]).toContain("3 turns");
    expect(listed[0]).toContain("1,000 tokens");
    expect(listed[0]).not.toContain("—");
  });
});
