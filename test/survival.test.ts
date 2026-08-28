import { describe, expect, it } from "vitest";
import { MIN_SESSIONS } from "../src/estimate/figures.js";
import type { Observation } from "../src/outcome.js";
import {
  CHECK_GRACE_DAYS,
  DAY_MS,
  fateOf,
  meetsBenchmark,
  mergedAt,
  rateOf,
  sample,
  stateOf,
  summarizeSurvival,
  SURVIVAL_BENCHMARK,
  SURVIVAL_WINDOWS,
  type PathFate,
  type SurvivalObservation,
  type SurvivalWindow,
} from "../src/survival.js";
import { zeroCost, type Session } from "../src/store.js";

/**
 * What the recorded checks add up to, tested without a repository.
 *
 * Nothing here runs git. Whether a blob is still at a path is one question and
 * is arranged in `test/survival-check.test.ts`; what a shelf of dated answers
 * then says about whether the work stuck is this, and it is the half where a
 * wrong figure is invisible — so it is pinned against literals.
 */

const NOW = Date.parse("2026-08-28T12:00:00.000Z");

/** An instant `days` before `NOW`, as the log writes one. */
function ago(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString();
}

/** A `merged` observation, as `settle` writes it. */
function merged(days: number): Observation {
  return {
    outcome: "merged",
    observedAt: ago(days),
    commit: "abc1234",
    branch: "origin/main",
    source: "computed",
  };
}

/** A recorded survival check, with the fates given path by path. */
function check(window: SurvivalWindow, fates: Record<string, PathFate>): SurvivalObservation {
  return {
    window,
    observedAt: ago(1),
    commit: "def5678",
    branch: "origin/main",
    fates,
  };
}

let next = 0;

/**
 * A merged session, with its outcome already resolved — which is the contract
 * `summarizeSurvival` works under, the same one `week`'s filters work under.
 */
function session(over: Partial<Session> = {}): Session {
  next += 1;
  return {
    id: `s${next}`,
    repo: "remote:github.com/acme/tool",
    intent: "rate limit the /orders endpoint",
    intentSource: "declared",
    scope: [],
    baseline: [],
    reality: ["src/api/orders.ts"],
    drift: [],
    class: "api",
    cost: { ...zeroCost(), model: "claude-opus-5" },
    outcome: "merged",
    startedAt: ago(60),
    endedAt: ago(60),
    startCommit: "abc1234",
    endState: { "src/api/orders.ts": "blob1" },
    observations: [merged(40)],
    ...over,
  };
}

/** Five merged sessions, all measured at both windows with the fates given. */
function measured(fates: PathFate[], over: Partial<Session> = {}): Session[] {
  const paths = Object.fromEntries(fates.map((fate, index) => [`src/f${index}.ts`, fate]));
  return Array.from({ length: MIN_SESSIONS }, () =>
    session({
      endState: Object.fromEntries(Object.keys(paths).map((path) => [path, "blob1"])),
      survival: SURVIVAL_WINDOWS.map((window) => check(window, paths)),
      ...over,
    }),
  );
}

describe("fateOf", () => {
  it("calls a path holding the same blob survived", () => {
    expect(fateOf("blob1", "blob1")).toBe("survived");
  });

  it("calls a path holding something else rewritten", () => {
    expect(fateOf("blob1", "blob2")).toBe("rewritten");
  });

  it("calls a path that is not there any more deleted", () => {
    expect(fateOf("blob1", undefined)).toBe("deleted");
  });

  it("calls a deletion that stuck survived", () => {
    // The session deleted the file and it is still gone: what it left is what
    // is there, which is nothing.
    expect(fateOf(null, undefined)).toBe("survived");
  });

  it("calls a deletion somebody undid rewritten", () => {
    expect(fateOf(null, "blob9")).toBe("rewritten");
  });
});

describe("mergedAt", () => {
  it("is the first observation that said merged", () => {
    const first = merged(40);
    const later = { ...merged(10), source: "manual" as const };
    expect(mergedAt(session({ observations: [first, later] }))).toBe(first.observedAt);
  });

  it("ignores observations that said anything else", () => {
    const abandoned = { ...merged(50), outcome: "abandoned" as const };
    const landed = merged(20);
    expect(mergedAt(session({ observations: [abandoned, landed] }))).toBe(landed.observedAt);
  });

  it("is nothing for a session nobody has settled", () => {
    expect(mergedAt(session({ observations: undefined }))).toBeUndefined();
  });
});

