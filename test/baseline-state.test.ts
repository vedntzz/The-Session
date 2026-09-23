import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startPassiveSession, startSession } from "../src/commands/start.js";
import { baselineChanges, stopSession } from "../src/commands/stop.js";
import { verifyLog } from "../src/commands/verify.js";
import { appendSession, foldLog, readLog, readSessions, updateSession, type SessionPatch } from "../src/store.js";

const execFileAsync = promisify(execFile);
let root: string;
let cwd: string;
let options: { home: string; cwd: string };

async function git(...args: string[]): Promise<string> {
  return (await execFileAsync("git", ["-C", cwd, ...args])).stdout.trim();
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "session-baseline-")));
  cwd = path.join(root, "work");
  await mkdir(path.join(cwd, "src"), { recursive: true });
  options = { home: path.join(root, "store"), cwd };
  await git("init", "-q");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await writeFile(path.join(cwd, "src/a.ts"), "committed a\n");
  await writeFile(path.join(cwd, "src/gone.ts"), "committed gone\n");
  await git("add", "-A");
  await git("commit", "-q", "--no-verify", "-m", "init");
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("the starting snapshot", () => {
  it("records the blob of every dirty file at start: modified, untracked and deleted", async () => {
    await writeFile(path.join(cwd, "src/a.ts"), "developer's own edit\n");
    await writeFile(path.join(cwd, "notes.md"), "untracked\n");
    await unlink(path.join(cwd, "src/gone.ts"));
    const session = await startSession("work", options);
    expect(session.baseline.sort()).toEqual(["notes.md", "src/a.ts", "src/gone.ts"]);
    expect(session.baselineState).toEqual({
      "notes.md": await git("hash-object", "notes.md"),
      "src/a.ts": await git("hash-object", "src/a.ts"),
      "src/gone.ts": null,
    });
  });

  it("records an empty snapshot for a clean tree, so absent still means a record from before it existed", async () => {
    expect((await startSession("clean", options)).baselineState).toEqual({});
  });

  it("is taken by a passive start too", async () => {
    await writeFile(path.join(cwd, "src/a.ts"), "dirty\n");
    const session = await startPassiveSession(options);
    expect(session?.baselineState).toEqual({ "src/a.ts": await git("hash-object", "src/a.ts") });
  });

  it("is what the file held at start, not later", async () => {
    await writeFile(path.join(cwd, "src/a.ts"), "at start\n");
    const at = await git("hash-object", "src/a.ts");
    const session = await startSession("work", options);
    await writeFile(path.join(cwd, "src/a.ts"), "the session's edit\n");
    expect((await readSessions(options))[0]!.baselineState).toEqual({ "src/a.ts": at });
    expect(session.baselineState!["src/a.ts"]).not.toBe(await git("hash-object", "src/a.ts"));
  });

  it("keeps no content, only hashes", async () => {
    await writeFile(path.join(cwd, "src/a.ts"), "PRIVATE CONTENT\n");
    await startSession("work", options);
    expect((await readLog(options)).lines.map((line) => line.text).join("\n")).not.toContain("PRIVATE CONTENT");
  });

  it("cannot be added or replaced by a later patch", async () => {
    const session = await startSession("work", options);
    await expect(updateSession(session.id, { baselineState: {} } as unknown as SessionPatch, options))
      .rejects.toThrow(/starting snapshot is taken at start/);
  });

  it.each([true, false])("ignores a forged later line, including on a session without one (with snapshot: %s)", async (withSnapshot) => {
    await writeFile(path.join(cwd, "src/a.ts"), "dirty\n");
    const created = withSnapshot
      ? await startSession("work", options)
      : await appendSession({ intent: "old", startedAt: "2026-09-22T09:00:00.000Z", startCommit: await git("rev-parse", "HEAD") }, options);
    const log = await readLog(options);
    log.lines.push({ no: log.lines.length + 1, text: JSON.stringify({
      id: created.id, set: { baselineState: { "src/a.ts": "forged" } },
    }) });
    expect(foldLog(log)[0]!.baselineState).toEqual(created.baselineState);
  });

  it("signs with the rest of the creating record and verifies", async () => {
    await writeFile(path.join(cwd, "src/a.ts"), "dirty\n");
    await startSession("work", options);
    expect(JSON.parse((await readLog(options)).lines[0]!.text).set).toHaveProperty("baselineState");
    expect((await verifyLog(options)).check).toMatchObject({ verified: 1, signaturesChecked: true });
  });
});

describe("using the snapshot at stop", () => {
  const stop = () => stopSession({ ...options, adapters: [] });

  it("counts a file the developer had changed and the session changed again", async () => {
    await writeFile(path.join(cwd, "src/a.ts"), "developer's edit\n");
    await startSession("work", { ...options, scope: ["docs/"] });
    await writeFile(path.join(cwd, "src/a.ts"), "developer's edit\nand the session's\n");
    const stopped = await stop();
    expect(stopped.reality).toEqual(["src/a.ts"]);
    expect(stopped.drift).toEqual(["src/a.ts"]);
    expect(stopped.endState).toEqual({ "src/a.ts": await git("hash-object", "src/a.ts") });
  });

  it("still leaves out a dirty file the session did not touch", async () => {
    await writeFile(path.join(cwd, "src/a.ts"), "developer's edit\n");
    await startSession("work", options);
    await writeFile(path.join(cwd, "src/new.ts"), "session\n");
    expect((await stop()).reality).toEqual(["src/new.ts"]);
  });

  it.each([
    ["put back to HEAD", async () => { await git("checkout", "--", "src/a.ts"); }],
    ["deleted", async () => { await unlink(path.join(cwd, "src/a.ts")); }],
  ])("counts a dirty file the session %s", async (_, act) => {
    await writeFile(path.join(cwd, "src/a.ts"), "developer's edit\n");
    await startSession("work", options);
    await act();
    expect((await stop()).reality).toEqual(["src/a.ts"]);
  });

  it("counts a file deleted at start that the session recreated, and an untracked one it removed", async () => {
    await unlink(path.join(cwd, "src/gone.ts"));
    await writeFile(path.join(cwd, "notes.md"), "untracked\n");
    await startSession("work", options);
    await writeFile(path.join(cwd, "src/gone.ts"), "back\n");
    await unlink(path.join(cwd, "notes.md"));
    const stopped = await stop();
    expect(stopped.reality).toEqual(["notes.md", "src/gone.ts"]);
    expect(stopped.endState).toMatchObject({ "notes.md": null });
  });

  it("leaves a record from before the snapshot exactly as it measured before", async () => {
    await writeFile(path.join(cwd, "src/a.ts"), "developer's edit\n");
    await appendSession({
      intent: "old", startedAt: new Date().toISOString(), startCommit: await git("rev-parse", "HEAD"),
      baseline: ["src/a.ts"],
    }, options);
    await writeFile(path.join(cwd, "src/a.ts"), "edited again\n");
    expect((await stop()).reality).toEqual([]);
  });
});

describe("baselineChanges", () => {
  it("names the paths whose blob moved, and nothing for a record without a snapshot", () => {
    const now = new Map<string, string | null>([["a", "1"], ["b", "9"], ["c", null], ["d", "4"]]);
    expect(baselineChanges({ a: "1", b: "2", c: "3", d: null }, now)).toEqual(["b", "c", "d"]);
    expect(baselineChanges(undefined, now)).toEqual([]);
    expect(baselineChanges({}, now)).toEqual([]);
  });
});
