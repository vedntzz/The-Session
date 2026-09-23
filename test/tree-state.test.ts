import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startSession } from "../src/commands/start.js";
import { treeStateSince } from "../src/git.js";
import { treeStateChanges } from "../src/tree-state.js";

describe("treeStateChanges", () => {
  it("names a path whose blob moved, and not one that stayed", () => {
    expect(treeStateChanges({ a: "1", b: "2" }, { a: "1", b: "3" })).toEqual(["b"]);
  });

  it("counts a path going from as-committed to changed, and back", () => {
    expect(treeStateChanges({}, { a: "1" })).toEqual(["a"]);
    expect(treeStateChanges({ a: "1" }, {})).toEqual(["a"]);
  });

  it("tells a deletion apart from being as committed", () => {
    expect(treeStateChanges({}, { a: null })).toEqual(["a"]);
    expect(treeStateChanges({ a: null }, { a: "1" })).toEqual(["a"]);
    expect(treeStateChanges({ a: null }, { a: null })).toEqual([]);
  });

  it("sorts, and is not fooled by a path named like an Object property", () => {
    expect(treeStateChanges({ constructor: "1" }, { z: "1", constructor: "2" })).toEqual(["constructor", "z"]);
    expect(treeStateChanges({}, {})).toEqual([]);
  });
});

describe("treeStateSince", () => {
  const execFileAsync = promisify(execFile);
  let root: string;
  let cwd: string;
  const git = async (...args: string[]) => (await execFileAsync("git", ["-C", cwd, ...args])).stdout.trim();

  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), "session-tree-")));
    cwd = path.join(root, "work");
    await mkdir(path.join(cwd, "src"), { recursive: true });
    await git("init", "-q");
    await git("config", "user.email", "test@example.com");
    await git("config", "user.name", "Test");
    for (const name of ["a", "b"]) await writeFile(path.join(cwd, "src", name), `${name}\n`);
    await git("add", "-A");
    await git("commit", "-q", "--no-verify", "-m", "init");
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("isolates what changed between one look and the next", async () => {
    const start = await git("rev-parse", "HEAD");
    const look0 = await treeStateSince(start, cwd);
    await writeFile(path.join(cwd, "src/a"), "call 1\n");
    const look1 = await treeStateSince(start, cwd);
    await writeFile(path.join(cwd, "src/new"), "call 2\n");
    await unlink(path.join(cwd, "src/b"));
    const look2 = await treeStateSince(start, cwd);
    const call1Blob = await git("hash-object", "src/a");
    await git("checkout", "--", "src/a");
    const look3 = await treeStateSince(start, cwd);
    const look4 = await treeStateSince(start, cwd);

    expect(look0).toEqual({});
    expect(treeStateChanges(look0, look1)).toEqual(["src/a"]);
    expect(treeStateChanges(look1, look2)).toEqual(["src/b", "src/new"]);
    expect(treeStateChanges(look2, look3)).toEqual(["src/a"]);
    expect(treeStateChanges(look3, look4)).toEqual([]);
    expect(look2).toEqual({
      "src/a": call1Blob,
      "src/b": null,
      "src/new": await git("hash-object", "src/new"),
    });
  });

  it("is exactly the snapshot start records, so call 1 has its before", async () => {
    await writeFile(path.join(cwd, "src/a"), "dirty before start\n");
    await writeFile(path.join(cwd, "notes"), "untracked\n");
    const session = await startSession("work", { home: path.join(root, "store"), cwd });
    expect(await treeStateSince(session.startCommit, cwd)).toEqual(session.baselineState);
  });
});
