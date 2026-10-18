import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderCardJson } from "../src/pr-card/render-card-json.js";
import { buildProgram, type ProgramOptions } from "../src/program.js";
import { cardDataWith } from "./pr-card/fixtures.js";

const execFileAsync = promisify(execFile);
const CLI = path.resolve(import.meta.dirname, "../dist/cli.js");

// `session pr --json` against a real repo: main, then a feature branch carrying one recorded session.
let root: string;
let cwd: string;
let store: ProgramOptions;

const git = async (...args: string[]) => (await execFileAsync("git", ["-C", cwd, ...args])).stdout.trim();

beforeAll(() => {
  if (!existsSync(CLI)) throw new Error(`No built CLI at ${CLI}. Run: npm run build`);
});

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-pr-json-"));
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

/** Every key anywhere in a parsed JSON value. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
}

describe("session pr --json", () => {
  it("prints the card's data for a range whose commits carry a session", async () => {
    await recordAndCommit("rate limit the orders endpoint");
    const out = JSON.parse(await run("pr", "--json", "--base", "main", "--head", "feature"));
    expect(out.schema).toBe(1);
    expect(out.record).toBe(true);
    expect(out.card.askedFor).toBe("rate limit the orders endpoint");
    expect(out.card.files).toEqual([{ path: "a.txt", inScope: true }]);
    expect(Object.keys(out.card).sort()).toEqual(["agents", "askedFor", "chain", "cost", "files", "outcome", "reverted"]);
  });

  it("prints record false and a null card when no session matches", async () => {
    await commitFile("b.txt", "b", "unrecorded work");
    const out = JSON.parse(await run("pr", "--json", "--base", "main", "--head", "feature"));
    expect(out).toEqual({ schema: 1, record: false, card: null });
  });

  it("keeps an unpriced cost's reason and gives it no usd", async () => {
    await recordAndCommit("add retries");
    const { cost } = JSON.parse(await run("pr", "--json", "--base", "main", "--head", "feature")).card;
    expect(cost.priced).toBe(false);
    expect(typeof cost.reason).toBe("string");
    expect(cost).not.toHaveProperty("usd");
  });

  it("keeps a priced cost's usd and gives it no reason", () => {
    const { cost } = JSON.parse(renderCardJson(cardDataWith({ cost: { priced: true, usd: 0.42 } }))).card;
    expect(cost).toEqual({ priced: true, usd: 0.42 });
  });

  it("carries the same data as --card", async () => {
    await recordAndCommit("add retries");
    const out = JSON.parse(await run("pr", "--json"));
    expect(await run("pr", "--card")).toContain(`| Asked for | ${out.card.askedFor} |`);
  });

  it("names an unknown ref on stderr, exits non-zero and prints nothing on stdout", async () => {
    const env = { ...process.env, SESSION_HOME: store.home as string };
    const failed = await execFileAsync("node", [CLI, "pr", "--json", "--base", "nope"], { cwd, env }).catch((e) => e);
    expect(failed.code).not.toBe(0);
    expect(failed.stderr).toContain("unknown ref: nope");
    expect(failed.stdout).toBe("");
  });

  it("refuses --card and --json together", async () => {
    await expect(run("pr", "--card", "--json")).rejects.toThrow("choose --card or --json");
  });

  it("refuses a session id with --json", async () => {
    await expect(run("pr", "abc", "--json")).rejects.toThrow("--json works on a commit range; drop the session id.");
  });

  it("carries no name, email or author anywhere", async () => {
    await recordAndCommit("add retries");
    const text = await run("pr", "--json", "--base", "main", "--head", "feature");
    expect(keysOf(JSON.parse(text)).filter((key) => /name|email|author/i.test(key))).toEqual([]);
    expect(text).not.toContain("test@example.com");
    expect(text).not.toContain('"Test"');
  });
});
