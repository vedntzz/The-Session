// `session agents` end to end: a real repo, sessions stopped under stub adapters, the rendered view.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildProgram, type ProgramOptions } from "../src/program.js";
import { zeroCost, type SessionCost } from "../src/store.js";

const git = promisify(execFile);
let root: string;
let store: ProgramOptions;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-agents-"));
  const cwd = path.join(root, "work");
  await mkdir(cwd, { recursive: true });
  store = { home: path.join(root, "store"), cwd, adapters: [], tmp: root };
  await git("git", ["init", "-q", cwd]);
  await git("git", ["-C", cwd, "config", "user.email", "t@example.com"]);
  await git("git", ["-C", cwd, "config", "user.name", "T"]);
  await writeFile(path.join(cwd, "a.txt"), "a", "utf8");
  await git("git", ["-C", cwd, "add", "-A"]);
  await git("git", ["-C", cwd, "commit", "-q", "--no-verify", "-m", "first"]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

async function run(...argv: string[]): Promise<string[]> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await buildProgram(store).exitOverride().parseAsync(argv, { from: "user" });
  const lines = log.mock.calls.map((call) => String(call[0]));
  log.mockRestore();
  return lines;
}

const stub = (name: string, cost: Partial<SessionCost>) =>
  ({ name, isAvailable: async () => true, capture: async () => ({ ...zeroCost(), turns: 1, ...cost }) });

/** One session, stopped with the given adapters finding something. */
async function worked(intent: string, adapters: ReturnType<typeof stub>[]): Promise<void> {
  await run("start", intent);
  await writeFile(path.join(store.cwd as string, "a.txt"), intent, "utf8");
  store = { ...store, adapters };
  await run("stop");
  store = { ...store, adapters: [] };
}

describe("session agents", () => {
  it("shows each agent's block, Codex's calls as a dash, and a mixed session under both", async () => {
    await worked("claude only", [stub("claude-code", { apiCalls: 7, model: "claude-opus-4-1", inputTokens: 1_000_000 })]);
    await worked("codex only", [stub("codex", { model: "gpt-6-astra", turnModels: ["gpt-6-astra"] })]);
    await worked("both", [stub("claude-code", { apiCalls: 2, model: "claude-opus-4-1" }), stub("codex", { model: "gpt-6-astra" })]);
    const text = (await run("agents")).join("\n");

    expect(text).toMatch(/^3 sessions over all recorded history/);
    const claude = text.slice(text.indexOf("\nclaude-code\n"), text.indexOf("\ncodex\n"));
    const codex = text.slice(text.indexOf("\ncodex\n"));
    expect(claude).toContain("declared · 2 sessions, 1 also under another agent");
    expect(claude).toContain("9 api calls"); // codex counts none, so every call in the mixed session is claude-code's
    expect(codex).toContain("declared · 2 sessions, 1 also under another agent");
    expect(codex).toContain("— api calls");
    expect(codex).not.toMatch(/\b0 api calls/);
    expect(codex).toContain("unpriced: gpt-6-astra");
    expect(text).toContain("primed · no sessions");
    expect(text).toContain("captured · no sessions");
  });

  it("counts calls for an agent that reports them, with no rate under five", async () => {
    await worked("claude only", [stub("claude-code", { apiCalls: 1_234, model: "claude-opus-4-1" })]);
    const text = (await run("agents", "--days", "1")).join("\n");
    expect(text).toMatch(/^1 session over the last 1 day/);
    expect(text).toContain("1,234 api calls");
    expect(text).toContain("0 merged · 0 marked abandoned · 1 open");
    expect(text).not.toMatch(/\d+%/);
  });

  it("refuses a --days that is not a whole number of days", async () => {
    await expect(run("agents", "--days", "0")).rejects.toThrow(/--days takes a whole number/);
  });
});
