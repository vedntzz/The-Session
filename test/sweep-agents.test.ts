// SES-14: the start hook may name its tool.
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClaudeCodeAdapter } from "../src/capture/adapters/claude-code.js";
import { runGit } from "../src/git.js";
import { buildProgram } from "../src/program.js";
import { readSessions } from "../src/store.js";

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

/** Runs the CLI as a hook does, with `input` on stdin. */
async function hook(input: string, ...argv: string[]): Promise<void> {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const adapters = [createClaudeCodeAdapter({ root: projects })];
  await buildProgram({ cwd, home, stdin: lines(input), adapters }).exitOverride().parseAsync(argv, { from: "user" });
}
const sessions = () => readSessions({ cwd, home });
describe("SES-14: the start hook may name its tool", () => {
  it("accepts the --agent an installer writes, which start used to refuse as an unknown option", async () => {
    await hook("", "start", "--passive", "--agent", "codex");
    expect((await sessions())[0]).toMatchObject({ intentSource: "captured", endedAt: null });
  });
});
