import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startSession } from "../src/commands/start.js";
import { verifyLog } from "../src/commands/verify.js";
import { stopSession } from "../src/commands/stop.js";
import { sweep } from "../src/commands/sweep.js";
import { afterToolCall, beforeToolCall } from "../src/commands/tool-call.js";
import {
  findCallScratch, foldLog, pruneScratch, readLog, readSessionCache, readSessions, resolveStoreFile, updateSession, type SessionPatch,
} from "../src/store.js";
import { callLine, NO_CHANGE } from "../src/render/terminal/tool-calls.js";
import { countCalls, endFor, filesChanged, foldToolCall, nextCallNumber, startFor, unchangedShare, type ToolCall } from "../src/tool-calls.js";

/** Folds a scripted sequence of events, as the reader would. */
function fold(events: ({ start: [string, string, Record<string, string | null>] } | { end: [string, Record<string, string | null>] })[]): ToolCall[] {
  let calls: ToolCall[] = [];
  const befores = new Map<string, Record<string, string | null>>(); // the scratch files, in memory
  events.forEach((event, index) => {
    if ("start" in event) {
      const [callId, tool, before] = event.start;
      befores.set(callId, before);
      calls = foldToolCall(calls, index + 1, { toolCallStart: startFor(calls, callId, tool)! });
    } else {
      const [callId, after] = event.end;
      calls = foldToolCall(calls, index + 1, { toolCallEnd: endFor(calls, callId, "", befores.get(callId), after)! });
    }
  });
  return calls;
}
const endOf = (calls: ToolCall[], callId: string) => calls.find((call) => call.callId === callId)!.end!;

describe("tool calls, pure", () => {
  it("numbers from this session's own counter, and refuses a call id twice", () => {
    expect(nextCallNumber([])).toBe(1);
    const calls = fold([{ start: ["a", "Edit", {}] }, { start: ["b", "Bash", {}] }]);
    expect(calls.map((call) => call.n)).toEqual([1, 2]);
    expect(startFor(calls, "a", "Edit")).toBeUndefined();
  });

  it("records a call that changed nothing, as a call that changed nothing", () => {
    const calls = fold([{ start: ["a", "Bash", { "src/x": "1" }] }, { end: ["a", { "src/x": "1" }] }]);
    expect(endOf(calls, "a")).toMatchObject({ n: 1, tool: "Bash", files: [], changed: false, overlapping: false });
  });

  it("names each path a call changed with its blob after, including one put back", () => {
    const calls = fold([
      { start: ["a", "Edit", { "src/x": "old", "src/gone": "g" }] },
      { end: ["a", { "src/x": "new", "src/gone": null, "src/back": "head", "src/new": "n" }] },
    ]);
    expect(endOf(calls, "a")).toMatchObject({ changed: true, files: [
      { path: "src/back", blob: "head" }, { path: "src/gone", blob: null },
      { path: "src/new", blob: "n" }, { path: "src/x", blob: "new" },
    ] });
  });

  it("marks both of two overlapping calls, and attributes files to neither", () => {
    const calls = fold([
      { start: ["a", "Bash", {}] }, { start: ["b", "Edit", {}] },
      { end: ["a", { "src/x": "1" }] }, { end: ["b", { "src/x": "1", "src/y": "2" }] },
    ]);
    for (const id of ["a", "b"]) {
      expect(endOf(calls, id)).toMatchObject({ overlapping: true, files: [], changed: null });
    }
  });

  it("marks a call nested inside another, and the one around it", () => {
    const calls = fold([
      { start: ["outer", "Task", {}] }, { start: ["inner", "Edit", {}] },
      { end: ["inner", {}] }, { end: ["outer", {}] },
    ]);
    expect(endOf(calls, "inner").overlapping).toBe(true);
    expect(endOf(calls, "outer").overlapping).toBe(true);
  });

  it("does not mark calls that ran one after the other", () => {
    const calls = fold([
      { start: ["a", "Edit", {}] }, { end: ["a", { "src/x": "1" }] },
      { start: ["b", "Edit", { "src/x": "1" }] }, { end: ["b", { "src/x": "2" }] },
    ]);
    expect(endOf(calls, "a")).toMatchObject({ overlapping: false, files: [{ path: "src/x", blob: "1" }] });
    expect(endOf(calls, "b")).toMatchObject({ overlapping: false, files: [{ path: "src/x", blob: "2" }] });
  });

  it("says it cannot tell for an end with no start, never guessing its files", () => {
    const end = endFor([], "lost", "Bash", undefined, { "src/x": "1" });
    expect(end).toEqual({ callId: "lost", n: 1, tool: "Bash", files: [], changed: null, overlapping: false, unpaired: true });
  });

  it("refuses an after-look missing a path the before named, rather than calling it deleted", () => {
    expect(() => filesChanged({ "src/x": "1" }, {})).toThrow(/treeStateAfter/);
  });
});

