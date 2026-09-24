import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, stat, symlink, unlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { treeStateCached, treeStateSince, type StatCache } from "../src/git.js";

const execFileAsync = promisify(execFile);
let root: string;
let cwd: string;
let head: string;
const git = async (...args: string[]) => (await execFileAsync("git", ["-C", cwd, ...args])).stdout.trim();

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "session-cached-")));
  cwd = path.join(root, "work");
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await git("init", "-q");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  for (const name of ["a", "b", "gone"]) await writeFile(path.join(cwd, "src", name), `${name} committed\n`);
  await git("add", "-A");
  await git("commit", "-q", "--no-verify", "-m", "init");
  head = await git("rev-parse", "HEAD");
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

/** A cache entry that matches the file's stat exactly, with a blob of our choosing. */
async function entryFor(file: string, blob: string, writtenAtNs: bigint): Promise<StatCache> {
  const info = await stat(path.join(cwd, file), { bigint: true });
  return {
    writtenAtNs: String(writtenAtNs),
    entries: { [file]: { mtimeNs: String(info.mtimeNs), ctimeNs: String(info.ctimeNs), size: String(info.size), ino: String(info.ino), blob } },
  };
}

describe("treeStateCached", () => {
  it("(a) rehashes a file written in the same tick as the look that cached it: the racily-clean rule", async () => {
    await writeFile(path.join(cwd, "src/a"), "edited\n");
    const mtime = (await stat(path.join(cwd, "src/a"), { bigint: true })).mtimeNs;
    // Every stat field matches the cache, but the cache was written at the file's
    // own mtime: an edit in that tick could have left the stat unchanged.
    const racy = await treeStateCached(head, cwd, await entryFor("src/a", "stale-blob", mtime));
    expect(racy.state["src/a"]).toBe(await git("hash-object", "src/a"));
    // Control: the same entry from a look that began after the write is trusted,
    // so the rule — not a stat mismatch — is what forced the rehash above.
    const clean = await treeStateCached(head, cwd, await entryFor("src/a", "stale-blob", mtime + 1n));
    expect(clean.state["src/a"]).toBe("stale-blob");
  });

  it("(b) detects an edit that keeps the size", async () => {
    await writeFile(path.join(cwd, "src/a"), "aaaa\n");
    const first = await treeStateCached(head, cwd, undefined);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeFile(path.join(cwd, "src/a"), "bbbb\n");
    const before = await stat(path.join(cwd, "src/a"));
    await utimes(path.join(cwd, "src/a"), before.atime, new Date(Number(first.cache.entries["src/a"]!.mtimeNs) / 1e6));
    const second = await treeStateCached(head, cwd, first.cache);
    expect(second.state["src/a"]).toBe(await git("hash-object", "src/a"));
    expect(second.state["src/a"]).not.toBe(first.state["src/a"]);
  });

  it("(c) detects a revert to HEAD content", async () => {
    await writeFile(path.join(cwd, "src/a"), "edited\n");
    const first = await treeStateCached(head, cwd, undefined);
    await git("checkout", "--", "src/a");
    // As the after hook asks: the path must be answered even though it is clean again.
    const withExtra = await treeStateCached(head, cwd, first.cache, ["src/a"]);
    expect(withExtra.state["src/a"]).toBe(await git("rev-parse", "HEAD:src/a"));
    expect(withExtra.state["src/a"]).not.toBe(first.state["src/a"]);
    // As the before hook asks: clean again, so no longer in the look at all.
    expect((await treeStateCached(head, cwd, first.cache)).state).not.toHaveProperty("src/a");
  });

  it("(d) with a cold cache, equals treeStateSince exactly", async () => {
    await writeFile(path.join(cwd, "src/a"), "modified\n");
    await writeFile(path.join(cwd, "src/new"), "untracked\n");
    await unlink(path.join(cwd, "src/gone"));
    await rm(path.join(cwd, "src/b"));
    await mkdir(path.join(cwd, "src/b"));
    await writeFile(path.join(cwd, "src/b/inner"), "now a directory\n");
    await symlink("a", path.join(cwd, "src/link"));
    const cold = await treeStateCached(head, cwd, undefined);
    const plain = await treeStateSince(head, cwd);
    expect(cold.state).toStrictEqual(plain);
    expect(Object.keys(cold.state)).toEqual(Object.keys(plain).sort());
  });

  it("reuses what it can vouch for, and says when it looked", async () => {
    await writeFile(path.join(cwd, "src/a"), "edited\n");
    const first = await treeStateCached(head, cwd, undefined);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await treeStateCached(head, cwd, first.cache);
    expect(second.state).toStrictEqual(first.state);
    expect(BigInt(second.cache.writtenAtNs)).toBeGreaterThan(BigInt(first.cache.writtenAtNs));
  });
});
