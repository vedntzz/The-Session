import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cochangeReport } from "../src/commands/cochange.js";
import { MIN_HISTORY } from "../src/debt.js";
import { plainPalette } from "../src/render/palette.js";
import { GONE } from "../src/render/terminal/cochange.js";
import { formatCochange } from "../src/render/terminal.js";
import { NOTHING_RECORDED } from "../src/render/terminal/debt.js";
import {
  appendSession,
  updateSession,
  zeroCost,
  type Session,
  type StoreOptions,
} from "../src/store.js";

/**
 * The half that reads the disk, and the half a person reads.
 *
 * Separate from `test/cochange.test.ts`, which tests the aggregation against
 * literals. What is checked here is what only real logs can show — that every
 * repository's log is read rather than the current one's — and what only the
 * view can: that a repo too young to judge is not printed as a repo with
 * nothing to report.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

let root: string;
let home: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-cochange-"));
  home = path.join(root, "store");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/**
 * Options pointing at one checkout inside the temp root. Two of these are two
 * repositories, because the store key falls back to the directory path when
 * there is no git remote.
 */
function repo(name: string): StoreOptions & { home: string; cwd: string } {
  return { home, cwd: path.join(root, name) };
}

let day = 0;

/** Records one closed session in a repo, with the paths it changed. */
async function record(options: StoreOptions, reality: string[]): Promise<Session> {
  day += 1;
  const startedAt = new Date(Date.UTC(2026, 0, day, 12, 0, 0)).toISOString();
  const session = await appendSession(
    { intent: "add rate limiting", startedAt, startCommit: "abc1234", scope: [] },
    options,
  );
  return updateSession(
    session.id,
    {
      reality,
      drift: reality,
      cost: { ...zeroCost(), inputTokens: 200_000, turns: 4, apiCalls: 8, model: "claude-opus-5" },
      endedAt: new Date(Date.parse(startedAt) + DAY_MS / 4).toISOString(),
    },
    options,
  );
}

describe("cochangeReport", () => {
  it("reads every repository's log, not just the one it was run from", async () => {
    for (let i = 0; i < 3; i += 1) {
      await record(repo("one"), ["src/a.ts", "src/b.ts"]);
      await record(repo("two"), ["src/c.ts", "src/d.ts"]);
    }

    // Asked from inside `one`, and `two`'s pair is there all the same.
    const report = await cochangeReport(repo("one"));
    expect(report.repos).toHaveLength(2);
    expect(report.repos.flatMap((entry) => entry.pairs ?? []).map((pair) => pair.paths)).toEqual([
      ["src/a.ts", "src/b.ts"],
      ["src/c.ts", "src/d.ts"],
    ]);
  });

  it("never pools two repositories' sessions onto one pair", async () => {
    for (const name of ["one", "two", "three"]) {
      await record(repo(name), ["src/a.ts", "src/b.ts"]);
      await record(repo(name), ["src/a.ts", "src/b.ts"]);
      await record(repo(name), ["src/c.ts"]);
    }

    const report = await cochangeReport(repo("one"));
    expect(report.repos).toHaveLength(3);
    // Six sessions moved that pair together across the machine, and no repo
    // reports it: two apiece is under the threshold, and it is per repo.
    expect(report.repos.map((entry) => entry.pairs)).toEqual([[], [], []]);
  });

  it("treats a store that does not exist yet as no repositories", async () => {
    expect(await cochangeReport({ home: path.join(root, "nothing"), cwd: root })).toEqual({
      repos: [],
    });
  });
});

describe("formatCochange", () => {
  /** The report a repo with these sessions produces, rendered. */
  async function rendered(sessions: string[][] = []): Promise<string[]> {
    const one = repo("one");
    for (const reality of sessions) {
      await record(one, reality);
    }
    return formatCochange(await cochangeReport(one), plainPalette);
  }

  it("says so on a machine with nothing recorded", async () => {
    expect(await rendered()).toEqual(["", `  ${NOTHING_RECORDED}`]);
  });

  it("declines to judge a repo with too little history", async () => {
    const pair = ["src/a.ts", "src/b.ts"];
    const lines = (await rendered([pair, pair])).join("\n");

    expect(lines).toContain(
      `not enough history to judge — 2 sessions recorded, ${MIN_HISTORY} needed`,
    );
    // Not a list of nothing dressed up as an all-clear.
    expect(lines).not.toContain("no two files moved together");
  });

  it("says a repo has no pairs once there is history to say it from", async () => {
    const lines = (await rendered([["src/a.ts"], ["src/b.ts"], ["src/c.ts"]])).join("\n");

    expect(lines).toContain("no two files moved together in 3 or more sessions at 70% or more");
    expect(lines).toContain("3 sessions of history");
  });

  it("lays the table out with both paths, the count and the strength", async () => {
    const pair = ["src/api/orders.ts", "test/orders.test.ts"];
    const lines = await rendered([pair, pair, pair]);

    expect(lines).toContain(
      "  file               moves with           sessions together  strength",
    );
    expect(lines).toContain(
      "  src/api/orders.ts  test/orders.test.ts                  3      100%",
    );
    expect(lines.join("\n")).toContain(
      "1 pair moved together in 3 or more sessions, 70% of the time or more · 3 sessions of history",
    );
  });

  it("says what the strength is a share of, and what is never listed", async () => {
    const pair = ["src/a.ts", "src/b.ts"];
    const lines = (await rendered([pair, pair, pair])).join("\n");

    expect(lines).toContain(
      "strength is the sessions a pair moved together in, over every session the " +
        "commoner of the two appeared in",
    );
    expect(lines).toContain("docs, config, build files are never listed");
  });

  it("prints no legend under a report that listed nothing", async () => {
    const lines = (await rendered([["src/a.ts"], ["src/b.ts"], ["src/c.ts"]])).join("\n");

    expect(lines).not.toContain("strength is the sessions");
  });

  it("carries no colour, no money, and no total across repositories", async () => {
    const pair = ["src/a.ts", "src/b.ts"];
    const lines = (await rendered([pair, pair, pair])).join("\n");

    expect(lines).not.toContain("[");
    expect(lines).not.toContain("$");
    expect(lines).not.toMatch(/total/i);
  });
});

