// The sessions whose work a PR's commits carry: matched by content, never by SHA.
import { execFile } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listCommitsInRange } from "../../src/pr-card/list-commits-in-range.js";
import { matchSessionsToCommits } from "../../src/pr-card/match-sessions-to-commits.js";
import type { Session } from "../../src/store.js";
import { session } from "../fixtures/markdown.js";
import { createStartRepo } from "../fixtures/start-repo.js";

const exec = promisify(execFile);
let root: string;
let cwd: string;
let base: string;

async function git(...args: string[]): Promise<string> {
  const { stdout } = await exec("git", ["-C", cwd, ...args]);
  return stdout.trim();
}

/** Writes each file, commits them all, and returns the new SHA. */
async function commit(files: Record<string, string>, message = Object.keys(files).join(" ")): Promise<string> {
  for (const [file, content] of Object.entries(files)) await writeFile(path.join(cwd, file), content);
  await git("add", "-A");
  await git("commit", "-q", "--no-verify", "-m", message);
  return git("rev-parse", "HEAD");
}

/** A blob id for `content`, as git would store it. */
async function blobOf(content: string): Promise<string> {
  const file = path.join(root, "blob.tmp");
  await writeFile(file, content);
  return git("hash-object", "--", file);
}

/** A session that started at base and left `endState` behind. */
function worked(id: string, startedAt: string, endState: Record<string, string>): Session {
  return session({ id, startedAt, endedAt: startedAt, startCommit: base, reality: Object.keys(endState), endState });
}

beforeEach(async () => {
  ({ root, cwd } = await createStartRepo());
  base = await git("rev-parse", "HEAD");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("matchSessionsToCommits", () => {
  it("returns nothing when no session's work is in the commits", async () => {
    const head = await commit({ "other.txt": "someone else" });
    const unrelated = worked("s1", "2026-10-01T09:00:00.000Z", { "a.txt": await blobOf("never committed") });
    const commits = await listCommitsInRange(cwd, base, head);
    expect(await matchSessionsToCommits(cwd, commits, [unrelated])).toEqual([]);
  });

  it("returns the session whose written content lands in a commit", async () => {
    const one = worked("s1", "2026-10-01T09:00:00.000Z", { "a.txt": await blobOf("the work") });
    const head = await commit({ "a.txt": "the work" });
    const commits = await listCommitsInRange(cwd, base, head);
    expect(await matchSessionsToCommits(cwd, commits, [one])).toEqual([one]);
  });

  it("returns both sessions that landed, ordered by start time", async () => {
    const later = worked("later", "2026-10-02T09:00:00.000Z", { "b.txt": await blobOf("second") });
    const earlier = worked("earlier", "2026-10-01T09:00:00.000Z", { "a.txt": await blobOf("first") });
    await commit({ "a.txt": "first" });
    const head = await commit({ "b.txt": "second" });
    const commits = await listCommitsInRange(cwd, base, head);
    expect(await matchSessionsToCommits(cwd, commits, [later, earlier])).toEqual([earlier, later]);
  });

  it("leaves out a session that landed in a commit before the range", async () => {
    const landedEarlier = worked("s1", "2026-10-01T09:00:00.000Z", { "a.txt": await blobOf("the work") });
    const before = await commit({ "a.txt": "the work" });
    const head = await commit({ "b.txt": "an unrelated change" });
    const commits = await listCommitsInRange(cwd, before, head);
    expect(commits).toEqual([head]);
    expect(await matchSessionsToCommits(cwd, commits, [landedEarlier])).toEqual([]);
  });

  it("matches a squash merge, whose commit is new but whose content is the same", async () => {
    const trunk = await git("branch", "--show-current");
    const squashed = worked("s1", "2026-10-01T09:00:00.000Z", { "a.txt": await blobOf("final") });
    await git("checkout", "-q", "-b", "feature");
    await commit({ "a.txt": "draft" });
    const original = await commit({ "a.txt": "final" });
    await git("checkout", "-q", trunk);
    await git("merge", "-q", "--squash", "feature");
    const squash = await commit({}, "squash feature");

    const commits = await listCommitsInRange(cwd, base, squash);
    expect(commits).toEqual([squash]);
    expect(commits).not.toContain(original);
    expect(await matchSessionsToCommits(cwd, commits, [squashed])).toEqual([squashed]);
  });
});
