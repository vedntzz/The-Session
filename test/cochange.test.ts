import { describe, expect, it } from "vitest";
import {
  cochangeOf,
  MIN_RATE,
  MIN_TOGETHER,
  onlyCurrent,
  partnersOf,
  withTips,
  type CoChangePair,
  type CoChangeReport,
  type RepoTip,
} from "../src/cochange.js";
import { MIN_HISTORY } from "../src/debt.js";
import { zeroCost, type Session } from "../src/store.js";

/**
 * The aggregation, tested without a log.
 *
 * Nothing here opens a file. What the command reads off a directory of
 * somebody else's JSONL, and what a person sees, is arranged in
 * `test/cochange-read.test.ts`; what is concluded from a set of sessions — that
 * two files move together, that one of them moves with everything and so with
 * nothing in particular, that a repo is too young to ask — is the part a wrong
 * answer is invisible in, so it is tested against literals.
 */

const REPO = "remote:github.com/acme/tool";

let next = 0;

/** One recorded session, with the paths it changed. */
function session(reality: string[], over: Partial<Session> = {}): Session {
  next += 1;
  const startedAt = new Date(Date.UTC(2026, 0, next, 12, 0, 0)).toISOString();
  return {
    id: `s${next}`,
    repo: REPO,
    intent: "add rate limiting to /orders",
    intentSource: "declared",
    scope: [],
    baseline: [],
    reality,
    drift: reality,
    cost: { ...zeroCost(), inputTokens: 200_000, turns: 4, apiCalls: 8, model: "claude-opus-5" },
    outcome: "open",
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + 3_600_000).toISOString(),
    startCommit: "abc1234",
    ...over,
  };
}

/** `count` sessions that all changed the same paths. */
function times(count: number, reality: string[], over: Partial<Session> = {}): Session[] {
  return Array.from({ length: count }, () => session(reality, over));
}

/** The one repo's pairs, or nothing when the report declined to judge. */
function pairsOf(sessions: readonly Session[]): CoChangePair[] | undefined {
  const [repo] = cochangeOf(sessions).repos;
  return repo?.pairs;
}

/** The pairs as `a+b`, in the order they were reported. */
function named(pairs: CoChangePair[] | undefined): string[] {
  return (pairs ?? []).map((pair) => pair.paths.join("+"));
}

