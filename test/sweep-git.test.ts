// SES-3: what git is asked about a session's paths.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { changedFilesSince } from "../src/git.js";

const run = promisify(execFile);
let repo: string;

async function git(...args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", repo, ...args]);
  return stdout.trim();
}

async function write(relPath: string, content: string): Promise<void> {
  const full = path.join(repo, relPath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, "utf8");
}

async function commit(message: string): Promise<string> {
  await git("add", "-A");
  await git("commit", "-q", "--no-verify", "-m", message);
  return git("rev-parse", "HEAD");
}

beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "session-sweep-git-"));
  await git("init", "-q", "-b", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await git("config", "commit.gpgsign", "false");
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("SES-3: a rename keeps both of its paths", () => {
  it("names the path a staged rename left, not only where it went", async () => {
    await write("secret/keys.txt", "one\ntwo\nthree\nfour\n");
    const start = await commit("init");
    await git("mv", "secret/keys.txt", "public.txt");

    await expect(changedFilesSince(start, repo)).resolves.toEqual(["public.txt", "secret/keys.txt"]);
  });

  it("names both paths of a rename that was committed during the session", async () => {
    await write("a.ts", "export const a = 1;\nexport const b = 2;\n");
    const start = await commit("init");
    await mkdir(path.join(repo, "lib"));
    await git("mv", "a.ts", "lib/a.ts");
    await commit("move");

    await expect(changedFilesSince(start, repo)).resolves.toEqual(["a.ts", "lib/a.ts"]);
  });

  it("holds when the repository turns rename detection on in config", async () => {
    await git("config", "diff.renames", "copies");
    await write("a.ts", "export const a = 1;\nexport const b = 2;\n");
    const start = await commit("init");
    await git("mv", "a.ts", "b.ts");

    await expect(changedFilesSince(start, repo)).resolves.toEqual(["a.ts", "b.ts"]);
  });
});
