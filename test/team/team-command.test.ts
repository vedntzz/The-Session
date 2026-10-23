// TM-6: `session team --html` loads every synced record and writes the team report page.
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildProgram } from "../../src/program.js";
import type { Session } from "../../src/store.js";
import { commitTree, refFor, updateRef, writeBlob, writeTree } from "../../src/sync.js";
import { aggregateTeam } from "../../src/team/aggregate-team.js";
import { buildTeamReport } from "../../src/team/build-team-report.js";
import { costliestUnshipped } from "../../src/team/costliest-unshipped.js";
import type { TeamRecord } from "../../src/team/load-team-records.js";
import { otherReposNote, splitByRepo } from "../../src/team/split-by-repo.js";
import { cost, RATES, session } from "../fixtures/markdown.js";
import { createStartRepo } from "../fixtures/start-repo.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const DAY = 24 * 60 * 60 * 1000;
const TOOL = "remote:github.com/acme/tool";
const SITE = "remote:github.com/acme/site";
const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
// The label patterns team-html-privacy.test.ts checks, plus a JSON-style key.
const PERSONAL_FIELDS = [/<th[^>]*>\s*(author|name|email|login)\b/i, /<span[^>]*class="lbl"[^>]*>\s*(author|name|email|login)\b/i,
  /<h[1-6][^>]*>\s*(author|name|email|login)\b/i, /"(author|name|email|login)"\s*:/i];
let root: string;
let cwd: string;
let home: string;

const abandoned = { observations: [
  { outcome: "abandoned" as const, observedAt: new Date().toISOString(), commit: "abc", branch: "main", source: "manual" as const }] };

/** A never-merged session started `daysAgo` days back, $1.50 at RATES. */
function synced(id: string, repo: string, daysAgo: number): Session {
  const startedAt = new Date(Date.now() - daysAgo * DAY).toISOString();
  return session({ id, repo, startedAt, intent: `private intent ${id}`, cost: cost({ inputTokens: 100_000, agents: ["claude-code"] }), ...abandoned });
}

function logOf(sessions: readonly Session[]): string {
  return sessions.map(({ id, ...set }) => JSON.stringify({ v: 1, id, at: set.startedAt, set }) + "\n").join("");
}

async function publish(ref: string, sessions: readonly Session[]): Promise<void> {
  const tree = await writeTree(cwd, await writeBlob(cwd, logOf(sessions)));
  await updateRef(cwd, ref, await commitTree(cwd, tree, undefined, "session push"), undefined);
}

async function run(...argv: string[]): Promise<string> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await buildProgram({ home, cwd, adapters: [], tmp: root }).exitOverride().parseAsync(argv, { from: "user" });
    return log.mock.calls.map((call) => String(call[0])).join("\n");
  } finally {
    log.mockRestore();
  }
}

async function publishTwoRefs(): Promise<void> {
  await publish(refFor("ed25519:aaaa"), [synced("a1", TOOL, 2), synced("a2", TOOL, 45)]);
  await publish(refFor("ed25519:bbbb"), [synced("b1", SITE, 5)]);
}

