import { describe, expect, it } from "vitest";
import { parseRates, type RateTable } from "../src/pricing.js";
import {
  spendOfScanned,
  summarizeScan,
  TOP_SESSIONS,
  UNKNOWN_REPO,
  type ScannedSession,
} from "../src/scan.js";
import { zeroCost, zeroTokens, type SessionCost } from "../src/store.js";

/**
 * The arithmetic on top of the transcripts, tested without any.
 *
 * Nothing here opens a file. What `scan` reads off a directory of somebody
 * else's JSONL is awkward to arrange and slow to run; what it then adds up is
 * the part that reaches an invoice, and it is kept somewhere a wrong figure
 * can be shown with a literal. The reading half is `test/scan-read.test.ts`.
 */

const RATES: RateTable = parseRates(
  JSON.stringify({
    models: {
      "claude-opus-5": { input: 5, cacheRead: 0.5, cacheCreation: 6.25, output: 25 },
      "claude-haiku-4-5": { input: 1, cacheRead: 0.1, cacheCreation: 1.25, output: 5 },
    },
  }),
  "test rates",
);

/** A cost with the four counters set, and a share of it spent on nothing. */
function cost(over: Partial<SessionCost> = {}): SessionCost {
  return {
    ...zeroCost(),
    inputTokens: 100_000,
    outputTokens: 10_000,
    turns: 10,
    emptyTurns: 2,
    apiCalls: 20,
    callsWithoutEdits: 4,
    model: "claude-opus-5",
    emptyTurnTokens: { ...zeroTokens(), inputTokens: 20_000, outputTokens: 1_000 },
    ...over,
  };
}

function session(over: Partial<ScannedSession> = {}): ScannedSession {
  return {
    id: "aaaa",
    repo: "/dev/one",
    label: "add rate limiting to /orders",
    startedAt: "2026-08-20T14:00:00.000Z",
    endedAt: "2026-08-20T14:40:00.000Z",
    cost: cost(),
    ...over,
  };
}

describe("spendOfScanned", () => {
  it("prices the four counters apart, at the model's own rates", () => {
    // 100,000 input at $5/M is $0.50; 10,000 output at $25/M is $0.25.
    expect(spendOfScanned([session()], RATES).usd).toBeCloseTo(0.75, 10);
  });

  it("reports what the turns that changed no files cost", () => {
    // 20,000 input at $5/M is $0.10; 1,000 output at $25/M is $0.025.
    expect(spendOfScanned([session()], RATES).emptyUsd).toBeCloseTo(0.125, 10);
  });

  it("counts a model no rate covers rather than pricing it at a guess", () => {
    const spend = spendOfScanned([session({ cost: cost({ model: "gpt-9" }) })], RATES);

    expect(spend.usd).toBe(0);
    expect(spend.unpriced).toBe(1);
    expect(spend.unpricedModels).toEqual(["gpt-9"]);
  });

  it("keeps the total over the sessions it could price", () => {
    // The hole is admitted beside the figure, never inside it: a total that
    // quietly dropped the unpriced session would be a number people invoice.
    const spend = spendOfScanned(
      [session(), session({ id: "bbbb", cost: cost({ model: "gpt-9" }) })],
      RATES,
    );

    expect(spend.usd).toBeCloseTo(0.75, 10);
    expect(spend.unpriced).toBe(1);
  });

  it("does not report a transcript that moved no tokens as a missing rate", () => {
    // Nothing was captured for it, so no rate is missing. Counting it would
    // make `unpriced` mean "an empty file" as well as "money nobody knows".
    const spend = spendOfScanned(
      [session({ cost: { ...zeroCost(), model: "" } })],
      RATES,
    );

    expect(spend.unpriced).toBe(0);
    expect(spend.unpricedModels).toEqual([]);
  });

  it("names each unpriced model once, sorted", () => {
    const spend = spendOfScanned(
      [
        session({ id: "a", cost: cost({ model: "zeta-1" }) }),
        session({ id: "b", cost: cost({ model: "alpha-1" }) }),
        session({ id: "c", cost: cost({ model: "zeta-1" }) }),
      ],
      RATES,
    );

    expect(spend.unpricedModels).toEqual(["alpha-1", "zeta-1"]);
    expect(spend.unpriced).toBe(3);
  });

  it("calls a model with no name at all unknown, rather than blank", () => {
    const spend = spendOfScanned([session({ cost: cost({ model: "" }) })], RATES);

    expect(spend.unpricedModels).toEqual(["unknown"]);
  });
});

