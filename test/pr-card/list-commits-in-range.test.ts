// The commits a PR contains: base..head, oldest first, merges included.
import { execFile } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listCommitsInRange } from "../../src/pr-card/list-commits-in-range.js";
import { createStartRepo } from "../fixtures/start-repo.js";

const exec = promisify(execFile);
let root: string;
let cwd: string;

async function git(...args: string[]): Promise<string> {
  const { stdout } = await exec("git", ["-C", cwd, ...args]);
  return stdout.trim();
}

/** Writes a file named after the message and commits it; returns the SHA. */
async function commit(message: string): Promise<string> {
  await writeFile(path.join(cwd, `${message}.txt`), message);
  await git("add", "-A");
  await git("commit", "-q", "--no-verify", "-m", message);
  return git("rev-parse", "HEAD");
}

beforeEach(async () => {
  ({ root, cwd } = await createStartRepo());
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("listCommitsInRange", () => {
  it("returns the commits after base up to head, oldest first", async () => {
    const base = await git("rev-parse", "HEAD");
    const shas = [await commit("one"), await commit("two"), await commit("three")];
    expect(await listCommitsInRange(cwd, base, shas[2]!)).toEqual(shas);
  });

  it("returns nothing when base is head", async () => {
    const head = await commit("one");
    expect(await listCommitsInRange(cwd, head, head)).toEqual([]);
  });

  it("throws naming an unknown ref, rather than returning nothing", async () => {
    const head = await git("rev-parse", "HEAD");
    await expect(listCommitsInRange(cwd, "no-such-branch", head)).rejects.toThrow(/no-such-branch/u);
    await expect(listCommitsInRange(cwd, head, "no-such-branch")).rejects.toThrow(/no-such-branch/u);
  });

  it("includes a merge commit inside the range", async () => {
    const base = await git("rev-parse", "HEAD");
    const trunk = await git("branch", "--show-current");
    await git("checkout", "-q", "-b", "side");
    const side = await commit("side");
    await git("checkout", "-q", trunk);
    const main = await commit("main");
    await git("merge", "-q", "--no-ff", "--no-edit", "side");
    const merge = await git("rev-parse", "HEAD");

    const listed = await listCommitsInRange(cwd, base, merge);
    expect(listed).toHaveLength(3);
    expect(new Set(listed)).toEqual(new Set([side, main, merge]));
    expect(listed.at(-1)).toBe(merge);
  });
});
