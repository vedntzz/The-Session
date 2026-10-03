// SES-3 and SES-9: what git is asked about a session's paths, and what counts as landed.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { changedFilesSince, endStateOf } from "../src/git.js";
import { factsFor } from "../src/observe.js";
import { effectiveOutcome } from "../src/outcome.js";
import { zeroCost, type Session } from "../src/store.js";

const run = promisify(execFile);
let repo: string;

async function git(...args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", repo, ...args]);
  return stdout.trim();
}

async function write(relPath: string, content: string): Promise<void> {
  const full = path.join(repo, relPath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, "utf8");
}

async function commit(message: string): Promise<string> {
  await git("add", "-A");
  await git("commit", "-q", "--no-verify", "-m", message);
  return git("rev-parse", "HEAD");
}

beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "session-sweep-git-"));
  await git("init", "-q", "-b", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await git("config", "commit.gpgsign", "false");
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("SES-3: a rename keeps both of its paths", () => {
  it("names the path a staged rename left, not only where it went", async () => {
    await write("secret/keys.txt", "one\ntwo\nthree\nfour\n");
    const start = await commit("init");
    await git("mv", "secret/keys.txt", "public.txt");

    await expect(changedFilesSince(start, repo)).resolves.toEqual(["public.txt", "secret/keys.txt"]);
  });

  it("names both paths of a rename that was committed during the session", async () => {
    await write("a.ts", "export const a = 1;\nexport const b = 2;\n");
    const start = await commit("init");
    await mkdir(path.join(repo, "lib"));
    await git("mv", "a.ts", "lib/a.ts");
    await commit("move");

    await expect(changedFilesSince(start, repo)).resolves.toEqual(["a.ts", "lib/a.ts"]);
  });

  it("holds when the repository turns rename detection on in config", async () => {
    await git("config", "diff.renames", "copies");
    await write("a.ts", "export const a = 1;\nexport const b = 2;\n");
    const start = await commit("init");
    await git("mv", "a.ts", "b.ts");

    await expect(changedFilesSince(start, repo)).resolves.toEqual(["a.ts", "b.ts"]);
  });
});

/** A stopped session that changed `paths` from `startCommit`, left as the working tree holds them now. */
async function stopped(startCommit: string, paths: string[]): Promise<Session> {
  return { id: "s1", repo: "r", intent: "work", scope: [], baseline: [], reality: paths, drift: [], cost: zeroCost(),
    outcome: "open", startedAt: "2026-10-03T09:00:00Z", endedAt: "2026-10-03T10:00:00Z", startCommit,
    endState: await endStateOf(paths, repo) };
}
const outcomeOf = async (session: Session) => effectiveOutcome(session, await factsFor([session], repo));

describe("SES-9: landed means it reached the branch after the session began", () => {
  it("does not call a revert to old content merged the moment it stops", async () => {
    await write("a.ts", "v1\n");
    await commit("v1");
    await write("a.ts", "v2\n");
    const start = await commit("v2");
    await write("a.ts", "v1\n"); // the session puts back what the branch held before

    expect(await outcomeOf(await stopped(start, ["a.ts"]))).toBe("open");
  });

  it("calls that revert merged once it is committed to the branch", async () => {
    await write("a.ts", "v1\n");
    await commit("v1");
    await write("a.ts", "v2\n");
    const start = await commit("v2");
    await write("a.ts", "v1\n");
    const session = await stopped(start, ["a.ts"]);
    await commit("revert");

    expect(await outcomeOf(session)).toBe("merged");
  });

  it("does not call a deletion merged when the branch never had the file", async () => {
    await write("a.ts", "base\n");
    await commit("base");
    await git("switch", "-q", "-c", "feature");
    await write("draft.ts", "draft\n");
    const start = await commit("draft on the feature branch");
    await rm(path.join(repo, "draft.ts"));

    expect(await outcomeOf(await stopped(start, ["draft.ts"]))).toBe("open");
  });

  it("still calls new content merged once the branch has it", async () => {
    await write("a.ts", "v1\n");
    const start = await commit("v1");
    await write("a.ts", "v2\n");
    const session = await stopped(start, ["a.ts"]);
    await commit("v2");

    expect(await outcomeOf(session)).toBe("merged");
  });
});
