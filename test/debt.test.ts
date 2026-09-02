import { describe, expect, it } from "vitest";
import {
  debtOf,
  IGNORED_CLASSES,
  MIN_DRIFTS,
  MIN_HISTORY,
  type DebtFile,
} from "../src/debt.js";
import { parseRates, type RateTable } from "../src/pricing.js";
import { zeroCost, type Session, type SessionCost } from "../src/store.js";

/**
 * The aggregation, tested without a log.
 *
 * Nothing here opens a file. What `debt` reads off a directory of somebody
 * else's JSONL is arranged in `test/debt-read.test.ts`; what it then concludes
 * — that a file is owed, that a declaration cleared it, that a repo has too
 * little history to say — is the part a wrong answer is invisible in, so it is
 * tested against literals.
 */

const RATES: RateTable = parseRates(
  JSON.stringify({
    models: {
      "claude-opus-5": { input: 5, cacheRead: 0.5, cacheCreation: 6.25, output: 25 },
    },
  }),
  "test rates",
);

const REPO = "remote:github.com/acme/tool";

/** A cost of exactly $1.00: 200,000 input tokens at $5 per million. */
function cost(over: Partial<SessionCost> = {}): SessionCost {
  return { ...zeroCost(), inputTokens: 200_000, turns: 4, apiCalls: 8, model: "claude-opus-5", ...over };
}

let next = 0;

/**
 * One recorded session. `startedAt` climbs with each call, so a list built in
 * source order is the oldest-first list `debtOf` expects.
 */
function session(over: Partial<Session> = {}): Session {
  next += 1;
  const startedAt = new Date(Date.UTC(2026, 0, next, 12, 0, 0)).toISOString();
  return {
    id: `s${next}`,
    repo: REPO,
    intent: "add rate limiting to /orders",
    intentSource: "declared",
    scope: [],
    baseline: [],
    reality: [],
    drift: [],
    cost: cost(),
    outcome: "open",
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + 3_600_000).toISOString(),
    startCommit: "abc1234",
    ...over,
  };
}

/** A session that drifted onto these paths. */
function drifted(paths: string[], over: Partial<Session> = {}): Session {
  return session({ reality: paths, drift: paths, ...over });
}

/** The one repo's files, or nothing when the report declined to judge. */
function filesOf(sessions: readonly Session[], rates: RateTable = RATES): DebtFile[] | undefined {
  const [repo] = debtOf(sessions, rates).repos;
  return repo?.files;
}

function paths(files: DebtFile[] | undefined): string[] {
  return (files ?? []).map((file) => file.path);
}