beforeEach(async () => {
  ({ root, cwd, home } = await createStartRepo());
  await promisify(execFile)("git", ["-C", cwd, "remote", "add", "origin", "https://github.com/acme/tool.git"]);
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe("buildTeamReport", () => {
  it("is aggregateTeam with costliestUnshipped from the same in-window records", () => {
    const records: TeamRecord[] = [synced("a", TOOL, 2), synced("old", TOOL, 45)].map((s) => ({ ...s, sourceRef: "refs/session/a" }));
    const window = { from: new Date(Date.now() - 30 * DAY).toISOString(), to: new Date().toISOString() };
    const report = buildTeamReport(records, undefined, RATES, window);
    expect(report.groups).toEqual(aggregateTeam(records, undefined, RATES, window).groups);
    expect(report.costliestUnshipped).toEqual(costliestUnshipped([records[0]!], undefined, RATES));
    expect(report.costliestUnshipped).toHaveLength(1);
  });
});

describe("session team --html", () => {
  it("writes session-team.html in the current directory and prints its path", async () => {
    await publishTwoRefs();
    const out = await run("team", "--html");
    const file = path.join(cwd, "session-team.html");
    expect(out).toContain(file);
    const html = await readFile(file, "utf8");
    expect(html).toContain("Costliest Unshipped");
    expect(html).toContain("acme/tool");
  });

  it("writes to --out instead", async () => {
    const file = path.join(root, "report.html");
    expect(await run("team", "--html", "--out", file)).toContain(file);
    expect(existsSync(file)).toBe(true);
    expect(existsSync(path.join(cwd, "session-team.html"))).toBe(false);
  });

  it("sets the window from --since 7d, 30d or 90d", async () => {
    await publishTwoRefs();
    const sessionsIn = async (since: string) => {
      const file = path.join(root, `${since}.html`);
      await run("team", "--html", "--since", since, "--out", file);
      return (await readFile(file, "utf8")).match(/<li>/g)?.length ?? 0;
    };
    expect([await sessionsIn("7d"), await sessionsIn("30d"), await sessionsIn("90d")]).toEqual([1, 1, 2]);
  });

  it("defaults --since to 30d", async () => {
    await publish(refFor("ed25519:aaaa"), [synced("a1", TOOL, 2), synced("a2", TOOL, 25), synced("a3", TOOL, 45)]);
    await run("team", "--html");
    expect((await readFile(path.join(cwd, "session-team.html"), "utf8")).match(/<li>/g)).toHaveLength(2);
  });

  it("rejects a bad --since and writes nothing", async () => {
    await expect(run("team", "--html", "--since", "yesterday")).rejects.toThrow(/--since.*7d, 30d or 90d/);
    expect(existsSync(path.join(cwd, "session-team.html"))).toBe(false);
  });

  it("writes the empty page when no records are synced", async () => {
    await run("team", "--html");
    expect(await readFile(path.join(cwd, "session-team.html"), "utf8")).toContain("No sessions in this window");
  });

  it("requires --html for now", async () => {
    await expect(run("team")).rejects.toThrow(/--html is required/);
    expect(existsSync(path.join(cwd, "session-team.html"))).toBe(false);
  });

  it("writes no email, no personal field and no intent text", async () => {
    await publishTwoRefs();
    await run("team", "--html");
    const html = await readFile(path.join(cwd, "session-team.html"), "utf8");
    expect(html).not.toMatch(EMAIL);
    for (const pattern of PERSONAL_FIELDS) expect(html).not.toMatch(pattern);
    expect(html).not.toContain("private intent");
  });

  it("leaves out other repos' sessions and says how many, on the page and stdout", async () => {
    await publishTwoRefs();
    const out = await run("team", "--html");
    const html = await readFile(path.join(cwd, "session-team.html"), "utf8");
    const note = "1 sessions from other repos not included; run session team in those repos";
    expect(html).not.toContain("acme/site");
    expect(html).toContain(note);
    expect(out).toContain(note);
    expect(html.match(/<li>/g)).toHaveLength(1);
  });

  it("prints no note when every session is from this repo", async () => {
    await publish(refFor("ed25519:aaaa"), [synced("a1", TOOL, 2)]);
    const out = await run("team", "--html");
    expect(out).not.toContain("other repos");
    expect(await readFile(path.join(cwd, "session-team.html"), "utf8")).not.toContain("other repos");
  });
});

describe("splitByRepo", () => {
  const window = () => ({ from: new Date(Date.now() - 30 * DAY).toISOString(), to: new Date().toISOString() });
  const records = (): TeamRecord[] => [synced("a", TOOL, 2), synced("b", SITE, 3), synced("c", SITE, 45)]
    .map((s) => ({ ...s, sourceRef: "refs/session/x" }));

  it("keeps only this repo's records and counts the other repos' in the window", () => {
    const split = splitByRepo(records(), TOOL, window());
    expect(split.own.map((record) => record.id)).toEqual(["a"]);
    expect(split.otherRepoSessions).toBe(1);
  });

  it("never hands another repo's record to the report, so it is never classified here", () => {
    const report = buildTeamReport(splitByRepo(records(), TOOL, window()).own, undefined, RATES, window());
    expect(report.totals.sessions).toBe(1);
    expect(report.groups.map((group) => group.repo)).toEqual([TOOL]);
    expect(report.costliestUnshipped.map((entry) => entry.repo)).toEqual([TOOL]);
  });

  it("has a note only when something was left out", () => {
    expect(otherReposNote(0)).toBeUndefined();
    expect(otherReposNote(3)).toBe("3 sessions from other repos not included; run session team in those repos");
  });
});
