import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchFn } from "../src/pr-card/github-comments.js";
import { buildProgram, type ProgramOptions } from "../src/program.js";

const execFileAsync = promisify(execFile);
const CLI = path.resolve(import.meta.dirname, "../dist/cli.js");

// `session pr --post` against a real repo and a fake GitHub: nothing here reaches the network.
const TOKEN = "ghs_secret0123456789";
const LIST = "https://api.github.com/repos/acme/tool/issues/7/comments?per_page=100";
const CREATE = "https://api.github.com/repos/acme/tool/issues/7/comments";
const env = { GITHUB_TOKEN: TOKEN, GITHUB_REPOSITORY: "acme/tool" };

let root: string;
let cwd: string;
let store: ProgramOptions;

const git = async (...args: string[]) => (await execFileAsync("git", ["-C", cwd, ...args])).stdout.trim();

interface Call {
  method: string;
  url: string;
  body?: string;
}

/** A comment as GitHub returns it: id, body and updated_at. */
const asGitHub = (comment: { id: number; body: string }) => ({ ...comment, updated_at: "2026-10-01T00:00:00Z" });

/** A GitHub holding `comments`, recording each call; it posts and patches like the real one. */
function fakeGitHub(comments: { id: number; body: string }[] = [], status = 200): { fetch: FetchFn; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchFn = async (url, init) => {
    const method = init.method ?? "GET";
    const body = init.body === undefined ? undefined : (JSON.parse(String(init.body)) as { body: string }).body;
    calls.push({ method, url, body });
    if (status !== 200) return new Response(JSON.stringify({ message: `Bad credentials for ${TOKEN}` }), { status });
    if (method === "GET" && url === LIST) return Response.json(comments.map(asGitHub));
    if (method === "POST" && url === CREATE) return Response.json(asGitHub({ id: 900, body: body ?? "" }), { status: 201 });
    const patched = comments.find((c) => url.endsWith(`/issues/comments/${c.id}`));
    if (method === "PATCH" && patched) return Response.json(asGitHub({ id: patched.id, body: body ?? "" }));
    throw new Error(`unexpected ${method} ${url}`);
  };
  return { fetch, calls };
}

beforeAll(() => {
  if (!existsSync(CLI)) throw new Error(`No built CLI at ${CLI}. Run: npm run build`);
});

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-pr-post-"));
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

/** Runs the command in-process; stdout and stderr as printed, and the error if it threw. */
async function run(options: Partial<ProgramOptions>, ...argv: string[]): Promise<{ out: string; err: string; error?: Error }> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const warn = vi.spyOn(console, "error").mockImplementation(() => {});
  const lines = (spy: typeof log) => spy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
  try {
    await buildProgram({ ...store, ...options }).exitOverride().parseAsync(argv, { from: "user" });
    return { out: lines(log), err: lines(warn) };
  } catch (error) {
    return { out: lines(log), err: lines(warn), error: error as Error };
  } finally {
    log.mockRestore();
    warn.mockRestore();
  }
}

async function recordAndCommit(intent: string): Promise<void> {
  await run({}, "start", intent, "--scope", "a.txt");
  await writeFile(path.join(cwd, "a.txt"), `edited for ${intent}`, "utf8");
  await run({}, "stop");
  await commitFile("a.txt", `edited for ${intent}`, intent);
}

const post = (github: { fetch: FetchFn }, ...flags: string[]) =>
  run({ env, fetch: github.fetch }, "pr", "--post", "--pr", "7", "--base", "main", "--head", "feature", ...flags);

