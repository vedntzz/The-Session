import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatStarted, startSession } from "../src/commands/start.js";
import { getOpenSession, readSessions, updateSession } from "../src/store.js";

const execFileAsync = promisify(execFile);

let root: string;
let home: string;
let cwd: string;
let options: { home: string; cwd: string };

/** Commits a file so the repo has a HEAD to record. Returns the full sha. */
async function commit(name: string): Promise<string> {
  await writeFile(path.join(cwd, name), name, "utf8");
  await execFileAsync("git", ["-C", cwd, "add", "-A"]);
  await execFileAsync("git", ["-C", cwd, "commit", "-q", "--no-verify", "-m", name]);
  const { stdout } = await execFileAsync("git", ["-C", cwd, "rev-parse", "HEAD"]);
  return stdout.trim();
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-start-"));
  home = path.join(root, "store");
  cwd = path.join(root, "work");
  await mkdir(cwd, { recursive: true });
  options = { home, cwd };

  await execFileAsync("git", ["init", "-q", cwd]);
  await execFileAsync("git", ["-C", cwd, "config", "user.email", "test@example.com"]);
  await execFileAsync("git", ["-C", cwd, "config", "user.name", "Test"]);
  await execFileAsync("git", ["-C", cwd, "config", "commit.gpgsign", "false"]);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("startSession", () => {
  it("records intent, HEAD, a start time and an empty scope", async () => {
    const head = await commit("a.txt");
    const before = Date.now();

    const session = await startSession("add rate limiting to /orders", options);

    expect(session.intent).toBe("add rate limiting to /orders");
    expect(session.startCommit).toBe(head);
    expect(session.scope).toEqual([]);
    expect(session.endedAt).toBeNull();
    expect(session.outcome).toBe("open");
    expect(Date.parse(session.startedAt)).toBeGreaterThanOrEqual(before);
  });

  it("persists the session so it is the open one", async () => {
    await commit("a.txt");
    const session = await startSession("look around", options);

    await expect(readSessions(options)).resolves.toEqual([session]);
    await expect(getOpenSession(options)).resolves.toEqual(session);
  });

  it("records a declared scope", async () => {
    await commit("a.txt");
    const session = await startSession("touch the api", {
      ...options,
      scope: ["api/orders.py", "api/middleware/"],
    });

    expect(session.scope).toEqual(["api/orders.py", "api/middleware/"]);
  });

  it("drops blanks and repeats from scope, keeping declared order", async () => {
    await commit("a.txt");
    const session = await startSession("touch the api", {
      ...options,
      scope: ["b.ts", "  ", "a.ts", "b.ts", " c.ts "],
    });

    expect(session.scope).toEqual(["b.ts", "a.ts", "c.ts"]);
  });

  it("records an empty baseline when the tree is clean", async () => {
    await commit("a.txt");
    const session = await startSession("clean start", options);

    expect(session.baseline).toEqual([]);
  });

  it("records already-modified files as the baseline", async () => {
    await commit("a.txt");
    await writeFile(path.join(cwd, "a.txt"), "edited before the session", "utf8");
    await writeFile(path.join(cwd, "untracked.txt"), "also here first", "utf8");

    const session = await startSession("start on a dirty tree", options);

    expect(session.baseline).toEqual(["a.txt", "untracked.txt"]);
  });

  it("refuses when a session is already open, naming it", async () => {
    await commit("a.txt");
    await startSession("the first thing", options);

    await expect(startSession("the second thing", options)).rejects.toThrow(
      /already open: "the first thing"/,
    );
    await expect(readSessions(options)).resolves.toHaveLength(1);
  });

  it("allows a new session once the open one has stopped", async () => {
    await commit("a.txt");
    const first = await startSession("the first thing", options);
    await updateSession(first.id, { endedAt: new Date().toISOString() }, options);

    const second = await startSession("the second thing", options);
    expect(second.id).not.toBe(first.id);
    await expect(getOpenSession(options)).resolves.toEqual(second);
  });

  it("refuses an empty intent", async () => {
    await commit("a.txt");
    await expect(startSession("   ", options)).rejects.toThrow(/No intent given/);
  });

  it("refuses outside a git repository", async () => {
    const plain = await mkdtemp(path.join(tmpdir(), "session-plain-"));
    try {
      await expect(startSession("nowhere", { home, cwd: plain })).rejects.toThrow(
        /Not a git repository/,
      );
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });

  it("refuses when HEAD is unborn, since there is no base to diff", async () => {
    await expect(startSession("too early", options)).rejects.toThrow(/No commits yet/);
  });

  it("writes nothing when it refuses", async () => {
    await expect(startSession("too early", options)).rejects.toThrow();
    await expect(readSessions(options)).resolves.toEqual([]);
  });
});

describe("formatStarted", () => {
  it("prints two lines: the intent with HEAD, then the scope", async () => {
    const head = await commit("a.txt");
    const session = await startSession("add rate limiting to /orders", {
      ...options,
      scope: ["api/orders.py", "api/middleware/"],
    });

    expect(formatStarted(session)).toEqual([
      `  started  add rate limiting to /orders  (head ${head.slice(0, 7)})`,
      "  scope    api/orders.py  api/middleware/",
    ]);
  });

  it("says so when no scope was declared", async () => {
    await commit("a.txt");
    const session = await startSession("look around", options);

    expect(formatStarted(session)[1]).toBe("  scope    none declared");
  });
});
