// SES-2, SES-14: hooks that name their agent session.
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHookPayload } from "../src/capture/adapters/hook-payload.js";
import { createClaudeCodeAdapter } from "../src/capture/adapters/claude-code.js";
import { runGit } from "../src/git.js";
import { buildProgram } from "../src/program.js";
import { readSessions, updateSession, type Session, type SessionPatch } from "../src/store.js";

let root: string;
let cwd: string;
let home: string;
let projects: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "session-sweep-agents-")));
  cwd = path.join(root, "repo");
  home = path.join(root, "store");
  projects = path.join(root, "projects");
  await mkdir(cwd);
  await runGit(cwd, ["init", "-q"]);
  await runGit(cwd, ["-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "--allow-empty", "-m", "init"]);
});
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

async function* lines(text: string) { yield text; }
const payload = (event: string, id: string, why: Record<string, string> = {}) =>
  JSON.stringify({ hook_event_name: event, session_id: id, transcript_path: "/private/t.jsonl", cwd, ...why });

/** Runs the CLI as a hook does, with `input` on stdin. */
async function hook(input: string, ...argv: string[]): Promise<void> {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const adapters = [createClaudeCodeAdapter({ root: projects })];
  await buildProgram({ cwd, home, stdin: lines(input), adapters }).exitOverride().parseAsync(argv, { from: "user" });
}
const sessions = () => readSessions({ cwd, home });
const begin = (id: string, source = "startup") => hook(payload("SessionStart", id, { source }), "start", "--passive", "--agent", "claude-code");
const end = (id: string, reason = "prompt_input_exit") => hook(payload("SessionEnd", id, { reason }), "stop", "--if-open");

describe("SES-14: the start hook may name its tool", () => {
  it("accepts the --agent an installer writes, which start used to refuse as an unknown option", async () => {
    await hook("", "start", "--passive", "--agent", "codex");
    expect((await sessions())[0]).toMatchObject({ intentSource: "captured", endedAt: null });
  });
});

describe("SES-2: the agent session is on the record", () => {
  it("opens a passive session naming the agent session and tool that opened it", async () => {
    await begin("A");
    expect((await sessions())[0]).toMatchObject({ intentSource: "captured", openedBy: { id: "A", agent: "claude-code" } });
  });

  it("reads only the bound agents' transcripts at stop", async () => {
    await begin("A");
    const at = new Date(Date.now() + 1000).toISOString();
    const call = (id: string, input: number) => JSON.stringify({ type: "assistant", requestId: `r-${id}`, timestamp: at, cwd,
      message: { model: "claude-opus-5", usage: { input_tokens: input, output_tokens: 1 } } });
    await mkdir(path.join(projects, "-repo"), { recursive: true });
    await writeFile(path.join(projects, "-repo", "A.jsonl"), `${call("A", 10)}\n`);
    await writeFile(path.join(projects, "-repo", "B.jsonl"), `${call("B", 99)}\n`);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await end("A");
    expect((await sessions())[0]?.cost).toMatchObject({ inputTokens: 10, capturedBy: "agent-session" });
  });

  it("refuses to patch who opened a session", async () => {
    await begin("A");
    const [session] = await sessions();
    await expect(updateSession(session!.id, { openedBy: { id: "Z" } } as unknown as SessionPatch, { cwd, home }))
      .rejects.toThrow("Agent sessions");
  });

  it("reads only an id, a start source and an end reason out of a payload", () => {
    expect(parseHookPayload(payload("SessionEnd", "A", { reason: "clear" }))).toEqual({ sessionId: "A", reason: "clear" });
    expect(parseHookPayload(JSON.stringify({ hook_event_name: "SessionStart", session_id: "../etc" }))).toEqual({});
    expect(parseHookPayload("not json")).toBeUndefined();
    expect(parseHookPayload(JSON.stringify({ session_id: "A" }))).toBeUndefined();
  });

  it("ignores an --agent value that is not a plain name", async () => {
    await hook(payload("SessionStart", "A"), "start", "--passive", "--agent", "Claude Code!");
    const session: Session | undefined = (await sessions())[0];
    expect(session?.openedBy).toEqual({ id: "A" });
  });
});

describe("SES-2c: week <id> --full says how the cost was captured", () => {
  it("names the binding on a record that has one, and adds no row to one that does not", async () => {
    const { formatSession } = await import("../src/render/terminal.js");
    const { plainPalette } = await import("../src/render/palette.js");
    const base = { id: "abcdef0123", repo: "r", intent: "work", scope: [], baseline: [], reality: [], drift: [],
      outcome: "open" as const, startedAt: "2026-10-03T09:00:00Z", endedAt: "2026-10-03T10:00:00Z", startCommit: "abc" };
    const cost = { inputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 1, turns: 1, apiCalls: 1, model: "m" };
    const render = (capturedBy?: "agent-session" | "window") =>
      formatSession({ ...base, cost: { ...cost, ...(capturedBy ? { capturedBy } : {}) } }, plainPalette, {}).join("\n");
    expect(render("agent-session")).toContain("captured    its own agent sessions' transcripts");
    expect(render("window")).toContain("captured    every transcript in its time window and repo");
    expect(render()).not.toContain("captured    ");
  });
});