describe("session pr --post", () => {
  it("creates the card when the PR has none and prints the comment id", async () => {
    await recordAndCommit("rate limit the orders endpoint");
    const github = fakeGitHub([{ id: 1, body: "looks good" }]);
    const result = await post(github);
    expect(result.error).toBeUndefined();
    expect(result.out).toBe("  created   comment 900");
    expect(github.calls.map((c) => c.method)).toEqual(["GET", "POST"]);
    expect(github.calls[1]?.body?.startsWith("<!-- session-card -->")).toBe(true);
  });

  it("updates a card whose body has changed", async () => {
    await recordAndCommit("add retries");
    const github = fakeGitHub([{ id: 5, body: "<!-- session-card -->\nold" }]);
    expect((await post(github)).out).toBe("  updated   comment 5");
    expect(github.calls.map((c) => c.method)).toEqual(["GET", "PATCH"]);
  });

  it("leaves an identical card alone", async () => {
    await recordAndCommit("add retries");
    const first = fakeGitHub();
    await post(first);
    const github = fakeGitHub([{ id: 5, body: first.calls[1]?.body as string }]);
    expect((await post(github)).out).toBe("  unchanged comment 5");
    expect(github.calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("posts the no-record card when no session matches", async () => {
    await commitFile("b.txt", "b", "unrecorded work");
    const github = fakeGitHub();
    await post(github);
    expect(github.calls[1]?.body).toContain("No session recorded for this PR.");
  });

  it("leaves the intent off the card without --show-intent", async () => {
    await recordAndCommit("rate limit the orders endpoint");
    const github = fakeGitHub();
    await post(github);
    expect(github.calls[1]?.body).not.toContain("rate limit the orders endpoint");
    expect(github.calls[1]?.body).toContain("| Asked for | recorded, not shown (post with --show-intent to include it) |");
  });

  it("puts the intent on the card with --show-intent", async () => {
    await recordAndCommit("rate limit the orders endpoint");
    const github = fakeGitHub();
    await post(github, "--show-intent");
    expect(github.calls[1]?.body).toContain("| Asked for | rate limit the orders endpoint |");
  });

  it.each([
    ["GITHUB_TOKEN", { GITHUB_REPOSITORY: "acme/tool" }, ["--pr", "7"]],
    ["GITHUB_REPOSITORY", { GITHUB_TOKEN: TOKEN }, ["--pr", "7"]],
    ["--pr <number>", env, []],
  ] as const)("names a missing %s before any request", async (name, given, pr) => {
    const github = fakeGitHub();
    const result = await run({ env: given, fetch: github.fetch }, "pr", "--post", ...pr);
    expect(result.error?.message).toBe(`Cannot post the card: ${name} not given. Set GITHUB_TOKEN and GITHUB_REPOSITORY and run session pr --post --pr <number>.`);
    expect(github.calls).toEqual([]);
  });

  it("keeps the token out of stdout, stderr and the error when GitHub refuses it", async () => {
    await recordAndCommit("add retries");
    const result = await post(fakeGitHub([], 401));
    expect(result.error?.message).toContain("GitHub answered 401");
    for (const text of [result.out, result.err, result.error?.message ?? ""]) expect(text).not.toContain(TOKEN);
  });

  it("keeps the token out of the built CLI's stdout and stderr", async () => {
    const failed = await execFileAsync("node", [CLI, "pr", "--post", "--pr", "7"], {
      cwd,
      env: { ...process.env, SESSION_HOME: store.home as string, GITHUB_TOKEN: TOKEN, GITHUB_REPOSITORY: "" },
    }).catch((e) => e);
    expect(failed.code).not.toBe(0);
    expect(failed.stderr).toContain("GITHUB_REPOSITORY not given");
    expect(`${failed.stdout}${failed.stderr}`).not.toContain(TOKEN);
  });

  it("refuses what --post does not take, before any request", async () => {
    const github = fakeGitHub();
    const result = await run({ env, fetch: github.fetch }, "pr", "abc", "--post", "--pr", "7", "--card");
    expect(result.error?.message).toBe("--post posts the card for a commit range; drop a session id, --card.");
    expect(github.calls).toEqual([]);
  });

  it("refuses --pr and --show-intent without --post", async () => {
    expect((await run({}, "pr", "--card", "--show-intent")).error?.message).toContain("--pr and --show-intent need --post");
    expect((await run({}, "pr", "--pr", "7")).error?.message).toContain("--pr and --show-intent need --post");
  });
});
