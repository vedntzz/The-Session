import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Generous cap: `git diff` over a huge tree can produce a lot of paths. */
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

async function runGit(cwd: string, args: string[]): Promise<string> {
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
async function tryGit(cwd: string, args: string[]): Promise<string | undefined> {
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
async function repoRoot(cwd: string): Promise<string> {
  const root = await tryGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (root === undefined) {
    throw new Error(`not a git repository: ${cwd}`);
  }
  return root.trim();
}

/** Splits NUL-terminated git output, which is safe for any legal filename. */
function splitNulList(stdout: string): string[] {
  return stdout.split("\0").filter((entry) => entry !== "");
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

/**
 * Paths that differ from `commit`, relative to the repo root, sorted and
 * deduplicated. Covers tracked edits (staged or not), deletions, and
 * untracked files; files excluded by .gitignore are omitted.
 *
 * Throws if `cwd` is not a repository or `commit` does not resolve.
 */
export async function changedFilesSince(
  commit: string,
  cwd: string = process.cwd(),
): Promise<string[]> {
  const root = await repoRoot(cwd);

  const resolved = await tryGit(root, ["rev-parse", "--verify", "--end-of-options", `${commit}^{commit}`]);
  if (resolved === undefined) {
    throw new Error(`unknown commit: ${commit}`);
  }

  // --no-relative defeats a diff.relative config; -z avoids git's quoting of
  // paths containing spaces, newlines or non-ASCII bytes. The revision here is
  // the resolved 40-hex sha, so it can never be mistaken for an option.
  const tracked = await runGit(root, [
    "diff",
    "--name-only",
    "--no-relative",
    "-z",
    resolved.trim(),
    "--",
  ]);

  // --full-name is belt-and-braces: output is already root-relative because
  // the command runs from the root.
  const untracked = await runGit(root, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "--full-name",
    "-z",
  ]);

  const paths = new Set([...splitNulList(tracked), ...splitNulList(untracked)]);
  return [...paths].sort();
}
