import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MIN_SESSIONS,
  chooseClass,
  driftPaths,
  estimateFor,
  firstLook,
  formatEstimate,
  median,
  parseSince,
  percentile,
  summarize,
  type Estimate,
  type EstimateGroup,
} from "../src/commands/estimate.js";
import type { Observation } from "../src/outcome.js";
import type { RateTable } from "../src/pricing.js";
import {
  appendSession,
  updateSession,
  zeroCost,
  type IntentSource,
  type Session,
  type SessionOutcome,
  type StoreOptions,
} from "../src/store.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** At $15 per million input tokens, 100,000 input tokens is exactly $1.50. */
const RATES: RateTable = new Map([
  ["claude-opus-4-1", { input: 15, cacheRead: 1.5, cacheCreation: 18.75, output: 75 }],
]);

let root: string;
let options: StoreOptions & { home: string; cwd: string };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-estimate-"));
  // No git repo: outside one there are no facts to judge against, so the
  // outcome each session was recorded with is the one that is read.
  options = { home: path.join(root, "store"), cwd: root };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

interface Past {
  reality?: string[];
  drift?: string[];
  outcome?: SessionOutcome;
  observations?: Observation[];
  /** Priced at $1.50 per unit. */
  units?: number;
  model?: string;
  daysAgo?: number;
  /** Where the intent came from. Declared unless the hook is being imitated. */
  source?: IntentSource;
}

/** Records one finished session. */
async function record(intent: string, past: Past = {}): Promise<Session> {
  const startedAt = new Date(Date.now() - (past.daysAgo ?? 0) * DAY_MS).toISOString();
  const session = await appendSession(
    {
      intent,
      intentSource: past.source ?? "declared",
      startedAt,
      endedAt: new Date(Date.parse(startedAt) + 60_000).toISOString(),
      startCommit: "abc1234",
      reality: past.reality ?? ["src/api/orders.ts"],
      drift: past.drift ?? [],
      outcome: past.outcome ?? "merged",
      cost: {
        ...zeroCost(),
        inputTokens: (past.units ?? 1) * 100_000,
        model: past.model ?? "claude-opus-4-1",
        turns: 3,
      },
    },
    options,
  );

  // Observations are written by `settle` and `mark`, never by the creating
  // record, so they arrive here the same way they do in life: as a patch.
  if (past.observations) {
    return updateSession(session.id, { observations: past.observations }, options);
  }
  return session;
}

/** `count` api sessions, each costing a different whole number of units. */
async function recordApiSessions(count: number, source: IntentSource = "declared"): Promise<void> {
  for (let unit = 1; unit <= count; unit += 1) {
    await record(`api work ${unit}`, { units: unit, source });
  }
}

function observation(outcome: SessionOutcome, source: "computed" | "manual"): Observation {
  return {
    outcome,
    observedAt: "2026-05-20T10:00:00.000Z",
    commit: "abc1234",
    branch: "origin/main",
    source,
  };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    repo: "path:/tmp/repo",
    intent: "rate limit /orders",
    scope: [],
    baseline: [],
    reality: [],
    drift: [],
    cost: zeroCost(),
    outcome: "open",
    startedAt: "2026-05-20T09:14:00.000Z",
    endedAt: "2026-05-20T09:51:00.000Z",
    startCommit: "abc1234",
    ...overrides,
  };
}

describe("parseSince", () => {
  const now = Date.parse("2026-05-20T12:00:00.000Z");

  it("takes a span of days, with or without the d", () => {
    expect(parseSince("30", now)).toBe(now - 30 * DAY_MS);
    expect(parseSince("30d", now)).toBe(now - 30 * DAY_MS);
  });

  it("takes a date to start from", () => {
    expect(parseSince("2026-05-01", now)).toBe(Date.parse("2026-05-01"));
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseSince(" 7d ", now)).toBe(now - 7 * DAY_MS);
  });

  it.each(["0", "-3", "2.5", "last tuesday", "", "2026-13-40x"])("refuses %o", (value) => {
    expect(() => parseSince(value, now)).toThrow(/--since takes/);
  });
});