describe("stateOf", () => {
  it("is measured once the check is on the record", () => {
    const recorded = session({ survival: [check(14, { "src/api/orders.ts": "survived" })] });
    expect(stateOf(recorded, 14, NOW)).toBe("measured");
  });

  it("is pending while the window is still open", () => {
    // Merged three days ago: it has not failed to survive a fortnight, it has
    // not been a fortnight.
    expect(stateOf(session({ observations: [merged(3)] }), 14, NOW)).toBe("pending");
  });

  it("is pending for the longer window while the shorter one is measured", () => {
    const recorded = session({
      observations: [merged(20)],
      survival: [check(14, { "src/api/orders.ts": "survived" })],
    });

    expect(stateOf(recorded, 14, NOW)).toBe("measured");
    expect(stateOf(recorded, 30, NOW)).toBe("pending");
  });

  it("is due once the window has closed and nobody has looked", () => {
    expect(stateOf(session({ observations: [merged(16)] }), 14, NOW)).toBe("due");
  });

  it("is still due at the last day of the grace period", () => {
    expect(stateOf(session({ observations: [merged(14 + CHECK_GRACE_DAYS)] }), 14, NOW)).toBe(
      "due",
    );
  });

  it("is missed once the branch now says nothing about then", () => {
    // A file rewritten in week three and restored in week six looks untouched
    // today. The question was answerable once and is not now.
    expect(stateOf(session({ observations: [merged(14 + CHECK_GRACE_DAYS + 1)] }), 14, NOW)).toBe(
      "missed",
    );
  });

  it("is unsettled when nothing records the merge", () => {
    expect(stateOf(session({ observations: [] }), 14, NOW)).toBe("unsettled");
  });
});

describe("rateOf", () => {
  it("is the share of the session's paths that survived", () => {
    const observation = check(14, { a: "survived", b: "survived", c: "rewritten", d: "deleted" });
    expect(rateOf(observation)).toBe(0.5);
  });

  it("is nothing at all for a check over no paths", () => {
    // Not a rate of nought: nought would say none of them survived.
    expect(rateOf(check(14, {}))).toBeUndefined();
  });
});

