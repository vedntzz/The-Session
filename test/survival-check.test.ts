import { execFile } from "node:child_process";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkSurvival, fatesFor, survivalReport } from "../src/commands/survival.js";
import { endStateOf } from "../src/git.js";
import type { Observation } from "../src/outcome.js";
import { plainPalette } from "../src/render/palette.js";
import { formatCheck, formatSurvival, NOTHING_MERGED } from "../src/render/terminal.js";
import { DAY_MS, survivalObservations } from "../src/survival.js";
import {
  appendSession,
  readSessions,
  updateSession,
  zeroCost,
  type Session,
  type StoreOptions,
} from "../src/store.js";

const execFileAsync = promisify(execFile);

/**
 * The half that asks git: what is at each path on the branch now.
 *
 * Separate from `test/survival.test.ts`, which tests the arithmetic with
 * literals. What is checked here is what only a real repository can show —
 * that a rewritten file reads as rewritten and a deleted one as deleted, that
 * a check is written once and never revised, and that a window closed too long
 * ago is left alone rather than answered from a branch that has moved on.
 */

const NOW = Date.parse("2026-08-28T12:00:00.000Z");

let root: string;
let repo: string;
let options: StoreOptions & { home: string; cwd: string };

async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repo, ...args]);
  return stdout.trim();
}

async function write(file: string, content: string): Promise<void> {
  await writeFile(path.join(repo, file), content, "utf8");
}

async function commit(message: string): Promise<void> {
  await git("add", "-A");
  await git("-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", message);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-survival-"));
  repo = path.join(root, "tool");
  options = { home: path.join(root, "store"), cwd: repo };
  await execFileAsync("git", ["init", "-q", "-b", "main", repo]);
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");

  await write("kept.ts", "the session wrote this\n");
  await write("rewritten.ts", "the session wrote this too\n");
  await write("deleted.ts", "and this\n");
  await commit("what the session left");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const PATHS = ["deleted.ts", "kept.ts", "rewritten.ts"];

/** An instant `days` before `NOW`. */
function ago(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString();
}

/** A `merged` observation dated `days` ago, as `settle` writes one. */
function merged(days: number): Observation {
  return {
    outcome: "merged",
    observedAt: ago(days),
    commit: "abc1234",
    branch: "main",
    source: "computed",
  };
}

/**
 * Records a stopped session whose end state is the repo as it is now, merged
 * `mergedDaysAgo` days back.
 */
async function record(mergedDaysAgo: number, over: Partial<Session> = {}): Promise<Session> {
  const endState = await endStateOf(over.reality ?? PATHS, repo);
  const session = await appendSession(
    { intent: "rate limit the /orders endpoint", startedAt: ago(60), startCommit: "abc1234" },
    options,
  );
  return updateSession(
    session.id,
    {
      reality: over.reality ?? PATHS,
      class: over.class ?? "api",
      cost: { ...zeroCost(), model: "claude-opus-5" },
      endedAt: ago(59),
      endState,
      observations: [merged(mergedDaysAgo)],
      outcome: "merged",
      ...(over.survival ? { survival: over.survival } : {}),
    },
    options,
  );
}

/** Rewrites one file and deletes another, then commits both. */
async function churnTheBranch(): Promise<void> {
  await write("rewritten.ts", "somebody else wrote this instead\n");
  await unlink(path.join(repo, "deleted.ts"));
  await commit("the week after");
}

/** The survival observations on the one session in the log. */
async function recorded(): Promise<readonly ReturnType<typeof survivalObservations>[number][]> {
  const [session] = await readSessions(options);
  return survivalObservations(session as Session);
}

describe("checkSurvival", () => {
  it("records what became of every path the session left", async () => {
    await record(20);
    await churnTheBranch();

    const result = await checkSurvival(options, NOW);

    expect(result.branch).toBe("main");
    expect(result.checked).toHaveLength(1);
    expect(result.checked[0]?.observation.fates).toEqual({
      "kept.ts": "survived",
      "rewritten.ts": "rewritten",
      "deleted.ts": "deleted",
    });
  });

  it("stamps the check with the day and the commit it was made against", async () => {
    await record(20);
    const tip = await git("rev-parse", "main");

    await checkSurvival(options, NOW);

    expect((await recorded())[0]).toMatchObject({
      window: 14,
      observedAt: new Date(NOW).toISOString(),
      commit: tip,
      branch: "main",
    });
  });

  it("writes the check onto the chain, where it survives a reread", async () => {
    await record(20);
    await churnTheBranch();
    await checkSurvival(options, NOW);

    // The point of the whole feature: read back tomorrow, the answer is the
    // one taken on the day rather than one recomputed from a branch that has
    // moved on.
    expect((await recorded())[0]?.fates["rewritten.ts"]).toBe("rewritten");
  });

  it("checks only the window that is due", async () => {
    await record(20);

    const result = await checkSurvival(options, NOW);

    expect(result.checked.map((checked) => checked.window)).toEqual([14]);
    expect(result.pending).toBe(1); // the thirty-day window is still open
  });

  it("writes nothing twice", async () => {
    await record(20);
    await checkSurvival(options, NOW);
    const second = await checkSurvival(options, NOW);

    expect(second.checked).toEqual([]);
    expect(await recorded()).toHaveLength(1);
  });

  it("never revises a check once it is written", async () => {
    await record(20);
    await checkSurvival(options, NOW);

    // The branch churns afterwards; the fourteen-day answer does not move.
    await churnTheBranch();
    await checkSurvival(options, NOW);

    const observations = await recorded();
    expect(observations).toHaveLength(1);
    expect(observations[0]?.fates["rewritten.ts"]).toBe("survived");
  });

  it("leaves a window that closed too long ago unanswered", async () => {
    // Merged 32 days ago: the fourteen-day window closed 18 days back, and the
    // branch today says nothing about what was there then.
    await record(32);

    const result = await checkSurvival(options, NOW);

    expect(result.missed).toBe(1);
    expect(result.checked.map((checked) => checked.window)).toEqual([30]);
  });

  it("leaves a session still inside its windows alone", async () => {
    await record(3);

    const result = await checkSurvival(options, NOW);

    expect(result.checked).toEqual([]);
    expect(result.pending).toBe(2);
  });

  it("counts a merged session with no merge date as unsettled", async () => {
    const session = await record(20);
    await updateSession(session.id, { observations: [] }, options);

    const result = await checkSurvival(options, NOW);

    expect(result.unsettled).toBe(1);
    expect(result.checked).toEqual([]);
  });

  it("checks nothing where there is no default branch to check against", async () => {
    const bare = path.join(root, "bare");
    await execFileAsync("git", ["init", "-q", "-b", "nothing-here", bare]);

    const result = await checkSurvival({ home: options.home, cwd: bare }, NOW);

    expect(result.branch).toBeUndefined();
    expect(result.checked).toEqual([]);
  });
});

describe("fatesFor", () => {
  it("reads a deletion that stuck as survived", async () => {
    await write("gone.ts", "about to go\n");
    await commit("add");
    await unlink(path.join(repo, "gone.ts"));
    const endState = await endStateOf(["gone.ts"], repo);

    expect(endState).toEqual({ "gone.ts": null });
    expect(fatesFor({ endState } as Session, new Map())).toEqual({ "gone.ts": "survived" });
  });

  it("reads a deletion somebody undid as rewritten", async () => {
    const session = { endState: { "gone.ts": null } } as unknown as Session;

    expect(fatesFor(session, new Map([["gone.ts", "blob9"]]))).toEqual({ "gone.ts": "rewritten" });
  });

  it("has nothing to say about a session with no end state", async () => {
    expect(fatesFor({} as Session, new Map())).toEqual({});
  });
});

describe("formatCheck", () => {
  it("says what it wrote, and what it did not", async () => {
    await record(20);
    await churnTheBranch();

    const lines = formatCheck(await checkSurvival(options, NOW), plainPalette);
    const text = lines.join("\n");

    expect(text).toContain("branch    main");
    expect(text).toContain("14 days");
    expect(text).toContain("33% of 3 files still there");
    expect(text).toContain("1 check recorded");
    expect(text).toContain("1 still inside their window");
  });

  it("says why a window past answering was left alone", async () => {
    await record(32);

    const text = formatCheck(await checkSurvival(options, NOW), plainPalette).join("\n");

    expect(text).toContain("the branch now is not evidence about then");
  });

  it("carries no colour and no emoji", async () => {
    await record(20);

    const text = formatCheck(await checkSurvival(options, NOW), plainPalette).join("\n");

    expect(text).not.toContain("[");
    expect(text).toMatch(/^[\s\S]*$/);
    expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}]/u);
  });
});