describe("chooseClass", () => {
  it("reads the intent when that is all there is", () => {
    expect(chooseClass({ intent: "rate limit the /orders endpoint" })).toEqual({
      class: "api",
      source: "intent",
    });
  });

  it("prefers the declared paths, which are the more reliable signal", () => {
    // The words say schema; the paths say what will actually be touched.
    expect(
      chooseClass({ intent: "clean up the orders table code", scope: ["src/components/"] }),
    ).toEqual({ class: "ui", source: "scope" });
  });

  it("lets a person outrank both", () => {
    expect(
      chooseClass({ intent: "rate limit the endpoint", scope: ["src/api/"], class: "docs" }),
    ).toEqual({ class: "docs", source: "declared" });
  });

  it("ignores an empty scope rather than calling it other", () => {
    expect(chooseClass({ intent: "write the readme", scope: [] }).source).toBe("intent");
  });
});

describe("median and p90", () => {
  it("takes the middle value of an odd sample", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("takes the mean of the middle two of an even one", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("returns a value some session actually cost, rather than interpolating", () => {
    const costs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
    expect(percentile(costs, 0.9)).toBe(9);
    expect(costs).toContain(percentile(costs, 0.9));
  });

  it("has a rank even for a sample of one", () => {
    expect(percentile([4], 0.9)).toBe(4);
  });
});

describe("firstLook", () => {
  it("uses the outcome now when nobody has settled the session", () => {
    expect(firstLook(session({ outcome: "merged" }))).toBe("merged");
  });

  it("uses the first settled answer, not the latest one", () => {
    // Abandoned, then picked up again and marked merged a month later. It
    // merged; it did not merge the first time.
    const revisited = session({
      outcome: "merged",
      observations: [observation("abandoned", "computed"), observation("merged", "manual")],
    });

    expect(firstLook(revisited)).toBe("abandoned");
  });

  it("skips an observation that decided nothing", () => {
    const marked = session({
      outcome: "open",
      observations: [observation("open", "manual"), observation("merged", "computed")],
    });

    expect(firstLook(marked)).toBe("merged");
  });
});

describe("driftPaths", () => {
  it("counts the sessions a path drifted in, commonest first", () => {
    const sessions = [
      session({ drift: ["src/store.ts", "rates.json"] }),
      session({ drift: ["src/store.ts"] }),
      session({ drift: ["src/store.ts", "rates.json"] }),
    ];

    expect(driftPaths(sessions)).toEqual([
      { path: "src/store.ts", sessions: 3 },
      { path: "rates.json", sessions: 2 },
    ]);
  });

  it("counts a path once per session, however often it appears in one", () => {
    expect(driftPaths([session({ drift: ["src/store.ts", "src/store.ts"] })])).toEqual([
      { path: "src/store.ts", sessions: 1 },
    ]);
  });

  it("breaks a tie by path, so two runs agree", () => {
    const sessions = [session({ drift: ["b.ts"] }), session({ drift: ["a.ts"] })];
    expect(driftPaths(sessions).map((entry) => entry.path)).toEqual(["a.ts", "b.ts"]);
  });

  it("keeps the list short", () => {
    const drift = ["a", "b", "c", "d", "e", "f", "g"];
    expect(driftPaths([session({ drift })]).length).toBe(5);
  });
});

describe("summarize", () => {
  it("prices what it can and counts what it cannot", () => {
    const sessions = [
      session({ cost: { ...zeroCost(), inputTokens: 100_000, model: "claude-opus-4-1" } }),
      session({ cost: { ...zeroCost(), inputTokens: 100_000, model: "some-other-model" } }),
    ];

    const figures = summarize(sessions, RATES);

    expect(figures.priced).toBe(1);
    expect(figures.unpriced).toBe(1);
    expect(figures.median).toBe(1.5);
  });

  it("counts the open sessions apart from the decided ones", () => {
    const figures = summarize(
      [session({ outcome: "merged" }), session({ outcome: "abandoned" }), session({ outcome: "open" })],
      RATES,
    );

    expect(figures).toMatchObject({ mergedFirstTime: 1, decided: 2, open: 1 });
  });
});

describe("estimateFor", () => {
  it("says how the class was arrived at", async () => {
    const estimate = await estimateFor({ intent: "rate limit the /orders endpoint" }, RATES, options);

    expect(estimate).toMatchObject({ class: "api", source: "intent" });
    expect(estimate.declared.matched).toBe(0);
    expect(estimate.captured.matched).toBe(0);
  });

  it("reports nothing but the count below the threshold", async () => {
    await recordApiSessions(MIN_SESSIONS - 1);

    const estimate = await estimateFor({ intent: "another endpoint" }, RATES, options);

    expect(estimate.declared.matched).toBe(4);
    expect(estimate.declared.figures).toBeUndefined();
  });

  it("reports the figures once there are enough", async () => {
    await recordApiSessions(9);

    const estimate = await estimateFor({ intent: "another endpoint" }, RATES, options);

    // Nine sessions at $1.50 through $13.50: the middle is the fifth, and
    // nearest-rank p90 is the ninth.
    expect(estimate.declared.matched).toBe(9);
    expect(estimate.declared.figures).toMatchObject({ median: 7.5, p90: 13.5, priced: 9 });
  });

  it("counts only sessions of the class being asked about", async () => {
    await recordApiSessions(6);
    await record("restyle", { reality: ["src/components/Header.tsx"] });

    const estimate = await estimateFor({ intent: "another endpoint" }, RATES, options);

    expect(estimate.declared.matched).toBe(6);
  });

  it("leaves out sessions that have not stopped", async () => {
    await recordApiSessions(5);
    await appendSession(
      {
        intent: "still going",
        startedAt: new Date().toISOString(),
        startCommit: "abc1234",
        reality: ["src/api/orders.ts"],
      },
      options,
    );

    expect((await estimateFor({ intent: "another endpoint" }, RATES, options)).declared.matched).toBe(5);
  });

  it("honours --since", async () => {
    await recordApiSessions(5);
    await record("old api work", { daysAgo: 90 });

    const since = Date.now() - 30 * DAY_MS;
    const estimate = await estimateFor({ intent: "another endpoint", since }, RATES, options);

    expect(estimate.declared.matched).toBe(5);
    expect(estimate.since).toBe(new Date(since).toISOString().slice(0, 10));
  });

  it("honours --class over what the words say", async () => {
    await record("a", { reality: ["docs/one.md"] });
    await record("b", { reality: ["docs/two.md"] });

    const estimate = await estimateFor(
      { intent: "rate limit the endpoint", class: "docs" },
      RATES,
      options,
    );

    expect(estimate).toMatchObject({ class: "docs", source: "declared" });
    expect(estimate.declared.matched).toBe(2);
  });

  it("classifies past sessions on their paths, not on their words", async () => {
    // The intent says schema; the files say ui, and the files are what ran.
    await record("add a column to the orders table", {
      reality: ["src/components/Table.tsx"],
    });

    const estimate = await estimateFor({ intent: "restyle a component" }, RATES, options);

    expect(estimate.declared.matched).toBe(1);
  });

  it("takes the first look at each session, not the latest one", async () => {
    for (let n = 0; n < 5; n += 1) {
      await record(`api work ${n}`, {
        outcome: "merged",
        observations: [observation("abandoned", "computed"), observation("merged", "manual")],
      });
    }

    const estimate = await estimateFor({ intent: "another endpoint" }, RATES, options);

    expect(estimate.declared.figures).toMatchObject({ mergedFirstTime: 0, decided: 5 });
  });
});

describe("declared and captured, kept apart", () => {
  /**
   * Six declared api sessions costing $1.50 to $9.00, and six the hook
   * recorded costing $15.00 to $90.00. Pooled they would report a median of
   * $12.00, which is a figure describing neither: no declared session cost
   * anything like it, and no captured one did either.
   */
  async function bothKinds(): Promise<void> {
    for (let unit = 1; unit <= 6; unit += 1) {
      await record(`declared api work ${unit}`, { units: unit });
    }
    for (let unit = 1; unit <= 6; unit += 1) {
      await record(`captured api work ${unit}`, { units: unit * 10, source: "captured" });
    }
  }

  it("splits the sample rather than pooling it", async () => {
    await bothKinds();

    const estimate = await estimateFor({ intent: "another endpoint" }, RATES, options);

    expect(estimate.declared.matched).toBe(6);
    expect(estimate.captured.matched).toBe(6);
  });

  it("gives each side its own money, and neither the median of the pile", async () => {
    await bothKinds();

    const estimate = await estimateFor({ intent: "another endpoint" }, RATES, options);

    // Six values each: the median is the mean of the third and fourth.
    expect(estimate.declared.figures).toMatchObject({ median: 5.25, p90: 9 });
    expect(estimate.captured.figures).toMatchObject({ median: 52.5, p90: 90 });
  });

  it("gives each side its own merge rate", async () => {
    for (let n = 0; n < 5; n += 1) {
      await record(`declared ${n}`, { outcome: "merged" });
    }
    for (let n = 0; n < 5; n += 1) {
      await record(`captured ${n}`, { outcome: "abandoned", source: "captured" });
    }

    const estimate = await estimateFor({ intent: "another endpoint" }, RATES, options);

    expect(estimate.declared.figures).toMatchObject({ mergedFirstTime: 5, decided: 5 });
    expect(estimate.captured.figures).toMatchObject({ mergedFirstTime: 0, decided: 5 });
  });

  it("counts each side's empty sessions against that side alone", async () => {
    // Empty sessions have no paths to read a class off, so they all land in
    // `other`, which is the class this asks about.
    for (let unit = 1; unit <= 5; unit += 1) {
      await record(`odd job ${unit}`, { reality: ["src/thing.ts"], units: unit });
    }
    await record("declared and came to nothing", { reality: [] });
    for (let n = 0; n < 2; n += 1) {
      await record(`captured and came to nothing ${n}`, { reality: [], source: "captured" });
    }

    const estimate = await estimateFor({ intent: "an odd job", class: "other" }, RATES, options);

    // One empty on each side of the line, and each is counted where it came
    // from. Pooled, three empties would say nothing about which kind of
    // session keeps coming to nothing.
    expect(estimate.declared).toMatchObject({ matched: 5, empty: 1 });
    expect(estimate.captured).toMatchObject({ matched: 0, empty: 2 });
  });

  it("holds each side to the threshold on its own, so neither borrows the other's count", async () => {
    // Four and four. Pooled that is eight, which would be over the line; apart
    // it is two samples of four, and neither says anything.
    await recordApiSessions(4);
    for (let unit = 1; unit <= 4; unit += 1) {
      await record(`captured api work ${unit}`, { units: unit, source: "captured" });
    }

    const estimate = await estimateFor({ intent: "another endpoint" }, RATES, options);

    expect(estimate.declared.matched).toBe(4);
    expect(estimate.declared.figures).toBeUndefined();
    expect(estimate.captured.matched).toBe(4);
    expect(estimate.captured.figures).toBeUndefined();
  });

  it("counts a record written before intentSource existed as declared", async () => {
    for (let unit = 1; unit <= 5; unit += 1) {
      const past = await record(`api work ${unit}`, { units: unit });
      expect(past.intentSource).toBe("declared");
    }

    // The same shape as an old record: nothing but `session start` could have
    // written one, so it belongs on the declared side rather than in neither.
    const estimate = await estimateFor({ intent: "another endpoint" }, RATES, options);

    expect(estimate.declared.matched).toBe(5);
    expect(estimate.captured.matched).toBe(0);
  });

  it("keeps drift on the side that could have drifted", async () => {
    for (let unit = 1; unit <= 5; unit += 1) {
      await record(`declared ${unit}`, { units: unit, drift: ["src/store.ts"] });
    }
    for (let unit = 1; unit <= 5; unit += 1) {
      await record(`captured ${unit}`, { units: unit, source: "captured" });
    }

    const estimate = await estimateFor({ intent: "another endpoint" }, RATES, options);

    expect(estimate.declared.figures?.drift).toEqual([{ path: "src/store.ts", sessions: 5 }]);
    expect(estimate.captured.figures?.drift).toEqual([]);
  });
});

describe("sessions that changed nothing", () => {
  /**
   * Five sessions that changed a file no rule recognises, costing $1.50 to
   * $7.50, and three that changed nothing at all. Both land in `other` — the
   * empties because there are no paths to read a class off, which is what
   * `stop` records for them — so an `other` estimate is where they collide.
   *
   * The empties are the cheap ones on purpose: left in, they drag the median
   * below anything anybody was ever billed for the work.
   */
  async function withEmpties(): Promise<void> {
    for (let unit = 1; unit <= 5; unit += 1) {
      await record(`odd job ${unit}`, { reality: ["src/thing.ts"], units: unit });
    }
    for (let n = 0; n < 3; n += 1) {
      await record(`came to nothing ${n}`, { reality: [], outcome: "abandoned", units: 0.1 });
    }
  }

  const asking = { intent: "another odd job", class: "other" } as const;

  it("leaves them out of the sample, and says how many it left out", async () => {
    await withEmpties();

    const estimate = await estimateFor(asking, RATES, options);

    expect(estimate.declared).toMatchObject({ matched: 5, empty: 3 });
  });

  it("leaves them out of the distribution", async () => {
    await withEmpties();

    const estimate = await estimateFor(asking, RATES, options);

    // The five that did something: median $4.50, p90 $7.50. With the three
    // empties in the sample the median would be $2.25 — a figure describing
    // sessions that did no work.
    expect(estimate.declared.figures).toMatchObject({ priced: 5, median: 4.5, p90: 7.5 });
  });

  it("leaves them out of the first-time merge rate, top and bottom", async () => {
    await withEmpties();

    const estimate = await estimateFor(asking, RATES, options);

    // Five decided, five merged. The empties are in neither half: they did not
    // fail to merge, they never had anything to merge.
    expect(estimate.declared.figures).toMatchObject({ mergedFirstTime: 5, decided: 5, open: 0 });
  });

  it("leaves their drift out too — a session that changed nothing drifted nowhere", async () => {
    for (let unit = 1; unit <= 5; unit += 1) {
      await record(`odd job ${unit}`, { reality: ["src/thing.ts"], units: unit });
    }
    await record("came to nothing", { reality: [], drift: ["src/store.ts"] });

    const estimate = await estimateFor(asking, RATES, options);

    expect(estimate.declared.figures?.drift).toEqual([]);
  });

  it("cannot be counted towards the threshold by them", async () => {
    // Four sessions that did something and four that did not is eight records
    // and a sample of four, which is not enough to say anything about.
    for (let unit = 1; unit <= 4; unit += 1) {
      await record(`odd job ${unit}`, { reality: ["src/thing.ts"], units: unit });
    }
    for (let n = 0; n < 4; n += 1) {
      await record(`came to nothing ${n}`, { reality: [] });
    }

    const estimate = await estimateFor(asking, RATES, options);

    expect(estimate.declared).toMatchObject({ matched: 4, empty: 4 });
    expect(estimate.declared.figures).toBeUndefined();
  });
});

describe("formatEstimate", () => {
  const declared: EstimateGroup = {
    source: "declared",
    matched: 9,
    empty: 0,
    figures: {
      priced: 9,
      unpriced: 0,
      median: 7.5,
      p90: 13.5,
      mergedFirstTime: 6,
      decided: 8,
      open: 1,
      drift: [
        { path: "src/store.ts", sessions: 5 },
        { path: "rates.json", sessions: 2 },
      ],
    },
  };

  const captured: EstimateGroup = {
    source: "captured",
    matched: 6,
    empty: 0,
    figures: {
      priced: 6,
      unpriced: 0,
      median: 2.25,
      p90: 9,
      mergedFirstTime: 1,
      decided: 5,
      open: 1,
      drift: [],
    },
  };

  const base: Estimate = {
    intent: "rate limit the /orders endpoint",
    class: "api",
    source: "intent",
    declared,
    captured,
  };

  it("leads with the question and where the class came from", () => {
    const lines = formatEstimate(base);

    expect(lines[1]).toBe("  estimate  rate limit the /orders endpoint");
    expect(lines[2]).toBe("  class     api         from the intent");
  });

  it("heads each block with its own count and what that count is", () => {
    const lines = formatEstimate(base);

    expect(lines).toContain("  declared  9 sessions  intent written at session start");
    expect(lines).toContain("  captured  6 sessions  intent taken from the first prompt");
  });

  it("prints two medians and never a third that pools them", () => {
    const lines = formatEstimate(base).join("\n");

    // $7.50 and $2.25 are what the two sides cost. A pooled median over the
    // fifteen sessions would be a number neither side has and nobody was
    // billed, so nothing here prints one.
    expect(lines).toContain("  median    $7.50");
    expect(lines).toContain("  median    $2.25");
    expect(lines.match(/median/g)).toHaveLength(2);
    expect(lines).not.toContain("like it");
  });

  it("gives each block its own merge rate", () => {
    const lines = formatEstimate(base);

    expect(lines).toContain("  merged    6 of 8 first time (75%), 1 still open");
    expect(lines).toContain("  merged    1 of 5 first time (20%), 1 still open");
  });

  it("lists the drift under one label, in a column, counted over its own block", () => {
    const lines = formatEstimate(base);

    expect(lines).toContain("  drift     src/store.ts  5 of 9");
    expect(lines).toContain("            rates.json    2 of 9");
  });

  it("says why the captured block has no drift rather than leaving the line out", () => {
    // An absent line here would read as captured sessions never drifting. They
    // declared no scope, so there was nothing for them to drift from.
    expect(formatEstimate(base)).toContain(
      "  drift     nothing was declared to drift from, so none is counted",
    );
  });

  it("says what each block left out, beside that block's sample", () => {
    const lines = formatEstimate({
      ...base,
      declared: { ...declared, empty: 3 },
      captured: { ...captured, empty: 1 },
    });

    expect(lines).toContain(
      "  left out  3 sessions changed no files — nothing was attempted, so there is " +
        "nothing to estimate from",
    );
    expect(lines).toContain(
      "  left out  1 session changed no files — nothing was attempted, so there is " +
        "nothing to estimate from",
    );
  });

  it("says nothing about empties when there were none", () => {
    expect(formatEstimate(base).join("\n")).not.toContain("left out");
  });

  it("says the window once, not once per block", () => {
    const lines = formatEstimate({ ...base, since: "2026-05-20" });

    expect(lines[3]).toBe("  since     2026-05-20");
    expect(lines.join("\n").match(/2026-05-20/g)).toHaveLength(1);
  });

  it("prints a block that holds nothing rather than dropping it", () => {
    // Dropping it would leave the captured figures looking like the whole
    // answer, which is the pooled reading the split exists to prevent.
    const lines = formatEstimate({
      ...base,
      declared: { source: "declared", matched: 0, empty: 0 },
    });

    expect(lines).toContain("  declared  none — nothing like this was declared before it ran");
    expect(lines.join("\n")).not.toContain("$7.50");
  });

  it("says the same of a captured block with nothing in it", () => {
    const lines = formatEstimate({
      ...base,
      captured: { source: "captured", matched: 0, empty: 0 },
    });

    expect(lines).toContain("  captured  none — the hook recorded nothing like this");
  });

  it("gives a count and no figures for whichever block is too thin", () => {
    const lines = formatEstimate({
      ...base,
      captured: { source: "captured", matched: 3, empty: 0 },
    });

    expect(lines).toContain("  captured  3 sessions  intent taken from the first prompt");
    expect(lines).toContain("  too few   nothing is estimated from fewer than 5 sessions");
    // The other block is untouched by its neighbour being thin.
    expect(lines).toContain("  median    $7.50");
  });

  it("gives the advice once when both blocks are thin, not once each", () => {
    const lines = formatEstimate({
      ...base,
      declared: { source: "declared", matched: 3, empty: 0 },
      captured: { source: "captured", matched: 2, empty: 0 },
    });

    expect(lines.filter((line) => line.includes("too few"))).toHaveLength(2);
    expect(
      lines.filter((line) => line.includes("widen --since")),
    ).toHaveLength(1);
  });

  it("keeps the advice off a page where nothing was thin", () => {
    expect(formatEstimate(base).join("\n")).not.toContain("widen --since");
  });

  it("does not call an empty block too thin", () => {
    // Nothing was found, so there is no sample to widen towards. "too few"
    // there would be an answer to a question nobody could have asked.
    const lines = formatEstimate({
      ...base,
      declared: { source: "declared", matched: 0, empty: 0 },
    });

    expect(lines.filter((line) => line.includes("too few"))).toHaveLength(0);
  });

  it("admits an unpriced tail rather than folding it into the money", () => {
    const lines = formatEstimate({
      ...base,
      declared: { ...declared, figures: { ...declared.figures!, priced: 7, unpriced: 2 } },
    });

    expect(lines.join("\n")).toContain("2 sessions ran on a model with no rate");
  });

  it("says so rather than printing a rate nothing has settled", () => {
    const lines = formatEstimate({
      ...base,
      declared: {
        ...declared,
        figures: { ...declared.figures!, mergedFirstTime: 0, decided: 0, open: 9 },
      },
    });

    expect(lines).toContain("  merged    nothing has been settled yet, so there is no rate to give");
  });
});
