// Running git, and the two questions every other file here starts with.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const execFileAsync = promisify(execFile);

/** Generous cap: `git diff` over a huge tree can produce a lot of paths. */
export const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

export async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: MAX_OUTPUT_BYTES,
      encoding: "utf8",
    });
    return stdout;
  } catch (error) {
    const { stderr, message } = error as { stderr?: string; message?: string };
    const detail = (stderr ?? "").trim() || message || "unknown error";
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
}

/** Runs git, returning undefined instead of throwing when the command fails. */
export async function tryGit(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    return await runGit(cwd, args);
  } catch {
    return undefined;
  }
}

/**
 * Absolute path of the work tree root. Every path-producing command runs from
 * here, which is what makes the results root-relative no matter which
 * subdirectory the caller is in.
 */
export async function repoRoot(cwd: string): Promise<string> {
  const root = await tryGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (root === undefined) {
    throw new Error(`not a git repository: ${cwd}`);
  }
  return root.trim();
}

/** Splits NUL-terminated git output, which is safe for any legal filename. */
export function splitNulList(stdout: string): string[] {
  return stdout.split("\0").filter((entry) => entry !== "");
}

/**
 * Runs git with `input` on stdin. `cat-file --batch-check` answers a whole
 * list of questions in one process, which is the difference between one
 * subprocess per path and one per path per commit.
 */
export async function runGitWithInput(cwd: string, args: string[], input: string): Promise<string> {
  const child = execFile("git", args, { cwd, maxBuffer: MAX_OUTPUT_BYTES, encoding: "utf8" });
  child.stdin?.end(input);

  return new Promise((resolve, reject) => {
    let stdout = "";
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", reject);
    child.on("close", () => resolve(stdout));
  });
}

/** True if `cwd` is inside a git work tree. Never throws, even without git. */
export async function isRepo(cwd: string = process.cwd()): Promise<boolean> {
  const inside = await tryGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  return inside?.trim() === "true";
}

/**
 * Full 40-character SHA of HEAD, or undefined when HEAD is unborn (a fresh
 * `git init` with no commits yet). Throws if `cwd` is not a repository.
 */
export async function currentCommit(cwd: string = process.cwd()): Promise<string | undefined> {
  const root = await repoRoot(cwd);
  const sha = await tryGit(root, ["rev-parse", "--verify", "HEAD"]);
  return sha?.trim();
}

/** Keeps a command line under any plausible limit. */
export const ARG_CHUNK = 200;

export function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}
