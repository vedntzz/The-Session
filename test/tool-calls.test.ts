import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startSession } from "../src/commands/start.js";
import { verifyLog } from "../src/commands/verify.js";
import { treeStateAfter, treeStateSince } from "../src/git.js";
import {
  foldLog, readLog, readSessions, recordCallEnd, recordCallStart, resolveStoreFile, updateSession, type SessionPatch,
} from "../src/store.js";
import { callLine, NO_CHANGE } from "../src/render/terminal/tool-calls.js";
import { countCalls, endFor, filesChanged, foldToolCall, nextCallNumber, startFor, unchangedShare, type ToolCall } from "../src/tool-calls.js";

/** Folds a scripted sequence of events, as the reader would. */
function fold(events: ({ start: [string, string, Record<string, string | null>] } | { end: [string, Record<string, string | null>] })[]): ToolCall[] {
  let calls: ToolCall[] = [];
  events.forEach((event, index) => {
    if ("start" in event) {
      const [callId, tool, before] = event.start;
      calls = foldToolCall(calls, index + 1, { toolCallStart: startFor(calls, callId, tool, before)! });
    } else {
      const [callId, after] = event.end;
      calls = foldToolCall(calls, index + 1, { toolCallEnd: endFor(calls, callId, "", after)! });
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
    expect(startFor(calls, "a", "Edit", {})).toBeUndefined();
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
    const end = endFor([], "lost", "Bash", { "src/x": "1" });
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
    await git("add", "-A");
    await git("commit", "-q", "--no-verify", "-m", "init");
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  /** One call, as the hooks will run it: look, act, look, record. */
  async function call(sessionId: string, start: string, callId: string, tool: string, act: () => Promise<unknown>) {
    const before = await treeStateSince(start, cwd);
    await recordCallStart(sessionId, callId, tool, before, options);
    await act();
    return recordCallEnd(sessionId, callId, tool, await treeStateAfter(before, start, cwd), options);
  }

  it("records every call in order: a change, a no-op, and a revert to HEAD", async () => {
    const session = await startSession("work", options);
    const s = session.startCommit;
    const one = await call(session.id, s, "t1", "Edit", () => writeFile(path.join(cwd, "src/a"), "edited\n"));
    const two = await call(session.id, s, "t2", "Bash", async () => {});
    const three = await call(session.id, s, "t3", "Bash", () => git("checkout", "--", "src/a"));

    expect(one).toMatchObject({ n: 1, changed: true, files: [{ path: "src/a", blob: expect.any(String) }] });
    expect(two).toMatchObject({ n: 2, changed: false, files: [] });
    expect(three).toMatchObject({ n: 3, changed: true, files: [{ path: "src/a", blob: await git("hash-object", "src/a") }] });
    const folded = (await readSessions(options))[0]!.toolCalls!;
    expect(folded.map((c) => [c.n, c.tool, c.end?.changed])).toEqual([[1, "Edit", true], [2, "Bash", false], [3, "Bash", true]]);
  });

  it("gives calls started together different numbers, under the lock", async () => {
    const session = await startSession("work", options);
    const starts = await Promise.all(["x", "y", "z"].map((id) => recordCallStart(session.id, id, "Bash", {}, options)));
    expect(starts.map((start) => start!.n).sort()).toEqual([1, 2, 3]);
  });

  it("marks interleaved calls overlapping on disk, both of them", async () => {
    const session = await startSession("work", options);
    await recordCallStart(session.id, "a", "Bash", {}, options);
    await recordCallStart(session.id, "b", "Edit", {}, options);
    await writeFile(path.join(cwd, "src/a"), "one of them\n");
    const after = await treeStateSince(session.startCommit, cwd);
    expect(await recordCallEnd(session.id, "a", "Bash", after, options)).toMatchObject({ overlapping: true, changed: null, files: [] });
    expect(await recordCallEnd(session.id, "b", "Edit", after, options)).toMatchObject({ overlapping: true, changed: null, files: [] });
  });

  it("keeps hashes and paths only, signs every record, and verifies", async () => {
    const session = await startSession("work", options);
    await call(session.id, session.startCommit, "t1", "Edit", () => writeFile(path.join(cwd, "src/a"), "PRIVATE CONTENT\n"));
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

  it("refuses a call for a session that is not in the log", async () => {
    await startSession("work", options);
    await expect(recordCallStart("no-such-session", "t1", "Bash", {}, options)).rejects.toThrow(/No session with id/);
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
