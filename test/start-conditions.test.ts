import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertStartAvailable } from "../src/commands/start-conditions.js";
import { startPassiveSession, startSession } from "../src/commands/start.js";
import { getOpenSession, repoIdentity, resolveStoreFile, writeRecord, zeroCost } from "../src/store.js";

const execFileAsync = promisify(execFile);
let root: string;
let cwd: string;
let home: string;
let options: { home: string; cwd: string };

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args]);
  return stdout.trim();
}

async function commit(name: string): Promise<string> {
  await writeFile(path.join(cwd, name), name);
  await git(["add", "--", name]);
  await git(["commit", "-q", "--no-verify", "-m", name]);
  return git(["rev-parse", "HEAD"]);
}

async function repository(hasHead = true): Promise<void> {
  await git(["init", "-q"]);
  await git(["config", "user.email", "test@example.com"]);
  await git(["config", "user.name", "Test"]);
  await git(["config", "commit.gpgsign", "false"]);
  if (hasHead) await commit("base.txt");
}

async function logBytes(): Promise<string> {
  return readFile(await resolveStoreFile(options), "utf8");
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-start-conditions-"));
  cwd = path.join(root, "work");
  home = path.join(root, "store");
  await mkdir(cwd);
  options = { home, cwd };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("assertStartAvailable", () => {
  it("refuses outside a repository without creating a store", async () => {
    await expect(assertStartAvailable(options)).rejects.toThrow(/Not a git repository/);
    expect(existsSync(home)).toBe(false);
  });

  it("refuses an unborn HEAD without creating keys or a log", async () => {
    await repository(false);
    await expect(assertStartAvailable(options)).rejects.toThrow(/No commits yet/);
    expect(existsSync(home)).toBe(false);
  });

  it("allows a repository with a HEAD without creating a store", async () => {
    await repository();
    await expect(assertStartAvailable(options)).resolves.toBeUndefined();
    expect(existsSync(home)).toBe(false);
  });

  it("refuses an open declaration without changing its record", async () => {
    await repository();
    const open = await startSession("first declaration", options);
    const before = await logBytes();
    await expect(assertStartAvailable(options)).rejects.toThrow(/already open: "first declaration"/);
    expect(await getOpenSession(options)).toEqual(open);
    expect(await logBytes()).toBe(before);
  });

  it("treats an old record without intentSource as declared and keeps its bytes", async () => {
    await repository();
    await writeRecord("legacy", {
      repo: await repoIdentity(cwd), intent: "legacy declaration", scope: [],
      baseline: [], reality: [], drift: [], cost: zeroCost(), outcome: "open",
      startedAt: new Date().toISOString(), endedAt: null, startCommit: await git(["rev-parse", "HEAD"]),
    }, options);
    const open = await getOpenSession(options);
    const before = await logBytes();
    expect(open?.intentSource).toBeUndefined();
    await expect(assertStartAvailable(options)).rejects.toThrow(/already open: "legacy declaration"/);
    expect(await getOpenSession(options)).toEqual(open);
    expect(await logBytes()).toBe(before);
  });

  it("allows a captured session without closing or changing it", async () => {
    await repository();
    const open = await startPassiveSession(options);
    const before = await logBytes();
    await expect(assertStartAvailable(options)).resolves.toBeUndefined();
    expect(await getOpenSession(options)).toEqual(open);
    expect(await logBytes()).toBe(before);
    expect(open?.endedAt).toBeNull();
  });

  it("records the current HEAD at creation after an earlier preflight", async () => {
    await repository();
    const before = await git(["rev-parse", "HEAD"]);
    await assertStartAvailable(options);
    const current = await commit("later.txt");
    const session = await startSession("start after the prompt", options);
    expect(session.startCommit).toBe(current);
    expect(session.startCommit).not.toBe(before);
  });

  it("sanitizes control characters in a refusal without changing log bytes", async () => {
    await repository();
    await startSession("first\u001b[2J\n\u202edeclaration", options);
    const before = await logBytes();
    await expect(assertStartAvailable(options)).rejects.toThrow(
      'A session is already open: "first  declaration". Run session stop to close it.',
    );
    expect(await logBytes()).toBe(before);
  });
});