describe("summarizeSurvival", () => {
  const window = (sessions: Session[], which: SurvivalWindow = 14) =>
    summarizeSurvival(sessions, NOW).windows.find((report) => report.window === which);

  it("reports both windows, always", () => {
    expect(summarizeSurvival([], NOW).windows.map((report) => report.window)).toEqual([14, 30]);
  });

  it("rates the paths, not the sessions", () => {
    // Four sessions of one path that survived, and one of three that did not.
    // Over paths that is 4 of 7; averaging the session rates would call it 80%.
    const sessions = [
      ...Array.from({ length: 4 }, () =>
        session({
          endState: { "src/a.ts": "blob1" },
          survival: [check(14, { "src/a.ts": "survived" })],
        }),
      ),
      session({
        endState: { "src/b.ts": "blob1", "src/c.ts": "blob1", "src/d.ts": "blob1" },
        survival: [
          check(14, { "src/b.ts": "deleted", "src/c.ts": "deleted", "src/d.ts": "rewritten" }),
        ],
      }),
    ];

    expect(window(sessions)?.overall.figures?.rate).toBeCloseTo(4 / 7, 10);
    expect(window(sessions)?.overall.figures?.paths).toBe(7);
  });

  it("reports churn as the other end of the same figure", () => {
    const figures = window(measured(["survived", "rewritten", "deleted", "survived"]))?.overall
      .figures;

    expect(figures?.rate).toBeCloseTo(0.5, 10);
    expect(figures?.churn).toBeCloseTo(0.5, 10);
    expect(figures?.rewritten).toBe(MIN_SESSIONS);
    expect(figures?.deleted).toBe(MIN_SESSIONS);
  });

  it("reports the count and no rate below the minimum sessions", () => {
    const few = measured(["survived"]).slice(0, MIN_SESSIONS - 1);
    const overall = window(few)?.overall;

    expect(overall?.measured).toBe(MIN_SESSIONS - 1);
    expect(overall?.figures).toBeUndefined();
  });

  it("rates a sample of exactly the minimum", () => {
    expect(window(measured(["survived"]))?.overall.figures?.rate).toBe(1);
  });

  it("counts a session younger than the window as pending, never as a failure", () => {
    const young = Array.from({ length: MIN_SESSIONS }, () =>
      session({ observations: [merged(2)] }),
    );
    const overall = window([...measured(["survived"]), ...young])?.overall;

    expect(overall?.pending).toBe(MIN_SESSIONS);
    // The rate is over the measured sessions alone: the young ones are not in
    // the denominator, so waiting cannot drag the figure down.
    expect(overall?.figures?.rate).toBe(1);
    expect(overall?.figures?.paths).toBe(MIN_SESSIONS);
  });

  it("keeps the four session counts apart", () => {
    const sessions = [
      ...measured(["survived"]),
      session({ observations: [merged(2)] }),
      session({ observations: [merged(16)] }),
      session({ observations: [merged(60)] }),
    ];
    const overall = window(sessions)?.overall;

    expect(overall).toMatchObject({
      measured: MIN_SESSIONS,
      pending: 1,
      due: 1,
      missed: 1,
    });
  });

  it("leaves sessions that never merged out of it entirely", () => {
    const sessions = [
      ...measured(["survived"]),
      session({ outcome: "abandoned" }),
      session({ outcome: "open" }),
      session({ outcome: "empty" }),
    ];

    // An abandoned session has nothing to survive; counting it as not
    // surviving would count one fact twice under a second name.
    expect(summarizeSurvival(sessions, NOW).sessions).toBe(MIN_SESSIONS);
    expect(window(sessions)?.overall.measured).toBe(MIN_SESSIONS);
  });

  it("counts merged sessions with no merge date as unsettled", () => {
    const sessions = [...measured(["survived"]), session({ observations: [] })];

    expect(summarizeSurvival(sessions, NOW).unsettled).toBe(1);
    expect(window(sessions)?.overall.figures?.rate).toBe(1);
  });

  it("splits by class, in the class table's order", () => {
    const sessions = [
      ...measured(["survived"], { class: "ui" }),
      ...measured(["deleted"], { class: "api" }),
    ];
    const byClass = window(sessions)?.byClass;

    expect(byClass?.map((row) => row.class)).toEqual(["api", "ui"]);
    expect(byClass?.[0]?.sample.figures?.rate).toBe(0);
    expect(byClass?.[1]?.sample.figures?.rate).toBe(1);
  });

  it("names no class the log holds nothing for", () => {
    const byClass = window(measured(["survived"], { class: "api" }))?.byClass;

    expect(byClass?.map((row) => row.class)).toEqual(["api"]);
  });

  it("reports declared and captured apart, and never as a total", () => {
    const sessions = [
      ...measured(["survived"], { intentSource: "declared" }),
      ...measured(["survived", "deleted"], { intentSource: "captured" }),
    ];
    const report = window(sessions);

    expect(report?.declared.figures?.rate).toBe(1);
    expect(report?.captured.figures?.rate).toBe(0.5);
    // Ten sessions between them, and no field anywhere holding a pooled rate.
    expect(report?.overall.measured).toBe(2 * MIN_SESSIONS);
    expect(Object.keys(report ?? {})).not.toContain("bySource");
  });

  it("keeps a source block that holds nothing rather than dropping it", () => {
    // A block that vanished would leave the other reading as the whole answer.
    const report = window(measured(["survived"], { intentSource: "declared" }));

    expect(report?.captured).toMatchObject({ measured: 0, pending: 0, due: 0, missed: 0 });
    expect(report?.captured.figures).toBeUndefined();
  });
});

describe("the benchmark", () => {
  it("is one figure, quoted from both ends", () => {
    expect(SURVIVAL_BENCHMARK).toBe(0.9);
  });

  it("counts a rate exactly on the line as meeting it", () => {
    expect(meetsBenchmark(0.9)).toBe(true);
    expect(meetsBenchmark(0.90001)).toBe(true);
    expect(meetsBenchmark(0.899)).toBe(false);
  });
});

describe("sample", () => {
  it("counts states over one window at a time", () => {
    const sessions = [session({ observations: [merged(20)] })];

    expect(sample(sessions, 14, NOW)).toMatchObject({ due: 1, pending: 0 });
    expect(sample(sessions, 30, NOW)).toMatchObject({ due: 0, pending: 1 });
  });
});
