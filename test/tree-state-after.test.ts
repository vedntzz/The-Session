import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { treeStateAfter, treeStateSince } from "../src/git.js";
import { filesChanged } from "../src/tool-calls.js";

/**
 * The look after a tool call.
 *
 * A plain `treeStateSince` leaves out every path that is as it was at the start
 * commit, which is right for a before and wrong for an after: a call that put
 * a file back would leave it out of the look, and `filesChanged` could not tell
 * that from a file the call never touched. `treeStateAfter` adds the blob of
 * every path the before named, so the pair always compares like with like.
 */

const execFileAsync = promisify(execFile);
let root: string;
let cwd: string;
let start: string;
const git = async (...args: string[]) => (await execFileAsync("git", ["-C", cwd, ...args])).stdout.trim();

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "session-tree-after-")));
  cwd = path.join(root, "work");
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await git("init", "-q");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  for (const name of ["a", "b"]) await writeFile(path.join(cwd, "src", name), `${name}\n`);
  await git("add", "-A");
  await git("commit", "-q", "--no-verify", "-m", "init");
  start = await git("rev-parse", "HEAD");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("treeStateAfter", () => {
  it("is treeStateSince where the before named nothing", async () => {
    await writeFile(path.join(cwd, "src/a"), "changed\n");
    expect(await treeStateAfter({}, start, cwd)).toEqual(await treeStateSince(start, cwd));
  });

  it("is treeStateSince where every path the before named is still changed", async () => {
    await writeFile(path.join(cwd, "src/a"), "first\n");
    const before = await treeStateSince(start, cwd);
    await writeFile(path.join(cwd, "src/a"), "second\n");

    const after = await treeStateAfter(before, start, cwd);

    expect(after).toEqual(await treeStateSince(start, cwd));
    expect(after["src/a"]).toBe(await git("hash-object", "src/a"));
  });

  it("names a file the call put back, with its committed blob", async () => {
    await writeFile(path.join(cwd, "src/a"), "dirty\n");
    const before = await treeStateSince(start, cwd);
    await git("checkout", "--", "src/a");

    const after = await treeStateAfter(before, start, cwd);

    expect(await treeStateSince(start, cwd)).toEqual({});
    expect(after).toEqual({ "src/a": await git("rev-parse", `${start}:src/a`) });
    expect(filesChanged(before, after)).toEqual([{ path: "src/a", blob: after["src/a"] }]);
  });

  it("names a deleted file the call restored", async () => {
    await unlink(path.join(cwd, "src/b"));
    const before = await treeStateSince(start, cwd);
    expect(before).toEqual({ "src/b": null });
    await git("checkout", "--", "src/b");

    const after = await treeStateAfter(before, start, cwd);

    expect(after).toEqual({ "src/b": await git("rev-parse", `${start}:src/b`) });
  });

  it("names an untracked file the call removed as gone", async () => {
    await writeFile(path.join(cwd, "notes"), "scratch\n");
    const before = await treeStateSince(start, cwd);
    await unlink(path.join(cwd, "notes"));

    const after = await treeStateAfter(before, start, cwd);

    expect(after).toEqual({ notes: null });
    expect(filesChanged(before, after)).toEqual([{ path: "notes", blob: null }]);
  });

  it("keeps what else the call changed beside what it put back", async () => {
    await writeFile(path.join(cwd, "src/a"), "dirty\n");
    const before = await treeStateSince(start, cwd);
    await git("checkout", "--", "src/a");
    await writeFile(path.join(cwd, "src/new"), "new\n");

    const after = await treeStateAfter(before, start, cwd);

    expect(Object.keys(after).sort()).toEqual(["src/a", "src/new"]);
    expect(filesChanged(before, after).map((file) => file.path)).toEqual(["src/a", "src/new"]);
  });

  it("names every path the before named, so filesChanged never refuses its answer", async () => {
    await writeFile(path.join(cwd, "src/a"), "dirty\n");
    await unlink(path.join(cwd, "src/b"));
    await writeFile(path.join(cwd, "notes"), "scratch\n");
    const before = await treeStateSince(start, cwd);
    await git("checkout", "--", "src/a", "src/b");
    await unlink(path.join(cwd, "notes"));

    const after = await treeStateAfter(before, start, cwd);

    for (const named of Object.keys(before)) expect(Object.hasOwn(after, named)).toBe(true);
    expect(() => filesChanged(before, after)).not.toThrow();
  });

  it("reports no change for a path left as the before found it", async () => {
    await writeFile(path.join(cwd, "src/a"), "dirty\n");
    const before = await treeStateSince(start, cwd);

    expect(filesChanged(before, await treeStateAfter(before, start, cwd))).toEqual([]);
  });

  it("answers from a subdirectory of the checkout, in repo-relative paths", async () => {
    await writeFile(path.join(cwd, "src/a"), "dirty\n");
    const before = await treeStateSince(start, cwd);
    await git("checkout", "--", "src/a");

    const after = await treeStateAfter(before, start, path.join(cwd, "src"));

    expect(Object.keys(after)).toEqual(["src/a"]);
  });
});
