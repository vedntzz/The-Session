import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildProgram, type ProgramOptions } from "../src/program.js";

const execFileAsync = promisify(execFile);
const CLI = path.resolve(import.meta.dirname, "../dist/cli.js");

// `session pr --card` against a real repo: main, then a feature branch carrying one recorded session.
let root: string;
let cwd: string;
let store: ProgramOptions;

const git = async (...args: string[]) => (await execFileAsync("git", ["-C", cwd, ...args])).stdout.trim();

beforeAll(() => {
  if (!existsSync(CLI)) throw new Error(`No built CLI at ${CLI}. Run: npm run build`);
});

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-pr-card-"));
  cwd = path.join(root, "work");
  await mkdir(cwd, { recursive: true });
  store = { home: path.join(root, "store"), cwd, adapters: [], tmp: root };
  await execFileAsync("git", ["init", "-q", "-b", "main", cwd]);
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await commitFile("a.txt", "a", "first");
  await git("switch", "-q", "-c", "feature");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function commitFile(file: string, text: string, message: string): Promise<void> {
  await writeFile(path.join(cwd, file), text, "utf8");
  await git("add", "-A");
  await git("commit", "-q", "--no-verify", "-m", message);
}

async function run(...argv: string[]): Promise<string> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await buildProgram(store).exitOverride().parseAsync(argv, { from: "user" });
    return log.mock.calls.map((call) => String(call[0])).join("\n");
  } finally {
    log.mockRestore();
  }
}

// One session that edits a.txt, then the commit that carries its end state.
async function recordAndCommit(intent: string): Promise<void> {
  await run("start", intent, "--scope", "a.txt");
  await writeFile(path.join(cwd, "a.txt"), `edited for ${intent}`, "utf8");
  await run("stop");
  await commitFile("a.txt", `edited for ${intent}`, intent);
}

describe("session pr --card", () => {
  it("prints the card for a range whose commits carry a session", async () => {
    await recordAndCommit("rate limit the orders endpoint");
    const card = await run("pr", "--card", "--base", "main", "--head", "feature");
    expect(card.startsWith("<!-- session-card -->")).toBe(true);
    expect(card).toContain("| Asked for | rate limit the orders endpoint |");
    expect(card).toContain("| Outcome |");
  });

  it("prints the no-record card when no session matches", async () => {
    await commitFile("b.txt", "b", "unrecorded work");
    const card = await run("pr", "--card", "--base", "main", "--head", "feature");
    expect(card).toContain("No session recorded for this PR.");
    expect(card).not.toContain("| Asked for |");
  });

  it("defaults to the merge base with the default branch and HEAD", async () => {
    await recordAndCommit("add retries");
    await git("switch", "-q", "main");
    await commitFile("c.txt", "c", "main moved on");
    await git("switch", "-q", "feature");
    const base = await git("merge-base", "main", "HEAD");
    const explicit = await run("pr", "--card", "--base", base, "--head", "HEAD");
    expect(await run("pr", "--card")).toBe(explicit);
    expect(explicit).toContain("| Asked for | add retries |");
  });

  it("names an unknown ref on stderr, exits non-zero and prints nothing on stdout", async () => {
    const env = { ...process.env, SESSION_HOME: store.home as string };
    const failed = await execFileAsync("node", [CLI, "pr", "--card", "--base", "nope"], { cwd, env }).catch((e) => e);
    expect(failed.code).not.toBe(0);
    expect(failed.stderr).toContain("unknown ref: nope");
    expect(failed.stdout).toBe("");
  });

  it("refuses a session id with --card", async () => {
    await expect(run("pr", "abc", "--card")).rejects.toThrow("--card works on a commit range; drop the session id.");
  });

  it("refuses a default base when head shares no commit with the default branch", async () => {
    await git("switch", "-q", "--orphan", "lone");
    await commitFile("d.txt", "d", "unrelated root");
    await expect(run("pr", "--card")).rejects.toThrow("no common ancestor with main; pass --base <ref>.");
  });

  it("still names an unknown head when the base is the default", async () => {
    await expect(run("pr", "--card", "--head", "nope")).rejects.toThrow("unknown ref: nope");
  });

  it("refuses --base and --head without --card", async () => {
    await expect(run("pr", "--base", "main")).rejects.toThrow("--base and --head need --card");
  });
});
