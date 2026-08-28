import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { debtReport, readAllSessions } from "../src/commands/debt.js";
import { estimateFor } from "../src/commands/estimate.js";
import { weekSessions } from "../src/commands/week.js";
import { verifyLog } from "../src/commands/verify.js";
import { parseRates, type RateTable } from "../src/pricing.js";
import {
  appendSession,
  readSessions,
  resolveStoreFile,
  updateSession,
  zeroCost,
  type Session,
  type StoreOptions,
} from "../src/store.js";

const execFileAsync = promisify(execFile);

/**
 * One repository, two logs.
 *
 * A repo is keyed on its origin remote, and on its location when it has none —
 * so a repo that gains an origin changes key and starts a second log, with
 * everything recorded before it left in the first. That is right at write
 * time: two chains, signed at different times, and neither may be spliced into
 * the other. It is wrong at read time, where the two are one repository's
 * history, and this is what checks they are read as one.
 */

const RATES: RateTable = parseRates(
  JSON.stringify({
    models: { "claude-opus-5": { input: 5, cacheRead: 0.5, cacheCreation: 6.25, output: 25 } },
  }),
  "test rates",
);

const REMOTE = "git@github.com:acme/tool.git";
const REMOTE_IDENTITY = "remote:github.com/acme/tool";

let root: string;
let repo: string;
let options: StoreOptions & { home: string; cwd: string };

/** Runs git inside the temp checkout. */
async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repo, ...args]);
  return stdout.trim();
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-same-repo-"));
  repo = path.join(root, "tool");
  options = { home: path.join(root, "store"), cwd: repo };
  await execFileAsync("git", ["init", "-q", "-b", "main", repo]);
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

let day = 0;

/** Records one closed session in whatever the repo is keyed on right now. */
async function record(fields: Partial<Session> = {}): Promise<Session> {
  day += 1;
  const startedAt = new Date(Date.UTC(2026, 6, day, 12, 0, 0)).toISOString();
  const session = await appendSession(
    {
      intent: fields.intent ?? "rate limit the /orders endpoint",
      startedAt,
      startCommit: "abc1234",
      scope: fields.scope ?? [],
    },
    options,
  );
  return updateSession(
    session.id,
    {
      reality: fields.drift ?? ["src/api/orders.ts"],
      drift: fields.drift ?? [],
      class: "api",
      cost: { ...zeroCost(), inputTokens: 200_000, turns: 4, apiCalls: 8, model: "claude-opus-5" },
      endedAt: new Date(Date.parse(startedAt) + 3_600_000).toISOString(),
    },
    options,
  );
}

/** What every log in the store is called, for counting files rather than rows. */
async function logs(): Promise<string[]> {
  return (await readdir(options.home)).filter((name) => name.endsWith(".jsonl")).sort();
}

describe("a repo that gains an origin remote", () => {
  it("keeps writing to a second log, leaving the first one intact", async () => {
    await record({ intent: "before the remote" });
    const first = await resolveStoreFile(options);

    await git("remote", "add", "origin", REMOTE);
    await record({ intent: "after the remote" });

    // Two chains, not one spliced file: the point of merging at read time.
    expect(await logs()).toHaveLength(2);
    expect(await resolveStoreFile(options)).not.toBe(first);
  });

  it("reads both logs as one history", async () => {
    await record({ intent: "before the remote" });
    await git("remote", "add", "origin", REMOTE);
    await record({ intent: "after the remote" });

    expect((await readSessions(options)).map((session) => session.intent)).toEqual([
      "before the remote",
      "after the remote",
    ]);
  });

  it("reports the merged history under what the repo is called now", async () => {
    await record();
    await git("remote", "add", "origin", REMOTE);
    await record();

    const repos = new Set((await readSessions(options)).map((session) => session.repo));
    expect([...repos]).toEqual([REMOTE_IDENTITY]);
  });

  it("gives week the sessions from before the remote", async () => {
    await record({ intent: "before the remote" });
    await git("remote", "add", "origin", REMOTE);
    await record({ intent: "after the remote" });

    // A rolling window over sessions dated in the past needs a wide one.
    const week = await weekSessions(365, options);
    expect(week.map((session) => session.intent)).toEqual([
      "before the remote",
      "after the remote",
    ]);
  });

  it("gives estimate the sessions from before the remote", async () => {
    for (const _ of [1, 2, 3]) {
      await record();
    }
    await git("remote", "add", "origin", REMOTE);
    for (const _ of [1, 2]) {
      await record();
    }

    // Five api sessions, which is the floor — split three and two, neither
    // half would have reached it and the answer would have been "too few".
    const estimate = await estimateFor({ intent: "rate limit the /orders endpoint" }, RATES, options);
    expect(estimate.declared.matched).toBe(5);
    expect(estimate.declared.figures).toBeDefined();
  });

  it("gives debt one repository, not two half-histories", async () => {
    const drift = { drift: ["src/api/orders.ts"] };
    await record(drift);
    await git("remote", "add", "origin", REMOTE);
    await record(drift);
    await record(drift);

    const report = await debtReport(RATES, options);
    expect(report.repos).toHaveLength(1);
    expect(report.repos[0]?.repo).toBe(REMOTE_IDENTITY);
    expect(report.repos[0]?.history).toBe(3);
    // Two sessions in one log and one in the other: apart, neither side has
    // three of anything, and the file would go unreported.
    expect(report.repos[0]?.files?.map((file) => file.path)).toEqual(["src/api/orders.ts"]);
  });

  it("clears debt declared after the remote for drift from before it", async () => {
    const drift = { drift: ["src/api/orders.ts"] };
    await record(drift);
    await record(drift);
    await record(drift);
    await git("remote", "add", "origin", REMOTE);
    await record({ scope: ["src/api/"] });

    expect((await debtReport(RATES, options)).repos[0]?.files).toEqual([]);
  });

  it("keeps a patch written after the remote on the session it belongs to", async () => {
    const before = await record({ intent: "before the remote" });
    await git("remote", "add", "origin", REMOTE);

    // `settle` and `mark` do exactly this: read the merged history, then patch
    // a session whose creating record is in the older log. Folded apart, the
    // patch would attach to nothing and the outcome would vanish.
    await updateSession(before.id, { outcome: "merged" }, options);

    const merged = (await readSessions(options)).find((session) => session.id === before.id);
    expect(merged?.outcome).toBe("merged");
    expect(merged?.intent).toBe("before the remote");
  });

  it("leaves both chains verifiable on their own", async () => {
    await record();
    await git("remote", "add", "origin", REMOTE);
    await record();

    for (const name of await logs()) {
      const { check } = await verifyLog({ log: path.join(options.home, name) });
      expect(check.break).toBeUndefined();
      expect(check.verified).toBe(check.total);
    }
  });

  it("does not merge a checkout whose origin points somewhere else", async () => {
    await record();
    await git("remote", "add", "origin", "git@github.com:acme/other.git");
    await record();

    // Both logs exist and both are this checkout's, so `readSessions` reads
    // them as one — it is the same directory, whatever it now points at. What
    // must not happen is `acme/other`'s own log being drawn in, which is what
    // the machine-wide report is checked for below.
    const report = await debtReport(RATES, options);
    expect(report.repos.map((entry) => entry.repo)).toEqual(["remote:github.com/acme/other"]);
  });
});

