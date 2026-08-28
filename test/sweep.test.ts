import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STOP_HOOK } from "../src/capture/hook.js";
import { endStateOf } from "../src/git.js";
import type { Observation } from "../src/outcome.js";
import {
  formatSweep,
  isDue,
  lastSweep,
  sweep,
  sweepFirst,
  sweepStampFile,
  SWEEP_INTERVAL_MS,
} from "../src/commands/sweep.js";
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
 * The two commands nobody remembers to run, running themselves.
 *
 * What is checked here is the part that is easy to get wrong in a way nobody
 * notices: that it is silent when it wrote nothing, that it does not run twice
 * in a day, and that it cannot take down the command it rode in on.
 */

const NOW = Date.parse("2026-08-28T12:00:00.000Z");

let root: string;
let repo: string;
let options: StoreOptions & { home: string; cwd: string };

async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repo, ...args]);
  return stdout.trim();
}

async function commit(message: string): Promise<void> {
  await git("add", "-A");
  await git("-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", message);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-sweep-"));
  repo = path.join(root, "tool");
  options = { home: path.join(root, "store"), cwd: repo };
  await execFileAsync("git", ["init", "-q", "-b", "main", repo]);
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await writeFile(path.join(repo, "orders.ts"), "the session wrote this\n", "utf8");
  await commit("what the session left");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function ago(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString();
}

/** A merged observation dated `days` ago, as `settle` writes one. */
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
 * Records a stopped session whose end state is the file as committed. Nothing
 * is settled: that is what the sweep is for.
 */
async function record(over: Partial<Session> = {}): Promise<Session> {
  const session = await appendSession(
    { intent: "rate limit the /orders endpoint", startedAt: ago(40), startCommit: "abc1234" },
    options,
  );
  return updateSession(
    session.id,
    {
      reality: ["orders.ts"],
      class: "api",
      cost: { ...zeroCost(), model: "claude-opus-5" },
      endedAt: ago(39),
      endState: await endStateOf(["orders.ts"], repo),
      ...over,
    },
    options,
  );
}

describe("isDue", () => {
  it("is due when the repo has never been swept", () => {
    expect(isDue(undefined, NOW)).toBe(true);
  });

  it("is not due again within the day", () => {
    expect(isDue(NOW - SWEEP_INTERVAL_MS + 1000, NOW)).toBe(false);
  });

  it("is due once a whole day has passed", () => {
    expect(isDue(NOW - SWEEP_INTERVAL_MS, NOW)).toBe(true);
  });

  it("is due when the stamp is in the future", () => {
    // A clock that moved backwards would otherwise stop this repo sweeping
    // until the date on the stamp came round again.
    expect(isDue(NOW + 30 * DAY_MS, NOW)).toBe(true);
  });
});

describe("sweep", () => {
  it("settles what has landed", async () => {
    await record();

    const result = await sweep(options, NOW);

    expect(result).toMatchObject({ ran: true, settled: 1 });
    const [session] = await readSessions(options);
    expect(session?.observations?.[0]).toMatchObject({ outcome: "merged", source: "computed" });
  });

  it("runs the survival checks that have come due", async () => {
    await record({ observations: [merged(20)], outcome: "merged" });

    const result = await sweep(options, NOW);

    expect(result.checks).toBe(1);
    const [session] = await readSessions(options);
    expect(survivalObservations(session as Session)[0]).toMatchObject({ window: 14 });
  });

  it("does not run twice in a day", async () => {
    await record();
    await sweep(options, NOW);

    const second = await sweep(options, NOW + SWEEP_INTERVAL_MS - 1000);

    expect(second.ran).toBe(false);
    expect(second.settled).toBe(0);
  });

  it("runs again the next day", async () => {
    await record({ observations: [merged(20)], outcome: "merged" });
    await sweep(options, NOW);

    // The thirty-day window closes eleven days from now; nothing is written in
    // between, and the sweep still runs.
    const later = await sweep(options, NOW + SWEEP_INTERVAL_MS);

    expect(later.ran).toBe(true);
    expect(later.checks).toBe(0);
  });

  it("stamps the repo before doing the work, not after", async () => {
    // A sweep cut short — the hook's budget runs out, the terminal closes —
    // waits for tomorrow rather than running again on the next command.
    await record();
    await sweep(options, NOW);

    const stamped = await lastSweep(await sweepStampFile(options));
    expect(stamped).toBe(NOW);
  });

  it("keeps one stamp per repo", async () => {
    await record();
    const other = { ...options, cwd: root };
    await appendSession(
      { intent: "somewhere else", startedAt: ago(40), startCommit: "abc" },
      other,
    );

    await sweep(options, NOW);

    // The other repo has never been swept, whatever this one has done.
    expect(await lastSweep(await sweepStampFile(other))).toBeUndefined();
    expect((await sweep(other, NOW)).ran).toBe(true);
  });

  it("does nothing, and leaves nothing behind, in a repo with no sessions", async () => {
    const result = await sweep(options, NOW);

    expect(result.ran).toBe(false);
    // No log, so no store directory: a `session week` in a repo that has never
    // recorded anything leaves the disk as it found it.
    await expect(stat(options.home)).rejects.toThrow();
  });

  it("treats an unreadable stamp as never swept", async () => {
    await record();
    const file = await sweepStampFile(options);
    await writeFile(file, "not a date\n", "utf8");

    expect(await lastSweep(file)).toBeUndefined();
    expect((await sweep(options, NOW)).ran).toBe(true);
  });

  it("gathers the repository once, and hands the answers back", async () => {
    await record();

    const result = await sweep(options, NOW);

    // What the sweep asked git is what the view that called it then reads its
    // outcomes from, rather than asking all over again.
    expect(result.facts?.branch).toBe("main");
    expect(result.facts?.history.has("orders.ts")).toBe(true);
  });

  it("writes nothing where there is no branch to judge against", async () => {
    const bare = path.join(root, "bare");
    await execFileAsync("git", ["init", "-q", "-b", "nothing-here", bare]);
    const elsewhere = { ...options, cwd: bare };
    await appendSession(
      { intent: "no branch here", startedAt: ago(40), startCommit: "abc" },
      elsewhere,
    );

    const result = await sweep(elsewhere, NOW);

    expect(result).toMatchObject({ ran: true, settled: 0, checks: 0 });
  });
});

describe("formatSweep", () => {
  it("says nothing when nothing was written", () => {
    expect(formatSweep({ ran: true, settled: 0, checks: 0 })).toEqual([]);
    expect(formatSweep({ ran: false, settled: 0, checks: 0 })).toEqual([]);
  });

  it("says what it wrote, in one line", () => {
    expect(formatSweep({ ran: true, settled: 2, checks: 1 })).toEqual([
      "  recorded 2 outcomes, 1 survival check",
    ]);
  });

  it("names only what there was", () => {
    expect(formatSweep({ ran: true, settled: 1, checks: 0 })).toEqual(["  recorded 1 outcome"]);
    expect(formatSweep({ ran: true, settled: 0, checks: 3 })).toEqual([
      "  recorded 3 survival checks",
    ]);
  });
});

describe("sweepFirst", () => {
  it("cannot take down the command it rode in on", async () => {
    await record();
    // The repository goes missing between the log being written and the sweep
    // running. `session week` still owes the developer a week.
    await rm(repo, { recursive: true, force: true });

    await expect(sweepFirst(options, NOW)).resolves.toEqual({ notice: [] });
  });

  it("hands back the notice and the facts together", async () => {
    await record();

    const swept = await sweepFirst(options, NOW);

    expect(swept.notice).toEqual(["  recorded 1 outcome"]);
    expect(swept.facts?.branch).toBe("main");
  });

  it("is silent on a day it has already run", async () => {
    await record();
    await sweepFirst(options, NOW);

    expect(await sweepFirst(options, NOW)).toEqual({ notice: [] });
  });
});

describe("the SessionEnd hook", () => {
  it("is given a budget the sweep can finish inside", () => {
    // Closing the session is no longer all it does. The stop is written first,
    // so a budget that still runs out costs a day of sweeping, not a record.
    expect(STOP_HOOK.command).toBe("session stop --if-open");
    expect(STOP_HOOK.timeout).toBe(30);
  });
});
