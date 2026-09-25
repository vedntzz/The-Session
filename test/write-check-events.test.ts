// Every write check with an open session here leaves a signed write-check event.
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Agreement } from "../src/agreement.js";
import { claudeCheckAdapter } from "../src/capture/adapters/claude-check.js";
import { CHECK_HOOK } from "../src/capture/hook.js";
import { CHECK_DEADLINE_MS, checkWrite } from "../src/commands/check-write.js";
import { RECORD_DEADLINE_MS } from "../src/commands/record-write-check.js";
import { verifyFailed, verifyLog } from "../src/commands/verify.js";
import { runGit } from "../src/git.js";
import { appendSession, readLog, readSessions, updateSession, type SessionPatch } from "../src/store.js";
import type { WriteCheckEvent } from "../src/write-check-event.js";

let temp: string;
let cwd: string;
let home: string;
const terms: Agreement = { paths: ["src"], actions: ["edit"], sensitivePaths: ["secret"], policy: "ask" };
beforeEach(async () => {
  temp = await realpath(await mkdtemp(path.join(tmpdir(), "session-write-check-events-")));
  cwd = path.join(temp, "repo");
  home = path.join(temp, "store");
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await runGit(cwd, ["init", "-q"]);
  await writeFile(path.join(cwd, "src/a.ts"), "unchanged");
});
afterEach(async () => { await rm(temp, { recursive: true, force: true }); });

async function* input(payload: string) { yield payload; }
const write = (file: string, tool = "Write") => JSON.stringify({ hook_event_name: "PreToolUse", tool_name: tool, cwd,
  tool_input: tool === "Edit" ? { file_path: file, old_string: "PRIVATE", new_string: "CONTENT" }
    : { file_path: file, content: "PRIVATE CONTENT" } });
const bash = (command: string) => JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", cwd,
  tool_input: { command } });
const check = (payload: string) => checkWrite({ cwd, home, stdin: input(payload) });
const accept = (agreement: Agreement | null = terms) => appendSession({
  intent: "work", startedAt: "2026-09-24T09:00:00Z", startCommit: "abc", ...(agreement ? { agreement } : {}),
}, { cwd, home });
const decision = (output: string) => JSON.parse(output).hookSpecificOutput.permissionDecision;

async function events(): Promise<WriteCheckEvent[]> {
  const log = await readLog({ cwd, home });
  return log.lines.map((line) => JSON.parse(line.text).set.writeCheck).filter((event) => event !== undefined);
}

