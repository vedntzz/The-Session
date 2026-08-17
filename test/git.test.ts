import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  changedFilesSince,
  currentCommit,
  defaultBranch,
  endStateOf,
  gatherRepoFacts,
  isRepo,
} from "../src/git.js";

const execFileAsync = promisify(execFile);

let repo: string;

/** Runs git inside the temp repo, with signing and hooks kept out of the way. */
async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repo, ...args]);
  return stdout.trim();
}

async function write(relPath: string, content: string): Promise<void> {
  const full = path.join(repo, relPath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, "utf8");
}

async function commit(message: string): Promise<string> {
  await git("add", "-A");
  await git("-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", message);
  return git("rev-parse", "HEAD");
}

beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "session-git-"));
  await git("init", "-q", "-b", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await git("config", "commit.gpgsign", "false");
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("isRepo", () => {
  it("is true at the repo root", async () => {
    await expect(isRepo(repo)).resolves.toBe(true);
  });

  it("is true in a subdirectory", async () => {
    const nested = path.join(repo, "packages", "core");
    await mkdir(nested, { recursive: true });
    await expect(isRepo(nested)).resolves.toBe(true);
  });

  it("is false outside a repo", async () => {
    const plain = await mkdtemp(path.join(tmpdir(), "session-plain-"));
    try {
      await expect(isRepo(plain)).resolves.toBe(false);
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });
});

describe("currentCommit", () => {
  it("returns undefined before the first commit", async () => {
    await expect(currentCommit(repo)).resolves.toBeUndefined();
  });

  it("returns the full HEAD sha", async () => {
    await write("a.txt", "one");
    const sha = await commit("first");
    await expect(currentCommit(repo)).resolves.toBe(sha);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("follows HEAD across commits", async () => {
    await write("a.txt", "one");
    const first = await commit("first");
    await write("a.txt", "two");
    const second = await commit("second");

    expect(second).not.toBe(first);
    await expect(currentCommit(repo)).resolves.toBe(second);
  });

  it("works from a subdirectory", async () => {
    await write("packages/core/index.ts", "export {};");
    const sha = await commit("first");
    await expect(currentCommit(path.join(repo, "packages", "core"))).resolves.toBe(sha);
  });

  it("throws outside a repo", async () => {
    const plain = await mkdtemp(path.join(tmpdir(), "session-plain-"));
    try {
      await expect(currentCommit(plain)).rejects.toThrow(/not a git repository/);
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });
});

describe("changedFilesSince", () => {
  let base: string;

  beforeEach(async () => {
    await write("kept.txt", "kept");
    await write("edited.txt", "before");
    await write("removed.txt", "gone soon");
    await write("src/nested/deep.ts", "export const a = 1;");
    base = await commit("base");
  });

  it("returns nothing when the tree is clean", async () => {
    await expect(changedFilesSince(base, repo)).resolves.toEqual([]);
  });

  it("reports an unstaged edit", async () => {
    await write("edited.txt", "after");
    await expect(changedFilesSince(base, repo)).resolves.toEqual(["edited.txt"]);
  });

  it("reports a staged edit", async () => {
    await write("edited.txt", "after");
    await git("add", "edited.txt");
    await expect(changedFilesSince(base, repo)).resolves.toEqual(["edited.txt"]);
  });

  it("reports a deletion", async () => {
    await rm(path.join(repo, "removed.txt"));
    await expect(changedFilesSince(base, repo)).resolves.toEqual(["removed.txt"]);
  });

  it("reports untracked files", async () => {
    await write("brand-new.txt", "hello");
    await expect(changedFilesSince(base, repo)).resolves.toEqual(["brand-new.txt"]);
  });

  it("omits files ignored by .gitignore", async () => {
    await write(".gitignore", "ignored/\n*.log\n");
    await write("ignored/thing.txt", "nope");
    await write("debug.log", "nope");
    await write("counted.txt", "yes");

    await expect(changedFilesSince(base, repo)).resolves.toEqual([".gitignore", "counted.txt"]);
  });

  it("combines tracked, deleted and untracked in sorted order", async () => {
    await write("edited.txt", "after");
    await rm(path.join(repo, "removed.txt"));
    await write("added.txt", "new");

    await expect(changedFilesSince(base, repo)).resolves.toEqual([
      "added.txt",
      "edited.txt",
      "removed.txt",
    ]);
  });

  it("reports paths relative to the repo root, not the cwd", async () => {
    const nested = path.join(repo, "src", "nested");
    await write("src/nested/deep.ts", "export const a = 2;");
    await write("src/nested/fresh.ts", "export const b = 3;");
    await write("top.txt", "changed at root");

    await expect(changedFilesSince(base, nested)).resolves.toEqual([
      "src/nested/deep.ts",
      "src/nested/fresh.ts",
      "top.txt",
    ]);
  });

  it("handles filenames with spaces and unicode", async () => {
    await write("a file with spaces.txt", "one");
    await write("papers/café ☕.md", "two");

    await expect(changedFilesSince(base, repo)).resolves.toEqual([
      "a file with spaces.txt",
      "papers/café ☕.md",
    ]);
  });

  it("accepts a short sha and other revision forms", async () => {
    await write("edited.txt", "after");
    const short = base.slice(0, 7);

    await expect(changedFilesSince(short, repo)).resolves.toEqual(["edited.txt"]);
    await expect(changedFilesSince("HEAD", repo)).resolves.toEqual(["edited.txt"]);
  });

  it("throws on an unknown commit", async () => {
    await expect(changedFilesSince("0".repeat(40), repo)).rejects.toThrow(/unknown commit/);
  });

  it("throws when given a tree-ish that is not a commit", async () => {
    const tree = await git("rev-parse", "HEAD^{tree}");
    await expect(changedFilesSince(tree, repo)).rejects.toThrow(/unknown commit/);
  });

  it("throws outside a repo", async () => {
    const plain = await mkdtemp(path.join(tmpdir(), "session-plain-"));
    try {
      await expect(changedFilesSince(base, plain)).rejects.toThrow(/not a git repository/);
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });
});

describe("defaultBranch", () => {
  it("finds main", async () => {
    await write("a.txt", "a");
    const head = await commit("first");

    await expect(defaultBranch(repo)).resolves.toEqual({ name: "main", tip: head });
  });

  it("finds master when there is no main", async () => {
    await write("a.txt", "a");
    await commit("first");
    await git("branch", "-m", "main", "master");

    await expect(defaultBranch(repo)).resolves.toMatchObject({ name: "master" });
  });

  it("prefers what origin says its default is", async () => {
    await write("a.txt", "a");
    await commit("first");
    await git("branch", "release");
    // A remote pointing at this same repo, with origin/HEAD naming `release`.
    await git("remote", "add", "origin", repo);
    await git("fetch", "-q", "origin");
    await git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/release");

    await expect(defaultBranch(repo)).resolves.toMatchObject({ name: "origin/release" });
  });

  it("prefers the remote's main over a local one that has fallen behind", async () => {
    await write("a.txt", "a");
    await commit("first");
    await git("remote", "add", "origin", repo);
    await git("fetch", "-q", "origin");

    await expect(defaultBranch(repo)).resolves.toMatchObject({ name: "origin/main" });
  });

  it("is undefined in a repo with no default branch at all", async () => {
    await write("a.txt", "a");
    await commit("first");
    await git("branch", "-m", "main", "wip");

    await expect(defaultBranch(repo)).resolves.toBeUndefined();
  });

  it("finds it from a subdirectory", async () => {
    await write("packages/core/a.txt", "a");
    await commit("first");

    await expect(defaultBranch(path.join(repo, "packages", "core"))).resolves.toMatchObject({
      name: "main",
    });
  });
});

describe("endStateOf", () => {
  it("hashes the files as they are now", async () => {
    await write("a.txt", "hello");
    await commit("first");

    const state = await endStateOf(["a.txt"], repo);

    expect(state["a.txt"]).toBe(await git("hash-object", "a.txt"));
  });

  it("records a deleted file as null", async () => {
    await write("a.txt", "hello");
    await commit("first");
    await rm(path.join(repo, "a.txt"));

    await expect(endStateOf(["a.txt"], repo)).resolves.toEqual({ "a.txt": null });
  });

  it("records an untracked file, which is still something the session left", async () => {
    await write("a.txt", "a");
    await commit("first");
    await write("new.txt", "brand new");

    const state = await endStateOf(["new.txt"], repo);

    expect(state["new.txt"]).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("gatherRepoFacts", () => {
  it("finds a blob anywhere in the branch's history, not only at the tip", async () => {
    await write("a.txt", "first version");
    await commit("first");
    const buried = await git("hash-object", "a.txt");
    await write("a.txt", "second version");
    await commit("second");

    const facts = await gatherRepoFacts(["a.txt"], repo);

    expect(facts?.history.get("a.txt")?.has(buried)).toBe(true);
  });

  it("does not claim a blob that was never in the branch", async () => {
    await write("a.txt", "committed");
    await commit("first");
    await write("a.txt", "only ever in the working tree");

    const facts = await gatherRepoFacts(["a.txt"], repo);
    const loose = await git("hash-object", "a.txt");

    expect(facts?.history.get("a.txt")?.has(loose)).toBe(false);
    expect(facts?.working.get("a.txt")).toBe(loose);
  });

  it("notes paths that are not at the tip, which is how a deletion lands", async () => {
    await write("a.txt", "a");
    await write("gone.txt", "gone");
    await commit("first");
    await rm(path.join(repo, "gone.txt"));
    await commit("delete it");

    const facts = await gatherRepoFacts(["a.txt", "gone.txt"], repo);

    expect(facts?.absentAtTip.has("gone.txt")).toBe(true);
    expect(facts?.absentAtTip.has("a.txt")).toBe(false);
  });

  it("reports null for a path with nothing in the working tree", async () => {
    await write("a.txt", "a");
    await commit("first");

    const facts = await gatherRepoFacts(["never.txt"], repo);

    expect(facts?.working.get("never.txt")).toBeNull();
    expect(facts?.history.get("never.txt")?.size).toBe(0);
  });

  it("is undefined outside a repository", async () => {
    const loose = await mkdtemp(path.join(tmpdir(), "session-loose-"));
    try {
      await expect(gatherRepoFacts(["a.txt"], loose)).resolves.toBeUndefined();
    } finally {
      await rm(loose, { recursive: true, force: true });
    }
  });

  it("is undefined when there is no branch to judge against", async () => {
    await write("a.txt", "a");
    await commit("first");
    await git("branch", "-m", "main", "wip");

    await expect(gatherRepoFacts(["a.txt"], repo)).resolves.toBeUndefined();
  });

  it("names the branch and its tip, which is what an observation records", async () => {
    await write("a.txt", "a");
    const head = await commit("first");

    await expect(gatherRepoFacts(["a.txt"], repo)).resolves.toMatchObject({
      branch: "main",
      tip: head,
    });
  });
});