describe("formatSurvival", () => {
  it("says there is nothing to have survived before anything merges", async () => {
    const lines = formatSurvival(await survivalReport(options, NOW), plainPalette);

    expect(lines).toEqual(["", `  ${NOTHING_MERGED}`]);
  });

  it("reports the rate, the benchmark and which side of it you are on", async () => {
    for (let index = 0; index < 5; index += 1) {
      await record(20);
    }
    await churnTheBranch();
    await checkSurvival(options, NOW);

    const text = formatSurvival(await survivalReport(options, NOW), plainPalette).join("\n");

    // Five sessions, three paths each, one of the three still holding what the
    // session left: 5 of 15.
    expect(text).toContain("33% of 15 files still there · 5 sessions");
    expect(text).toContain("below the 90% benchmark");
    expect(text).toContain("67% churn");
    expect(text).toContain("5 rewritten, 5 deleted");
  });

  it("reports declared and captured on their own lines", async () => {
    for (let index = 0; index < 5; index += 1) {
      await record(20);
    }
    await checkSurvival(options, NOW);

    const text = formatSurvival(await survivalReport(options, NOW), plainPalette).join("\n");

    expect(text).toContain("declared  100% of 15 files still there · 5 sessions");
    // Kept rather than dropped, so the declared block is not read as the whole.
    expect(text).toContain("captured  nothing merged this long ago");
  });

  it("reports the count rather than a rate below the minimum sessions", async () => {
    await record(20);
    await checkSurvival(options, NOW);

    const text = formatSurvival(await survivalReport(options, NOW), plainPalette).join("\n");

    expect(text).toContain("1 session measured — fewer than 5, so no rate");
  });

  it("counts a session inside its window as pending, not as churn", async () => {
    await record(3);

    const text = formatSurvival(await survivalReport(options, NOW), plainPalette).join("\n");

    expect(text).toContain("1 still inside the window");
    // No rate anywhere: waiting is not churn, and there is nothing to report
    // as having survived or not.
    expect(text).not.toMatch(/\d+% of \d+ files/);
  });

  it("carries no colour when nothing is asking for it", async () => {
    for (let index = 0; index < 5; index += 1) {
      await record(20);
    }
    await checkSurvival(options, NOW);

    const text = formatSurvival(await survivalReport(options, NOW), plainPalette).join("\n");

    expect(text).not.toContain("[");
  });
});