describe("debtOf", () => {
  it("lists a file three sessions drifted onto", () => {
    const files = filesOf([
      drifted(["src/store.ts"]),
      drifted(["src/store.ts"]),
      drifted(["src/store.ts"]),
    ]);

    expect(paths(files)).toEqual(["src/store.ts"]);
    expect(files?.[0]?.sessions).toBe(3);
    expect(MIN_DRIFTS).toBe(3);
  });

  it("leaves out a file two sessions drifted onto", () => {
    const files = filesOf([
      drifted(["src/store.ts"]),
      drifted(["src/store.ts"]),
      drifted(["src/other.ts"]),
    ]);

    expect(paths(files)).toEqual([]);
  });

  it("counts a session once, however many times it touched the file", () => {
    const files = filesOf([
      drifted(["src/store.ts", "src/store.ts", "src/store.ts"]),
      drifted(["src/store.ts"]),
      drifted(["src/store.ts"]),
    ]);

    expect(files?.[0]?.sessions).toBe(3);
  });

  it("clears a file declared in scope by a later session", () => {
    const files = filesOf([
      drifted(["src/store.ts"]),
      drifted(["src/store.ts"]),
      drifted(["src/store.ts"]),
      session({ scope: ["src/store.ts"], reality: ["src/store.ts"] }),
    ]);

    expect(paths(files)).toEqual([]);
  });

  it("clears a file whose directory a later session declared", () => {
    // Scope entries are prefixes matched at directory boundaries, which is how
    // anybody actually declares a scope — `--scope src/store/`.
    const files = filesOf([
      drifted(["src/store/append.ts"]),
      drifted(["src/store/append.ts"]),
      drifted(["src/store/append.ts"]),
      session({ scope: ["src/store/"] }),
    ]);

    expect(paths(files)).toEqual([]);
  });

  it("does not clear a file on a scope that merely shares a prefix", () => {
    const files = filesOf([
      drifted(["src/stores.ts"]),
      drifted(["src/stores.ts"]),
      drifted(["src/stores.ts"]),
      session({ scope: ["src/store"] }),
    ]);

    expect(paths(files)).toEqual(["src/stores.ts"]);
  });

  it("keeps a file declared before its last drift, not after", () => {
    // The declaration came first and the drift came back afterwards: whatever
    // was said in between, work is still landing there unplanned.
    const files = filesOf([
      drifted(["src/store.ts"]),
      drifted(["src/store.ts"]),
      session({ scope: ["src/store.ts"] }),
      drifted(["src/store.ts"]),
    ]);

    expect(paths(files)).toEqual(["src/store.ts"]);
  });

  it.each([
    ["docs/pricing.md", "docs"],
    ["package.json", "build"],
    [".gitignore", "config"],
  ])("never lists %s, which classifies as %s", (path) => {
    const files = filesOf([drifted([path]), drifted([path]), drifted([path])]);

    expect(paths(files)).toEqual([]);
  });

  it("names the classes it leaves out, so the view can say which", () => {
    expect([...IGNORED_CLASSES]).toEqual(["docs", "config", "build"]);
  });

  it("orders files by how many sessions drifted onto them, then by path", () => {
    const files = filesOf([
      drifted(["src/b.ts", "src/a.ts", "src/c.ts"]),
      drifted(["src/b.ts", "src/a.ts", "src/c.ts"]),
      drifted(["src/b.ts", "src/a.ts", "src/c.ts"]),
      drifted(["src/b.ts"]),
    ]);

    expect(paths(files)).toEqual(["src/b.ts", "src/a.ts", "src/c.ts"]);
  });

  it("reports when the last session to drift onto a file stopped", () => {
    const last = drifted(["src/store.ts"], {
      endedAt: "2026-03-04T09:30:00.000Z",
    });
    const files = filesOf([drifted(["src/store.ts"]), drifted(["src/store.ts"]), last]);

    expect(files?.[0]?.lastTouched).toBe("2026-03-04T09:30:00.000Z");
  });

  it("falls back to the start of a session that has not stopped", () => {
    const running = drifted(["src/store.ts"], { endedAt: null });
    const files = filesOf([drifted(["src/store.ts"]), drifted(["src/store.ts"]), running]);

    expect(files?.[0]?.lastTouched).toBe(running.startedAt);
  });

  it("totals what the sessions that touched the file cost", () => {
    const files = filesOf([
      drifted(["src/store.ts"]),
      drifted(["src/store.ts"]),
      drifted(["src/store.ts"], { cost: cost({ inputTokens: 400_000 }) }),
      // Never touched it, so never counted towards it.
      drifted(["src/other.ts"]),
    ]);

    expect(files?.[0]?.spend.usd).toBeCloseTo(4, 10);
  });

  it("counts a model no rate covers rather than pricing it at a guess", () => {
    const unknown = { cost: cost({ model: "gpt-9" }) };
    const files = filesOf([
      drifted(["src/store.ts"]),
      drifted(["src/store.ts"], unknown),
      drifted(["src/store.ts"], unknown),
    ]);

    expect(files?.[0]?.spend).toMatchObject({
      unpriced: 2,
      unpricedModels: ["gpt-9"],
    });
    // The one session that could be priced, and nothing standing in for the two.
    expect(files?.[0]?.spend.usd).toBeCloseTo(1, 10);
  });

  it("counts a session nothing was captured for apart from an unpriced model", () => {
    // No rate is missing — there is no model on the record to want one for —
    // so it is not reported as a gap a rates file would fill. It is still a
    // hole in the total, and the cost cell reads `—` rather than `$0.00`:
    // these sessions may have changed files and billed for it.
    const nothing = { cost: { ...zeroCost(), model: "" } };
    const files = filesOf([
      drifted(["src/store.ts"], nothing),
      drifted(["src/store.ts"], nothing),
      drifted(["src/store.ts"], nothing),
    ]);

    expect(files?.[0]?.spend).toEqual({
      usd: 0,
      unpriced: 0,
      unpricedModels: [],
      uncaptured: 3,
    });
  });

  it("declines to judge a repo with fewer than three sessions", () => {
    const report = debtOf([drifted(["src/store.ts"]), drifted(["src/store.ts"])], RATES);

    expect(report.repos[0]?.history).toBe(2);
    // Absent, not empty: too little history to have found anything is not the
    // same statement as having found nothing.
    expect(report.repos[0]?.files).toBeUndefined();
    expect(MIN_HISTORY).toBe(3);
  });

  it("reports no debt, rather than nothing at all, once there is history", () => {
    const report = debtOf(
      [drifted(["src/a.ts"]), drifted(["src/b.ts"]), drifted(["src/c.ts"])],
      RATES,
    );

    expect(report.repos[0]?.files).toEqual([]);
  });

  it("counts every recorded session as history, drift or no drift", () => {
    const report = debtOf([session(), session(), session()], RATES);

    expect(report.repos[0]).toMatchObject({ history: 3, files: [] });
  });

  it("keeps repositories apart", () => {
    const other = "remote:github.com/acme/site";
    const report = debtOf(
      [
        drifted(["src/store.ts"]),
        drifted(["src/store.ts"]),
        drifted(["src/store.ts"], { repo: other }),
        drifted(["src/store.ts"], { repo: other }),
        drifted(["src/store.ts"], { repo: other }),
      ],
      RATES,
    );

    // Five sessions drifted onto that path, and neither repo owes it three.
    expect(report.repos.map((repo) => repo.repo)).toEqual([other, REPO]);
    expect(report.repos[0]?.files?.map((file) => file.path)).toEqual(["src/store.ts"]);
    expect(report.repos[1]?.files).toBeUndefined();
  });

  it("orders repositories by name, not by how much they owe", () => {
    const report = debtOf(
      [
        ...[1, 2, 3].map(() => drifted(["src/store.ts"], { repo: "zed" })),
        ...[1, 2, 3].map(() => session({ repo: "acme" })),
      ],
      RATES,
    );

    expect(report.repos.map((repo) => repo.repo)).toEqual(["acme", "zed"]);
  });

  it("finds no debt in sessions the hook recorded, which declare no scope", () => {
    // `stop` records no drift for a captured session — there was no
    // declaration to drift from — so there is nothing here to owe.
    const captured = { intentSource: "captured" as const, drift: [] };
    const report = debtOf(
      [
        session({ ...captured, reality: ["src/store.ts"] }),
        session({ ...captured, reality: ["src/store.ts"] }),
        session({ ...captured, reality: ["src/store.ts"] }),
      ],
      RATES,
    );

    expect(report.repos[0]).toMatchObject({ history: 3, files: [] });
  });

  it("has nothing to say about no sessions at all", () => {
    expect(debtOf([], RATES)).toEqual({ repos: [] });
  });
});