describe("write-check events", () => {
  it("records ask, deny and silent as three signed events that verify", async () => {
    await accept();
    expect(decision(await check(write("outside")))).toBe("ask");
    expect(decision(await check(write("../escape")))).toBe("deny");
    expect(await check(write("src/a.ts", "Edit"))).toBe("");
    expect(await events()).toEqual([
      { type: "write-check", n: 1, tool: "Write", path: "outside", decision: "ask", reason: "outside-paths,action-not-accepted", agent: "claude-code" },
      { type: "write-check", n: 2, tool: "Write", path: null, decision: "deny", reason: "invalid-path", agent: "claude-code" },
      { type: "write-check", n: 3, tool: "Edit", path: "src/a.ts", decision: "silent", reason: "compliant", agent: "claude-code" },
    ]);
    const result = await verifyLog({ cwd, home });
    expect(result.check).toMatchObject({ total: 4, verified: 4, signaturesChecked: true });
    expect(result.check.break).toBeUndefined();
    expect(verifyFailed(result)).toBe(false);
  });

  it("is an event, not a field: the fold skips it and a patch cannot carry one", async () => {
    const session = await accept();
    await check(write("outside"));
    expect(Object.keys((await readSessions({ cwd, home }))[0]!)).not.toContain("writeCheck");
    const forged = { writeCheck: (await events())[0] } as unknown as SessionPatch;
    await expect(updateSession(session.id, forged, { cwd, home })).rejects.toThrow("cannot be patched");
  });

  it("takes the agent from the adapter, not a constant", async () => {
    await accept();
    await checkWrite({ cwd, home, stdin: input(write("src/a.ts")), adapter: { ...claudeCheckAdapter, name: "other-tool" } });
    expect((await events()).map((event) => event.agent)).toEqual(["other-tool"]);
  });

  it("records silence without an agreement and under record-only, as silence", async () => {
    await accept(null);
    expect(await check(bash("touch anything"))).toBe("");
    expect(await events()).toMatchObject([{ tool: "Bash", decision: "silent", reason: "no-agreement", path: null }]);
    await rm(home, { recursive: true, force: true });
    await accept({ ...terms, policy: "record" });
    expect(await check(write("outside"))).toBe("");
    expect(await events()).toMatchObject([{ tool: "Write", decision: "silent", reason: "record-only", path: null }]);
  });

  it("writes one event per path a command writes, under one number", async () => {
    await accept({ ...terms, policy: "deny" });
    expect(decision(await check(bash("mv src/a.ts src/b.ts")))).toBe("deny");
    expect(await events()).toMatchObject([
      { n: 1, path: "src/a.ts", decision: "deny", reason: "action-not-accepted" },
      { n: 1, path: "src/b.ts", decision: "deny", reason: "action-not-accepted" },
    ]);
  });

  it("writes nothing for a tool it does not check, or with no session open here", async () => {
    expect(await check(write("src/a.ts"))).toBe("");
    await accept();
    expect(await check(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Read", cwd, tool_input: {} }))).toBe("");
    expect(await events()).toEqual([]);
  });
});

describe("at the deadline", () => {
  it("still denies the host, and records not-checked with what it knew", async () => {
    await accept();
    // A parse that outlasts the deadline: the check never reaches its session.
    const slow = { ...claudeCheckAdapter, parse(payload: string) {
      const until = Date.now() + 100;
      while (Date.now() < until) { /* hold the check past its deadline */ }
      return claudeCheckAdapter.parse(payload);
    } };
    const result = await checkWrite({ cwd, home, deadlineMs: 20, adapter: slow, stdin: input(write("outside")) });
    expect(decision(result)).toBe("deny");
    expect(result).toContain("did not finish in time");
    expect(await events()).toEqual([
      { type: "write-check", n: 1, tool: "Write", path: null, decision: "not-checked", reason: "deadline", agent: "claude-code" },
    ]);
    expect(verifyFailed(await verifyLog({ cwd, home }))).toBe(false);
  });

  it("records not-checked for input that never arrived, tool unknown", async () => {
    await accept();
    async function* stalled() { yield "{"; await new Promise(() => {}); }
    expect(decision(await checkWrite({ cwd, home, deadlineMs: 50, stdin: stalled() }))).toBe("deny");
    expect(await events()).toMatchObject([{ tool: null, path: null, decision: "not-checked", reason: "deadline" }]);
  });

  it("answers and records inside the hook's registered timeout", () => {
    expect(CHECK_DEADLINE_MS + RECORD_DEADLINE_MS).toBeLessThan(CHECK_HOOK.timeout * 1000);
  });
});

describe("reasons", () => {
  it("never hold source, a path or exception text", async () => {
    await accept({ ...terms, sensitivePaths: ["src/PRIVATE"], policy: "deny" });
    await mkdir(path.join(cwd, "src/PRIVATE"));
    async function* broken() { yield "{"; throw new Error("PRIVATE EXCEPTION"); }
    await checkWrite({ cwd, home, stdin: broken() });
    for (const payload of [
      write("PRIVATE.ts"), write("src/PRIVATE/key.ts"), write("../PRIVATE"), write("src/PRIVATE"),
      bash("echo PRIVATE > PRIVATE.txt"), bash("PRIVATE_TOOL --flag"), "{PRIVATE CONTENT",
    ]) await check(payload);
    const recorded = await events();
    expect(recorded.length).toBe(8);
    for (const event of recorded) {
      expect([event.tool, event.path]).not.toContain("");
      expect(event.reason).toMatch(/^[a-z]+(-[a-z]+)*(,[a-z]+(-[a-z]+)*)*$/);
      expect(event.reason).not.toContain("PRIVATE");
      expect(event.reason).not.toContain(temp);
    }
  });
});