describe("tool calls, recorded", () => {
  const execFileAsync = promisify(execFile);
  let root: string;
  let cwd: string;
  let options: { home: string; cwd: string };
  const git = async (...args: string[]) => (await execFileAsync("git", ["-C", cwd, ...args])).stdout.trim();

  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), "session-calls-")));
    cwd = path.join(root, "work");
    await mkdir(path.join(cwd, "src"), { recursive: true });
    options = { home: path.join(root, "store"), cwd };
    await git("init", "-q");
    await git("config", "user.email", "test@example.com");
    await git("config", "user.name", "Test");
    await writeFile(path.join(cwd, "src/a"), "committed\n");
    for (let i = 0; i < 3; i++) await writeFile(path.join(cwd, `src/dirty${i}`), "committed\n");
    await git("add", "-A");
    await git("commit", "-q", "--no-verify", "-m", "init");
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  /** One call, as the hooks will run it. */
  async function call(callId: string, tool: string, act: () => Promise<unknown>) {
    await beforeToolCall({ callId, tool }, options);
    await act();
    return afterToolCall({ callId, tool }, options);
  }
  const signedLines = async () => (await readFile(await resolveStoreFile(options), "utf8")).trim().split("\n").map((line) => JSON.parse(line));

  it("records every call in order: a change, a no-op, and a revert to HEAD", async () => {
    await startSession("work", options);
    const one = await call("t1", "Edit", () => writeFile(path.join(cwd, "src/a"), "edited\n"));
    const two = await call("t2", "Bash", async () => {});
    const three = await call("t3", "Bash", () => git("checkout", "--", "src/a"));

    expect(one).toMatchObject({ n: 1, changed: true, files: [{ path: "src/a", blob: expect.any(String) }] });
    expect(two).toMatchObject({ n: 2, changed: false, files: [] });
    expect(three).toMatchObject({ n: 3, changed: true, files: [{ path: "src/a", blob: await git("hash-object", "src/a") }] });
    const folded = (await readSessions(options))[0]!.toolCalls!;
    expect(folded.map((c) => [c.n, c.tool, c.end?.changed])).toEqual([[1, "Edit", true], [2, "Bash", false], [3, "Bash", true]]);
  });

  it("keeps no tree state in the signed log: the start record is only {callId, n, tool}", async () => {
    // Dirty files at start give the before state something to hold.
    for (let i = 0; i < 3; i++) await writeFile(path.join(cwd, `src/dirty${i}`), `dirty ${i}\n`);
    await startSession("work", options);
    const blobs = await Promise.all([0, 1, 2].map((i) => git("hash-object", `src/dirty${i}`)));
    await beforeToolCall({ callId: "t1", tool: "Bash" }, options);
    const lines = await signedLines();
    const start = lines.find((line) => line.set.toolCallStart)!;
    expect(start.set).toEqual({ toolCallStart: { callId: "t1", n: 1, tool: "Bash" } });
    await afterToolCall({ callId: "t1", tool: "Bash" }, options);
    const toolLines = (await signedLines()).filter((line) => line.set.toolCallStart || line.set.toolCallEnd);
    const text = JSON.stringify(toolLines);
    for (const blob of blobs) expect(text).not.toContain(blob);
    expect(text).not.toContain("before");
  });

  it("keeps the before state in an unsigned per-call file, and the log path in one per-session file", async () => {
    const session = await startSession("work", options);
    await beforeToolCall({ callId: "t1", tool: "Edit" }, options);
    const dir = path.join(options.home, "tmp", encodeURIComponent(session.id));
    const scratch = (await findCallScratch("t1", options))!;
    expect(Object.keys(scratch).sort()).toEqual(["before", "callId", "sessionId"]);
    expect(await readSessionCache(session.id, options)).toEqual({
      sessionId: session.id, checkout: await realpath(cwd), storeFile: await resolveStoreFile(options), startCommit: session.startCommit,
    });
    for (const name of ["call-t1.json", "session.json"]) expect((await stat(path.join(dir, name))).mode & 0o777).toBe(0o600);
    await afterToolCall({ callId: "t1", tool: "Edit" }, options);
    expect(await findCallScratch("t1", options)).toBeUndefined();
    expect(await readSessionCache(session.id, options)).toBeDefined();
  });

  it("writes the session cache once per session, not once per call", async () => {
    const session = await startSession("work", options);
    await call("t1", "Bash", async () => {});
    const file = path.join(options.home, "tmp", encodeURIComponent(session.id), "session.json");
    const first = (await stat(file)).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 20));
    await call("t2", "Bash", async () => {});
    await call("t3", "Bash", async () => {});
    expect((await stat(file)).mtimeMs).toBe(first);
  });

  it("drops a stale cache and records against the session that is open now", async () => {
    const old = await startSession("first", options);
    await call("t1", "Bash", async () => {});
    await stopSession({ ...options, adapters: [] });
    const current = await startSession("second", options);
    expect(await beforeToolCall({ callId: "t2", tool: "Bash" }, options)).toMatchObject({ n: 1 });
    const sessions = await readSessions(options);
    expect(sessions.find((s) => s.id === current.id)!.toolCalls!.map((c) => c.callId)).toEqual(["t2"]);
    expect(await readSessionCache(old.id, options)).toBeUndefined();
  });

  it("takes two concurrent before-hooks' snapshots at the same time, not one after the other", async () => {
    await startSession("work", options);
    await beforeToolCall({ callId: "warm", tool: "Bash" }, options); // the cache exists: both take the fast path
    let inside = 0;
    let release!: () => void;
    const bothInside = new Promise<void>((resolve) => { release = resolve; });
    // Each snapshot waits until both are inside. Under a lock, the second could
    // not start until the first finished, and this would time out.
    const snapshot = async () => {
      if (++inside === 2) release();
      await Promise.race([bothInside, new Promise((_, reject) => setTimeout(() => reject(new Error("snapshots did not overlap")), 3000))]);
      return {};
    };
    const [a, b] = await Promise.all([
      beforeToolCall({ callId: "p1", tool: "Bash" }, options, { snapshot }),
      beforeToolCall({ callId: "p2", tool: "Bash" }, options, { snapshot }),
    ]);
    expect(inside).toBe(2);
    expect([a!.n, b!.n].sort()).toEqual([2, 3]);
  });

  it("the sweep removes scratch untouched for a day, and keeps fresh scratch", async () => {
    const session = await startSession("work", options);
    await beforeToolCall({ callId: "stale", tool: "Bash" }, options);
    await beforeToolCall({ callId: "fresh", tool: "Bash" }, options);
    const dir = path.join(options.home, "tmp", encodeURIComponent(session.id));
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await utimes(path.join(dir, "call-stale.json"), old, old);
    expect(await pruneScratch(options)).toBe(1);
    expect(await findCallScratch("stale", options)).toBeUndefined();
    expect(await findCallScratch("fresh", options)).toBeDefined();
    // Everything a day old, and the directory with it; run through the sweep itself.
    for (const name of ["call-fresh.json", "session.json"]) await utimes(path.join(dir, name), old, old);
    await sweep(options, Date.now());
    await expect(stat(dir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("records an end with no scratch as unpaired, never guessing its files", async () => {
    await startSession("work", options);
    await beforeToolCall({ callId: "t1", tool: "Edit" }, options);
    const scratch = (await findCallScratch("t1", options))!;
    await rm(path.join(options.home, "tmp", encodeURIComponent(scratch.sessionId)), { recursive: true });
    await writeFile(path.join(cwd, "src/a"), "edited\n");
    expect(await afterToolCall({ callId: "t1", tool: "Edit" }, options)).toMatchObject({ n: 1, unpaired: true, changed: null, files: [] });
  });

  it("the after hook uses the log path the before hook cached, not a fresh identity lookup", async () => {
    await startSession("work", options);
    const logBefore = await resolveStoreFile(options);
    await beforeToolCall({ callId: "t1", tool: "Edit" }, options);
    // Gaining an origin changes the repo's identity, and so the log a fresh
    // lookup would resolve to. The end must still land beside its start.
    await git("remote", "add", "origin", "https://example.invalid/other.git");
    expect(await resolveStoreFile(options)).not.toBe(logBefore);
    await writeFile(path.join(cwd, "src/a"), "edited\n");
    expect(await afterToolCall({ callId: "t1", tool: "Edit" }, options)).toMatchObject({ n: 1, changed: true });
    const lines = (await readFile(logBefore, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(lines.filter((line) => line.set.toolCallEnd)).toHaveLength(1);
  });

  it("gives calls started together different numbers, under the lock", async () => {
    await startSession("work", options);
    const starts = await Promise.all(["x", "y", "z"].map((callId) => beforeToolCall({ callId, tool: "Bash" }, options)));
    expect(starts.map((start) => start!.n).sort()).toEqual([1, 2, 3]);
  });

  it("marks interleaved calls overlapping on disk, both of them", async () => {
    await startSession("work", options);
    await beforeToolCall({ callId: "a", tool: "Bash" }, options);
    await beforeToolCall({ callId: "b", tool: "Edit" }, options);
    await writeFile(path.join(cwd, "src/a"), "one of them\n");
    expect(await afterToolCall({ callId: "a", tool: "Bash" }, options)).toMatchObject({ overlapping: true, changed: null, files: [] });
    expect(await afterToolCall({ callId: "b", tool: "Edit" }, options)).toMatchObject({ overlapping: true, changed: null, files: [] });
  });

  it("keeps hashes and paths only, signs every record, and verifies", async () => {
    await startSession("work", options);
    await call("t1", "Edit", () => writeFile(path.join(cwd, "src/a"), "PRIVATE CONTENT\n"));
    const text = await readFile(await resolveStoreFile(options), "utf8");
    expect(text).not.toContain("PRIVATE CONTENT");
    expect((await verifyLog(options)).check).toMatchObject({ verified: 3, signaturesChecked: true });
  });

  it("cannot be patched, and a forged toolCalls field is ignored", async () => {
    const session = await startSession("work", options);
    for (const patch of [{ toolCalls: [] }, { toolCallStart: {} }, { toolCallEnd: {} }]) {
      await expect(updateSession(session.id, patch as unknown as SessionPatch, options)).rejects.toThrow(/cannot be patched/);
    }
    const log = await readLog(options);
    log.lines.push({ no: log.lines.length + 1, text: JSON.stringify({ id: session.id, set: { toolCalls: [{ n: 99 }] } }) });
    expect(foldLog(log)[0]!.toolCalls).toBeUndefined();
  });

  it("records nothing when no session is open", async () => {
    expect(await beforeToolCall({ callId: "t1", tool: "Bash" }, options)).toBeUndefined();
    expect(await findCallScratch("t1", options)).toBeUndefined();
  });
});

describe("changed: null — unattributed, counted, in no denominator", () => {
  const ended = (n: number, changed: boolean | null, extra: object = {}): ToolCall => ({
    callId: `c${n}`, n, tool: "Bash", startSeq: n,
    end: { callId: `c${n}`, n, tool: "Bash", files: changed ? [{ path: "src/a", blob: "1" }] : [], changed, overlapping: changed === null, ...extra },
  });
  const calls: ToolCall[] = [
    ended(1, true), ended(2, false), ended(3, null), ended(4, null, { overlapping: false, unpaired: true }),
    { callId: "c5", n: 5, tool: "Edit", startSeq: 9 },
  ];

  it("never renders null as no change: it reads unattributed, with why", () => {
    expect(callLine(calls[2]!)).toBe("call 3  Bash  unattributed — ran while another call was running");
    expect(callLine(calls[3]!)).toBe("call 4  Bash  unattributed — no start was recorded");
    for (const call of calls.slice(2, 4)) expect(callLine(call)).not.toContain(NO_CHANGE);
    expect(callLine(calls[1]!)).toBe("call 2  Bash  no change");
    expect(callLine(calls[0]!)).toBe("call 1  Bash  changed during tool call 1: src/a");
    expect(callLine(calls[4]!)).toBe("call 5  Edit  still running");
  });

  it("counts null in the total call count, and apart from changed and unchanged", () => {
    expect(countCalls(calls)).toEqual({ total: 5, changed: 1, unchanged: 1, unattributed: 2, running: 1 });
  });

  it("keeps null out of every denominator", () => {
    expect(unchangedShare(countCalls(calls))).toBe(0.5);
    // Adding unattributed calls moves no rate.
    expect(unchangedShare(countCalls([...calls, ended(6, null), ended(7, null)]))).toBe(0.5);
  });

  it("has no share at all, not 0, when no call could say", () => {
    expect(unchangedShare(countCalls([ended(1, null), { callId: "r", n: 2, tool: "Bash" }]))).toBeUndefined();
    expect(unchangedShare(countCalls([]))).toBeUndefined();
  });
});