describe("readAllSessions", () => {
  it("leaves two unrelated repositories apart", async () => {
    await record();
    const other = { ...options, cwd: root };
    await appendSession(
      { intent: "somewhere else", startedAt: "2026-07-01T12:00:00.000Z", startCommit: "abc" },
      other,
    );

    const repos = new Set((await readAllSessions(options)).map((session) => session.repo));
    expect(repos.size).toBe(2);
  });

  it("merges only into a remote some log is already keyed on", async () => {
    // Two checkouts, each recorded before either had a remote, then both
    // pointed at the same origin. Nothing here was ever keyed on that remote,
    // so there is no log to merge into and nothing worth saying: the rule is
    // that the resolution is evidence two logs are one repo, not a licence to
    // rename a log that stands alone.
    await record();
    const second = path.join(root, "clone");
    await execFileAsync("git", ["init", "-q", "-b", "main", second]);
    await appendSession(
      { intent: "in the clone", startedAt: "2026-07-20T12:00:00.000Z", startCommit: "abc" },
      { ...options, cwd: second },
    );

    await git("remote", "add", "origin", REMOTE);
    await execFileAsync("git", ["-C", second, "remote", "add", "origin", REMOTE]);

    const repos = (await readAllSessions(options)).map((session) => session.repo);
    expect(new Set(repos).size).toBe(2);
    expect(repos.every((identity) => identity.startsWith("path:"))).toBe(true);
  });

  it("does not adopt a directory that has become part of another checkout", async () => {
    // Recorded in a plain directory, which later ends up inside a checkout of
    // something else. The origin it would answer with belongs to that repo,
    // not to this work: the location has to still be the root of the repo it
    // names, or it resolves to nothing.
    const plain = path.join(root, "plain");
    await mkdir(plain);
    await appendSession(
      { intent: "before there was a repo", startedAt: "2026-07-02T12:00:00.000Z", startCommit: "a" },
      { ...options, cwd: plain },
    );

    await execFileAsync("git", ["init", "-q", "-b", "main", root]);
    await execFileAsync("git", ["-C", root, "remote", "add", "origin", REMOTE]);
    await appendSession(
      { intent: "in the outer repo", startedAt: "2026-07-03T12:00:00.000Z", startCommit: "b" },
      { ...options, cwd: root },
    );

    const repos = new Set((await readAllSessions(options)).map((session) => session.repo));
    expect(repos).toContain(`path:${plain}`);
    expect(repos).toContain(REMOTE_IDENTITY);
  });

  it("leaves a path-keyed log alone when its directory is gone", async () => {
    await record();
    const identity = (await readSessions(options))[0]?.repo as string;
    await rm(repo, { recursive: true, force: true });

    // Nothing to resolve it to, and nothing pretending otherwise.
    const sessions = await readAllSessions({ home: options.home, cwd: root });
    expect(sessions.map((session) => session.repo)).toEqual([identity]);
  });
});