describe("cochangeOf", () => {
  it("reports a pair three sessions moved together", () => {
    const pairs = pairsOf(times(3, ["src/api/orders.ts", "src/api/orders.test.ts"]));

    expect(named(pairs)).toEqual(["src/api/orders.test.ts+src/api/orders.ts"]);
    expect(pairs?.[0]?.sessions).toBe(3);
    expect(pairs?.[0]?.rate).toBe(1);
    expect(MIN_TOGETHER).toBe(3);
  });

  it("leaves out a pair two sessions moved together", () => {
    const pairs = pairsOf([
      ...times(2, ["src/api/orders.ts", "src/api/orders.test.ts"]),
      ...times(1, ["src/git.ts"]),
    ]);

    expect(named(pairs)).toEqual([]);
  });

  it("counts a session once, however many times it listed the files", () => {
    const pairs = pairsOf(
      times(3, ["src/a.ts", "src/b.ts", "src/a.ts", "src/b.ts", "src/a.ts"]),
    );

    expect(pairs?.[0]?.sessions).toBe(3);
    expect(pairs?.[0]?.rate).toBe(1);
  });

  it("sorts the two paths, so a pair has one identity", () => {
    const pairs = pairsOf([
      session(["src/b.ts", "src/a.ts"]),
      session(["src/a.ts", "src/b.ts"]),
      session(["src/b.ts", "src/a.ts"]),
    ]);

    expect(pairs).toHaveLength(1);
    expect(pairs?.[0]?.paths).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("reads reality, not drift — coupling is not a fact about anybody's plan", () => {
    const declared = { scope: ["src/"], drift: [] };
    const pairs = pairsOf(times(3, ["src/a.ts", "src/b.ts"], declared));

    expect(named(pairs)).toEqual(["src/a.ts+src/b.ts"]);
  });

  it("divides by the commoner of the two", () => {
    // Together three times; `a` was in a fourth session on its own.
    const pairs = pairsOf([...times(3, ["src/a.ts", "src/b.ts"]), ...times(1, ["src/a.ts"])]);

    expect(pairs?.[0]?.sessions).toBe(3);
    expect(pairs?.[0]?.rate).toBe(0.75);
  });

  it("drops a pair whose commoner half changes in everything else", () => {
    // Three sessions together, and `store.ts` in seven more: 3/10 is not a
    // pair, it is one busy file the other happened to be near.
    const pairs = pairsOf([
      ...times(3, ["src/store.ts", "src/b.ts"]),
      ...times(7, ["src/store.ts"]),
    ]);

    expect(named(pairs)).toEqual([]);
    expect(MIN_RATE).toBe(0.7);
  });

  it("keeps a pair exactly on the bar", () => {
    // Seven together, `a` in three more: 7/10, which is `MIN_RATE` itself.
    const pairs = pairsOf([...times(7, ["src/a.ts", "src/b.ts"]), ...times(3, ["src/a.ts"])]);

    expect(pairs?.[0]?.rate).toBe(MIN_RATE);
  });

  it("orders by strength, then by count, then by path", () => {
    const pairs = pairsOf([
      // 1.0 over three sessions.
      ...times(3, ["src/a.ts", "src/b.ts"]),
      // 0.8 over four: commoner, weaker, and second.
      ...times(4, ["src/c.ts", "src/d.ts"]),
      ...times(1, ["src/c.ts"]),
    ]);

    expect(named(pairs)).toEqual(["src/a.ts+src/b.ts", "src/c.ts+src/d.ts"]);
    expect(pairs?.map((pair) => pair.rate)).toEqual([1, 0.8]);
  });

  it("breaks a tie in strength on the count, and the rest on the path", () => {
    const pairs = pairsOf([
      ...times(4, ["src/y1.ts", "src/y2.ts"]),
      ...times(3, ["src/x1.ts", "src/x2.ts"]),
      ...times(3, ["src/z1.ts", "src/z2.ts"]),
    ]);

    // All three are 1.0. The four-session pair leads; the two threes sort by
    // path, so the order is the same on every run.
    expect(named(pairs)).toEqual([
      "src/y1.ts+src/y2.ts",
      "src/x1.ts+src/x2.ts",
      "src/z1.ts+src/z2.ts",
    ]);
  });

  it("reports every pair a session of three files makes", () => {
    const pairs = pairsOf(times(3, ["src/a.ts", "src/b.ts", "src/c.ts"]));

    expect(named(pairs)).toEqual([
      "src/a.ts+src/b.ts",
      "src/a.ts+src/c.ts",
      "src/b.ts+src/c.ts",
    ]);
  });

  it("never lists docs, config or build files, however reliably they move", () => {
    const pairs = pairsOf(
      times(5, [
        "src/a.ts",
        "package.json",
        "README.md",
        ".github/workflows/ci.yml",
        "docs/decisions.md",
      ]),
    );

    // `src/a.ts` moved with all four of them every single time, and the four
    // moved with each other. None of them is a finding about this repo.
    expect(named(pairs)).toEqual([]);
  });

  it("still pairs the test file with the code it tests", () => {
    // `test` is not one of the ignored classes: a test moving with its subject
    // is the coupling this report exists to show.
    const pairs = pairsOf(times(3, ["src/scope.ts", "test/scope.test.ts", "package.json"]));

    expect(named(pairs)).toEqual(["src/scope.ts+test/scope.test.ts"]);
  });

  it("declines to judge a repo under the history floor", () => {
    const report = cochangeOf(times(2, ["src/a.ts", "src/b.ts"]));

    expect(report.repos[0]?.history).toBe(2);
    // Absent, not empty: "found nothing" and "could not look" are different.
    expect(report.repos[0]?.pairs).toBeUndefined();
    expect(MIN_HISTORY).toBe(3);
  });

  it("says a repo has no pairs once there is history to say it from", () => {
    const report = cochangeOf([
      session(["src/a.ts"]),
      session(["src/b.ts"]),
      session(["src/c.ts"]),
    ]);

    expect(report.repos[0]?.pairs).toEqual([]);
  });

  it("never pools two repositories' sessions", () => {
    const sessions = ["one", "two", "three"].flatMap((repo) => [
      ...times(2, ["src/a.ts", "src/b.ts"], { repo }),
      // Enough history that each repo is judged rather than declining to.
      session(["src/c.ts"], { repo }),
      session(["src/d.ts"], { repo }),
    ]);

    const report = cochangeOf(sessions);
    expect(report.repos).toHaveLength(3);
    expect(report.repos.map((repo) => repo.pairs)).toEqual([[], [], []]);
    // Six sessions moved that pair together across the machine, and no repo
    // reports it: two apiece is under the threshold, and it is per repo.
  });

  it("orders repositories by name, not by how coupled they are", () => {
    const report = cochangeOf([
      ...times(3, ["src/a.ts", "src/b.ts"], { repo: "zebra" }),
      ...times(3, ["src/a.ts"], { repo: "acme" }),
    ]);

    expect(report.repos.map((repo) => repo.repo)).toEqual(["acme", "zebra"]);
  });

  it("has nothing to say about no sessions at all", () => {
    expect(cochangeOf([])).toEqual({ repos: [] });
  });
});

describe("partnersOf", () => {
  it("names the files a path reliably moves with, strongest first", () => {
    const partners = partnersOf("src/api/orders.ts", [
      ...times(4, ["src/api/orders.ts", "test/orders.test.ts", "src/api/serializers.ts"]),
      ...times(1, ["src/api/orders.ts", "test/orders.test.ts"]),
    ]);

    expect(partners).toEqual([
      { path: "test/orders.test.ts", sessions: 5, rate: 1 },
      { path: "src/api/serializers.ts", sessions: 4, rate: 0.8 },
    ]);
  });

  it("holds the same thresholds the report does", () => {
    // `c` and `d` moved together every time either of them moved — twice,
    // which is not a pair here any more than it is in the report.
    const sessions = [...times(3, ["src/a.ts", "src/b.ts"]), ...times(2, ["src/c.ts", "src/d.ts"])];

    expect(partnersOf("src/a.ts", sessions).map((partner) => partner.path)).toEqual(["src/b.ts"]);
    expect(partnersOf("src/c.ts", sessions)).toEqual([]);
  });

  it("agrees with the report, pair for pair", () => {
    const sessions = [
      ...times(4, ["src/a.ts", "src/b.ts", "src/c.ts"]),
      ...times(1, ["src/a.ts", "src/b.ts"]),
      ...times(3, ["src/d.ts", "src/e.ts"]),
    ];

    const fromReport = (pairsOf(sessions) ?? [])
      .filter((pair) => pair.paths.includes("src/a.ts"))
      .map((pair) => pair.paths.find((path) => path !== "src/a.ts"));

    expect(partnersOf("src/a.ts", sessions).map((partner) => partner.path)).toEqual(fromReport);
  });

  it("finds nothing for a path no session changed", () => {
    expect(partnersOf("src/nowhere.ts", times(3, ["src/a.ts", "src/b.ts"]))).toEqual([]);
  });

  it("finds nothing for a path in a class the report never lists", () => {
    const sessions = times(5, ["src/a.ts", "package.json"]);

    // It moved with `src/a.ts` in every session, and it is still a lockfile.
    expect(partnersOf("package.json", sessions)).toEqual([]);
  });

  it("refuses a list spanning two repositories rather than pooling it", () => {
    const sessions = [
      ...times(3, ["src/a.ts", "src/b.ts"], { repo: "acme" }),
      ...times(3, ["src/a.ts", "src/b.ts"], { repo: "zebra" }),
    ];

    expect(() => partnersOf("src/a.ts", sessions)).toThrow(
      /one repository at a time.*acme, zebra.*Filter the sessions by repo first/s,
    );
  });

  it("takes no sessions as no partners", () => {
    expect(partnersOf("src/a.ts", [])).toEqual([]);
  });

  it("says whether each partner is still there, when given a tip", () => {
    const sessions = times(3, ["src/a.ts", "src/b.ts", "src/c.ts"]);
    const tip: RepoTip = { branch: "main", gone: new Set(["src/c.ts"]) };

    expect(partnersOf("src/a.ts", sessions, tip)).toEqual([
      { path: "src/b.ts", sessions: 3, rate: 1, gone: false },
      { path: "src/c.ts", sessions: 3, rate: 1, gone: true },
    ]);
  });

  it("leaves that unsaid when it was given no tip", () => {
    const [partner] = partnersOf("src/a.ts", times(3, ["src/a.ts", "src/b.ts"]));

    // Absent, not false: nobody looked, and `false` would claim somebody had.
    expect(partner).toEqual({ path: "src/b.ts", sessions: 3, rate: 1 });
    expect("gone" in (partner ?? {})).toBe(false);
  });

  it("keeps a partner that is gone rather than dropping it", () => {
    const tip: RepoTip = { branch: "main", gone: new Set(["src/b.ts"]) };

    // The caller decides what to do with it; the query says what it found.
    expect(partnersOf("src/a.ts", times(3, ["src/a.ts", "src/b.ts"]), tip)).toHaveLength(1);
  });
});

describe("withTips", () => {
  /** A repo with one pair in it, and a tip saying `src/b.ts` is gone. */
  function marked(gone: string[] = ["src/b.ts"]): CoChangeReport {
    const tip: RepoTip = { branch: "origin/main", gone: new Set(gone) };
    return withTips(cochangeOf(times(3, ["src/a.ts", "src/b.ts"])), new Map([[REPO, tip]]));
  }

  it("marks the paths the branch tip no longer holds, and names the branch", () => {
    const [repo] = marked().repos;

    expect(repo?.branch).toBe("origin/main");
    expect(repo?.pairs?.[0]?.gone).toEqual(["src/b.ts"]);
  });

  it("marks both halves of a pair that is wholly gone", () => {
    expect(marked(["src/a.ts", "src/b.ts"]).repos[0]?.pairs?.[0]?.gone).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("marks nothing where the tip still holds both", () => {
    const [repo] = marked([]).repos;

    // Checked and found present, which is a different answer from unchecked —
    // the branch is what says which of the two happened.
    expect(repo?.branch).toBe("origin/main");
    expect(repo?.pairs?.[0]?.gone).toEqual([]);
  });

  it("leaves a repo nobody could ask exactly as it was", () => {
    const found = cochangeOf(times(3, ["src/a.ts", "src/b.ts"]));
    const [repo] = withTips(found, new Map()).repos;

    // No branch, and an empty `gone` that means unasked rather than present.
    expect(repo?.branch).toBeUndefined();
    expect(repo?.pairs?.[0]?.gone).toEqual([]);
  });

  it("touches nothing else about the pair", () => {
    const before = cochangeOf(times(3, ["src/a.ts", "src/b.ts"])).repos[0]?.pairs?.[0];
    const after = marked().repos[0]?.pairs?.[0];

    expect(after?.paths).toEqual(before?.paths);
    expect(after?.sessions).toBe(before?.sessions);
    expect(after?.rate).toBe(before?.rate);
  });

  it("leaves a repo too young to judge without a branch", () => {
    const found = cochangeOf(times(2, ["src/a.ts", "src/b.ts"]));
    const tip: RepoTip = { branch: "origin/main", gone: new Set(["src/b.ts"]) };

    // Nothing was reported for it, so there was nothing to check.
    expect(withTips(found, new Map([[REPO, tip]])).repos[0]?.pairs).toBeUndefined();
  });
});

describe("onlyCurrent", () => {
  /** Two pairs; `src/old.ts` is gone, so the pair holding it is history. */
  function report(gone: string[]): CoChangeReport {
    const found = cochangeOf([
      ...times(3, ["src/a.ts", "src/b.ts"]),
      ...times(3, ["src/old.ts", "src/gone.ts"]),
    ]);
    return withTips(found, new Map([[REPO, { branch: "main", gone: new Set(gone) }]]));
  }

  it("drops the pairs carrying a path that is no longer there", () => {
    const kept = onlyCurrent(report(["src/old.ts"])).repos[0]?.pairs;

    expect(kept?.map((pair) => pair.paths)).toEqual([["src/a.ts", "src/b.ts"]]);
  });

  it("keeps every pair when the tip still holds them all", () => {
    expect(onlyCurrent(report([])).repos[0]?.pairs).toHaveLength(2);
  });

  it("keeps every pair of a repo that was never checked", () => {
    const found = cochangeOf(times(3, ["src/a.ts", "src/b.ts"]));

    // Nothing was asked, so nothing is dropped: an unchecked repo losing rows
    // would be the report answering a question it declined to put.
    expect(onlyCurrent(withTips(found, new Map())).repos[0]?.pairs).toHaveLength(1);
  });

  it("leaves the history count alone", () => {
    const wiped = ["src/a.ts", "src/b.ts", "src/old.ts", "src/gone.ts"];
    const [repo] = onlyCurrent(report(wiped)).repos;

    expect(repo?.pairs).toEqual([]);
    // Six sessions were recorded, whatever the report ends up printing.
    expect(repo?.history).toBe(6);
  });
});
