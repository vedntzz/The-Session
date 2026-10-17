import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
/** Isolated committed checkout shared by the interactive-start integration tests. */
export async function createStartRepo() {
  const root = await mkdtemp(path.join(tmpdir(), "session-start-prompt-"));
  const cwd = path.join(root, "repo"); const home = path.join(root, "store");
  const git = (args: string[]) => exec("git", ["-C", cwd, ...args]);
  await mkdir(cwd); await git(["init", "-q"]);
  await git(["config", "user.name", "Test"]); await git(["config", "user.email", "test@example.com"]);
  await git(["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(cwd, "base.txt"), "base.txt");
  await git(["add", "--", "base.txt"]); await git(["commit", "-qm", "base.txt"]);
  return { root, cwd, home };
}