const execFileAsync = promisify(execFile);

describe("cochangeReport, against a checkout", () => {
  let checkout: string;
  let options: StoreOptions & { home: string; cwd: string };

  async function git(...args: string[]): Promise<void> {
    await execFileAsync("git", ["-C", checkout, ...args]);
  }

  async function commit(message: string): Promise<void> {
    await git("add", "-A");
    await git("-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", message);
  }

  beforeEach(async () => {
    checkout = path.join(root, "tool");
    options = { home, cwd: checkout };
    await execFileAsync("git", ["init", "-q", "-b", "main", checkout]);
    await git("config", "user.email", "test@example.com");
    await git("config", "user.name", "Test");

    await writeFile(path.join(checkout, "a.ts"), "one\n", "utf8");
    await writeFile(path.join(checkout, "b.ts"), "two\n", "utf8");
    await commit("both files");

    for (let i = 0; i < 3; i += 1) {
      await record(options, ["a.ts", "b.ts"]);
    }
  });

  it("marks a pair whose file the branch tip no longer holds", async () => {
    await git("rm", "-q", "b.ts");
    await commit("split b.ts out");

    const [repo] = (await cochangeReport(options)).repos;
    expect(repo?.branch).toBe("main");
    expect(repo?.pairs?.[0]?.gone).toEqual(["b.ts"]);
  });

  it("marks nothing while both files are still there", async () => {
    const [repo] = (await cochangeReport(options)).repos;

    // Asked and answered, which the branch is what distinguishes from unasked.
    expect(repo?.branch).toBe("main");
    expect(repo?.pairs?.[0]?.gone).toEqual([]);
  });

  it("leaves the pair out entirely under --current", async () => {
    await git("rm", "-q", "b.ts");
    await commit("split b.ts out");

    const [repo] = (await cochangeReport(options, true)).repos;
    expect(repo?.pairs).toEqual([]);
    // The history is what it was; it is the printing that changed.
    expect(repo?.history).toBe(3);
  });

  it("says outright that a repo it cannot find was never checked", async () => {
    // A second repository in the same store, with no checkout to ask: its
    // pairs are neither marked nor dropped, and the view says which.
    for (let i = 0; i < 3; i += 1) {
      await record(repo("elsewhere"), ["src/x.ts", "src/y.ts"]);
    }

    const report = await cochangeReport(options, true);
    const absent = report.repos.find((entry) => entry.repo.includes("elsewhere"));

    expect(absent?.branch).toBeUndefined();
    expect(absent?.pairs).toHaveLength(1);

    const lines = formatCochange(report, plainPalette).join("\n");
    expect(lines).toContain(`not checked against a branch tip, so nothing here is marked ${GONE}`);
  });

  it("marks the row, names the branch, and says what to do about it", async () => {
    await git("rm", "-q", "b.ts");
    await commit("split b.ts out");

    const lines = formatCochange(await cochangeReport(options), plainPalette);

    expect(lines).toContain("  checked against main");
    expect(lines.some((line) => line.startsWith(`  a.ts  b.ts ${GONE}`))).toBe(true);
    expect(lines.join("\n")).toContain("session cochange --current lists only the pairs still there");
  });

  it("says nothing about gone files when none are marked", async () => {
    const lines = formatCochange(await cochangeReport(options), plainPalette).join("\n");

    expect(lines).not.toContain(GONE);
    expect(lines).toContain("checked against main");
  });

  it("writes nothing while asking the repository", async () => {
    await cochangeReport(options);

    const { stdout } = await execFileAsync("git", ["-C", checkout, "status", "--porcelain"]);
    expect(stdout).toBe("");
  });
});
