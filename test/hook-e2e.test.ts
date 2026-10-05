// The editors' session hooks end to end: the built CLI, run by the command line
// an install registers, under /bin/sh as an editor runs it, with a hook's JSON
// on stdin. What is asserted is the record on disk, not anything printed.
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { commandLine, OPEN_HOOK, STOP_HOOK, type HookSpec } from "../src/capture/hook.js";
import { readSessions, type Session } from "../src/store.js";

const CLI = path.resolve(import.meta.dirname, "../dist/cli.js");
const LAUNCHER = { node: process.execPath, cli: CLI };
const CLAUDE_ID = "3f1c2a9e-5b7d-4e1f-9a2b-6c8d0e4f1a3b";
const CODEX_ID = "0199a8f2-7c41-7d30-b6e5-2f9a1c3d4e5b";

let repo: string;
let home: string;

interface Ran { code: number | null; ms: number; stdout: string }

/** Runs a registered hook's command line with `stdin` as its payload; null sends nothing and closes. */
function runHook(hook: HookSpec, stdin: string | null, agent?: string): Promise<Ran> {
  const started = performance.now();
  const child = spawn("/bin/sh", ["-c", commandLine(hook, LAUNCHER, agent)], {
    cwd: repo, env: { ...process.env, SESSION_HOME: home }, stdio: ["pipe", "pipe", "inherit"],
  });
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
  child.stdin.end(stdin ?? "");
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, ms: performance.now() - started, stdout }));
  });
}

const claudeStart = JSON.stringify({ session_id: CLAUDE_ID, transcript_path: "/nowhere/t.jsonl", cwd: "/elsewhere",
  hook_event_name: "SessionStart", source: "startup" });
const claudeEnd = JSON.stringify({ session_id: CLAUDE_ID, transcript_path: "/nowhere/t.jsonl", cwd: "/elsewhere",
  hook_event_name: "SessionEnd", reason: "logout" });
const codexStart = JSON.stringify({ session_id: CODEX_ID, transcript_path: null, cwd: "/elsewhere",
  hook_event_name: "SessionStart", model: "gpt-5-codex", source: "startup" });

const sessions = (): Promise<Session[]> => readSessions({ home, cwd: repo });

beforeAll(() => {
  if (!existsSync(CLI)) throw new Error(`No built CLI at ${CLI}. Run: npm run build`);
});

beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "session-hook-e2e-"));
  home = await mkdtemp(path.join(tmpdir(), "session-hook-e2e-home-"));
  const git = (...args: string[]) => promisify(execFile)("git", args, { cwd: repo });
  await git("init", "-q");
  await writeFile(path.join(repo, "a.ts"), "base\n");
  await git("add", ".");
  await git("commit", "-qm", "base");
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

describe("Claude Code's session hooks, through the built CLI", () => {
  it("SessionStart opens a captured session naming the agent session, and prints nothing", async () => {
    const ran = await runHook(OPEN_HOOK, claudeStart, "claude-code");

    expect(ran).toMatchObject({ code: 0, stdout: "" });
    const [session, ...rest] = await sessions();
    expect(rest).toEqual([]);
    expect(session).toMatchObject({ intent: null, intentSource: "captured", endedAt: null,
      openedBy: { id: CLAUDE_ID, agent: "claude-code" } });
  });

  it("SessionEnd for that agent session closes it and records the end", async () => {
    await runHook(OPEN_HOOK, claudeStart, "claude-code");
    await writeFile(path.join(repo, "a.ts"), "changed\n");

    const ran = await runHook(STOP_HOOK, claudeEnd);

    expect(ran.code).toBe(0);
    const [session] = await sessions();
    expect(session?.endedAt).not.toBeNull();
    expect(session?.reality).toEqual(["a.ts"]);
    expect(session?.agentEvents).toContainEqual(expect.objectContaining({ id: CLAUDE_ID, type: "agent-end" }));
  });

  it("SessionEnd for an agent session that did not open it leaves the session open", async () => {
    await runHook(OPEN_HOOK, claudeStart, "claude-code");

    await runHook(STOP_HOOK, claudeEnd.replace(CLAUDE_ID, "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b"));

    expect((await sessions())[0]?.endedAt).toBeNull();
  });
});

describe("Codex's start hook, through the built CLI", () => {
  it("opens a captured session naming the Codex session", async () => {
    const ran = await runHook(OPEN_HOOK, codexStart, "codex");

    expect(ran).toMatchObject({ code: 0, stdout: "" });
    const [session] = await sessions();
    expect(session).toMatchObject({ intent: null, intentSource: "captured", endedAt: null,
      openedBy: { id: CODEX_ID, agent: "codex" } });
  });
});

describe("a hook with nothing on stdin, through the built CLI", () => {
  it("start falls back to a session nobody named, inside a second", async () => {
    const ran = await runHook(OPEN_HOOK, null, "claude-code");

    expect(ran.code).toBe(0);
    expect(ran.ms).toBeLessThan(1000);
    const [session] = await sessions();
    expect(session).toMatchObject({ intentSource: "captured", endedAt: null });
    expect(session?.openedBy).toBeUndefined();
  });

  // No clock here: a stop shells out to git and sweeps, which takes as long
  // with a payload as without one, so a budget would time the machine.
  it("stop falls back to the plain --if-open, closes the session and exits", async () => {
    await runHook(OPEN_HOOK, claudeStart, "claude-code");

    const ran = await runHook(STOP_HOOK, null);

    expect(ran.code).toBe(0);
    expect((await sessions())[0]?.endedAt).not.toBeNull();
  });
});
