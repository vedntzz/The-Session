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
} from "../src/commands/estimate.js";
import type { Observation } from "../src/outcome.js";
import type { RateTable } from "../src/pricing.js";
import {
  appendSession,
  updateSession,
  zeroCost,
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
}

/** Records one finished session. */
async function record(intent: string, past: Past = {}): Promise<Session> {
  const startedAt = new Date(Date.now() - (past.daysAgo ?? 0) * DAY_MS).toISOString();
  const session = await appendSession(
    {
      intent,
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
async function recordApiSessions(count: number): Promise<void> {
  for (let unit = 1; unit <= count; unit += 1) {
    await record(`api work ${unit}`, { units: unit });
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

    expect(estimate).toMatchObject({ class: "api", source: "intent", matched: 0 });
  });

  it("reports nothing but the count below the threshold", async () => {
    await recordApiSessions(MIN_SESSIONS - 1);

    const estimate = await estimateFor({ intent: "another endpoint" }, RATES, options);

    expect(estimate.matched).toBe(4);
    expect(estimate.figures).toBeUndefined();
  });

  it("reports the figures once there are enough", async () => {
    await recordApiSessions(9);

    const estimate = await estimateFor({ intent: "another endpoint" }, RATES, options);

    // Nine sessions at $1.50 through $13.50: the middle is the fifth, and
    // nearest-rank p90 is the ninth.
    expect(estimate.matched).toBe(9);
    expect(estimate.figures).toMatchObject({ median: 7.5, p90: 13.5, priced: 9 });
  });

  it("counts only sessions of the class being asked about", async () => {
    await recordApiSessions(6);
    await record("restyle", { reality: ["src/components/Header.tsx"] });

    expect((await estimateFor({ intent: "another endpoint" }, RATES, options)).matched).toBe(6);
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

    expect((await estimateFor({ intent: "another endpoint" }, RATES, options)).matched).toBe(5);
  });

  it("honours --since", async () => {
    await recordApiSessions(5);
    await record("old api work", { daysAgo: 90 });

    const since = Date.now() - 30 * DAY_MS;
    const estimate = await estimateFor({ intent: "another endpoint", since }, RATES, options);

    expect(estimate.matched).toBe(5);
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

    expect(estimate).toMatchObject({ class: "docs", source: "declared", matched: 2 });
  });

  it("classifies past sessions on their paths, not on their words", async () => {
    // The intent says schema; the files say ui, and the files are what ran.
    await record("add a column to the orders table", {
      reality: ["src/components/Table.tsx"],
    });

    expect((await estimateFor({ intent: "restyle a component" }, RATES, options)).matched).toBe(1);
  });

  it("takes the first look at each session, not the latest one", async () => {
    for (let n = 0; n < 5; n += 1) {
      await record(`api work ${n}`, {
        outcome: "merged",
        observations: [observation("abandoned", "computed"), observation("merged", "manual")],
      });
    }

    const estimate = await estimateFor({ intent: "another endpoint" }, RATES, options);

    expect(estimate.figures).toMatchObject({ mergedFirstTime: 0, decided: 5 });
  });
});

describe("formatEstimate", () => {
  const base: Estimate = {
    intent: "rate limit the /orders endpoint",
    class: "api",
    source: "intent",
    matched: 9,
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

  it("leads with the question and where the class came from", () => {
    const lines = formatEstimate(base);

    expect(lines[1]).toBe("  estimate  rate limit the /orders endpoint");
    expect(lines[2]).toBe("  class     api         from the intent");
    expect(lines[3]).toBe("  like it   9 sessions");
  });

  it("prints the money and the merge rate", () => {
    const lines = formatEstimate(base);

    expect(lines).toContain("  median    $7.50");
    expect(lines).toContain("  p90       $13.50");
    expect(lines).toContain("  merged    6 of 8 first time (75%), 1 still open");
  });

  it("lists the drift under one label, in a column", () => {
    const lines = formatEstimate(base);

    expect(lines).toContain("  drift     src/store.ts  5 of 9");
    expect(lines).toContain("            rates.json    2 of 9");
  });

  it("says the window when there was one", () => {
    expect(formatEstimate({ ...base, since: "2026-05-20" })[3]).toBe(
      "  like it   9 sessions since 2026-05-20",
    );
  });

  it("gives a count and no figures when the sample is too thin", () => {
    const lines = formatEstimate({ ...base, matched: 3, figures: undefined });

    expect(lines[3]).toBe("  like it   3 sessions");
    expect(lines[4]).toBe("  too few   nothing is estimated from fewer than 5 sessions");
    expect(lines[5]).toBe("            widen --since, or say --class if these were the wrong ones");
    expect(lines.join("\n")).not.toContain("median");
  });

  it("admits an unpriced tail rather than folding it into the money", () => {
    const lines = formatEstimate({
      ...base,
      figures: { ...(base.figures as NonNullable<Estimate["figures"]>), priced: 7, unpriced: 2 },
    });

    expect(lines.at(-1)).toContain("2 sessions ran on a model with no rate");
  });

  it("says so rather than printing a rate nothing has settled", () => {
    const lines = formatEstimate({
      ...base,
      figures: {
        ...(base.figures as NonNullable<Estimate["figures"]>),
        mergedFirstTime: 0,
        decided: 0,
        open: 9,
      },
    });

    expect(lines).toContain("  merged    nothing has been settled yet, so there is no rate to give");
  });
});