describe("summarizeScan", () => {
  const week = [
    session({ id: "a", repo: "/dev/one" }),
    session({ id: "b", repo: "/dev/one", cost: cost({ turns: 4, emptyTurns: 1 }) }),
    session({ id: "c", repo: "/dev/two", cost: cost({ model: "claude-haiku-4-5" }) }),
  ];

  it("counts every session, and the turns that produced nothing", () => {
    const report = summarizeScan(week, RATES, 30);

    expect(report.sessions).toBe(3);
    expect(report.turns).toBe(24);
    expect(report.emptyTurns).toBe(5);
    expect(report.days).toBe(30);
  });

  it("groups by repository, dearest first", () => {
    const report = summarizeScan(week, RATES, 30);

    expect(report.repos.map((row) => row.repo)).toEqual(["/dev/one", "/dev/two"]);
    expect(report.repos[0]?.sessions).toBe(2);
    expect(report.repos[0]?.emptyTurns).toBe(3);
    expect(report.repos[1]?.sessions).toBe(1);
  });

  it("breaks a tie on the repo's name, so the table is the same table twice", () => {
    // A report whose rows move between two runs over the same data is one
    // nobody can diff against last week's.
    const same = cost();
    const report = summarizeScan(
      [
        session({ id: "a", repo: "/dev/zebra", cost: same }),
        session({ id: "b", repo: "/dev/apple", cost: same }),
      ],
      RATES,
      30,
    );

    expect(report.repos.map((row) => row.repo)).toEqual(["/dev/apple", "/dev/zebra"]);
  });

  it("totals each repo's row over that repo alone", () => {
    const report = summarizeScan(week, RATES, 30);
    const one = report.repos.find((row) => row.repo === "/dev/one");

    expect(one?.spend.usd).toBeCloseTo(1.5, 10);
  });

  it("files a session with no working directory rather than dropping it", () => {
    const report = summarizeScan([session({ repo: UNKNOWN_REPO })], RATES, 30);

    expect(report.sessions).toBe(1);
    expect(report.repos).toHaveLength(1);
    expect(report.repos[0]?.repo).toBe(UNKNOWN_REPO);
  });

  describe("the dearest sessions", () => {
    it("names three, most expensive first", () => {
      const report = summarizeScan(
        [
          session({ id: "cheap", cost: cost({ outputTokens: 1_000 }) }),
          session({ id: "dear", cost: cost({ outputTokens: 100_000 }) }),
          session({ id: "middling", cost: cost({ outputTokens: 50_000 }) }),
          session({ id: "cheapest", cost: cost({ outputTokens: 10 }) }),
        ],
        RATES,
        30,
      );

      expect(report.top).toHaveLength(TOP_SESSIONS);
      expect(report.top.map((top) => top.session.id)).toEqual(["dear", "middling", "cheap"]);
      expect(report.top[0]?.usd).toBeGreaterThan(report.top[1]?.usd ?? 0);
    });

    it("labels them with the first prompt", () => {
      const report = summarizeScan([session({ label: "fix the flaky test" })], RATES, 30);

      expect(report.top[0]?.session.label).toBe("fix the flaky test");
    });

    it("leaves out sessions no rate covers, and says how many", () => {
      // "The three most expensive" is a claim about an order. A session with
      // no rate has no place in that order — putting it last would say it was
      // cheap, and first would say it was dear.
      const report = summarizeScan(
        [session({ id: "priced" }), session({ id: "not", cost: cost({ model: "gpt-9" }) })],
        RATES,
        30,
      );

      expect(report.top.map((top) => top.session.id)).toEqual(["priced"]);
      expect(report.unrankable).toBe(1);
    });

    it("comes back empty when nothing could be priced at all", () => {
      const report = summarizeScan([session({ cost: cost({ model: "gpt-9" }) })], RATES, 30);

      expect(report.top).toEqual([]);
      expect(report.unrankable).toBe(1);
    });

    it("breaks a tie on id, so the list does not shuffle between runs", () => {
      const same = cost();
      const report = summarizeScan(
        [session({ id: "b", cost: same }), session({ id: "a", cost: same })],
        RATES,
        30,
      );

      expect(report.top.map((top) => top.session.id)).toEqual(["a", "b"]);
    });
  });

  describe("commits that landed while a session ran", () => {
    it("counts the sessions that overlapped one", () => {
      const report = summarizeScan(
        [
          session({ id: "a", landed: true }),
          session({ id: "b", landed: false }),
          session({ id: "c", landed: true }),
        ],
        RATES,
        30,
      );

      expect(report.landed).toBe(2);
      expect(report.landingUnknown).toBe(0);
    });

    it("keeps a checkout that could not be asked apart from one that said no", () => {
      // Not knowing where work went is not the same answer as knowing it went
      // nowhere, and a report that added the two would be reporting the
      // second when it meant the first.
      const report = summarizeScan(
        [session({ id: "a", landed: false }), session({ id: "b" })],
        RATES,
        30,
      );

      expect(report.landed).toBe(0);
      expect(report.landingUnknown).toBe(1);
    });
  });
});
