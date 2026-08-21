// Reads the repo: whether there is one, what HEAD is, which paths changed, and
// where the work on them ended up.
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { RepoFacts } from "./outcome.js";

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
export async function repoRoot(cwd: string): Promise<string> {
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

/**
 * Runs git with `input` on stdin. `cat-file --batch-check` answers a whole
 * list of questions in one process, which is the difference between one
 * subprocess per path and one per path per commit.
 */
async function runGitWithInput(cwd: string, args: string[], input: string): Promise<string> {
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
  const resolved = await resolveCommit(root, commit);

  // --no-relative defeats a diff.relative config; -z avoids git's quoting of
  // paths containing spaces, newlines or non-ASCII bytes. The revision here is
  // the resolved 40-hex sha, so it can never be mistaken for an option.
  const tracked = await runGit(root, [
    "diff",
    "--name-only",
    "--no-relative",
    "-z",
    resolved,
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

/** A commit as its 40-hex sha, so nothing downstream can read it as an option. */
async function resolveCommit(root: string, commit: string): Promise<string> {
  const args = ["rev-parse", "--verify", "--end-of-options", `${commit}^{commit}`];
  const resolved = await tryGit(root, args);
  if (resolved === undefined) {
    throw new Error(`unknown commit: ${commit}`);
  }
  return resolved.trim();
}

// --- where the work went --------------------------------------------------

/**
 * Where to look for the default branch, after `origin/HEAD` has been asked.
 *
 * The remote's copy of each name comes first: in a clone, `origin/main` is
 * what the team has agreed on, and the local `main` is one person's checkout
 * of it, possibly days behind.
 */
const DEFAULT_BRANCH_FALLBACKS = ["origin/main", "main", "origin/master", "master"] as const;

export interface DefaultBranch {
  /** What to call it in a report, e.g. `origin/main`. */
  name: string;
  /** Its tip commit. */
  tip: string;
}

/**
 * The branch work is expected to end up on.
 *
 * `origin/HEAD` is the honest answer where it is set, since it is the remote's
 * own statement of its default. It frequently is not set in a fresh clone, so
 * the well-known names are tried after it.
 */
export async function defaultBranch(cwd: string = process.cwd()): Promise<DefaultBranch | undefined> {
  const root = await repoRoot(cwd);
  const declared = await tryGit(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);

  const candidates = [declared?.trim(), ...DEFAULT_BRANCH_FALLBACKS].filter(
    (name): name is string => name !== undefined && name !== "",
  );

  for (const name of candidates) {
    const tip = await tryGit(root, ["rev-parse", "--verify", "--quiet", `${name}^{commit}`]);
    if (tip !== undefined && tip.trim() !== "") {
      return { name, tip: tip.trim() };
    }
  }
  return undefined;
}

/** Keeps a command line under any plausible limit. */
const ARG_CHUNK = 200;

function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

/**
 * Blob ids for a batch of `<rev>:<path>` questions, in the order asked.
 * `cat-file --batch-check` answers a missing path with `missing` rather than
 * failing, which is what makes one call able to ask about paths that may not
 * be there.
 */
async function blobIds(root: string, revPaths: readonly string[]): Promise<(string | undefined)[]> {
  if (revPaths.length === 0) {
    return [];
  }
  const stdout = await runGitWithInput(
    root,
    ["cat-file", "--batch-check"],
    `${revPaths.join("\n")}\n`,
  );

  return stdout
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [id, type] = line.split(" ");
      return type === "blob" ? id : undefined;
    });
}

/** Every blob a path has held across the default branch's history. */
async function historyOf(root: string, branch: string, path: string): Promise<Set<string>> {
  // `--` and a literal path, so a file named like a revision cannot be read
  // as one. Renames are not followed: the question is what sits at this path.
  const log = await tryGit(root, ["log", "--format=%H", branch, "--", path]);
  const commits = (log ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  const blobs = new Set<string>();
  for (const batch of chunk(commits, ARG_CHUNK)) {
    for (const id of await blobIds(root, batch.map((commit) => `${commit}:${path}`))) {
      if (id !== undefined) {
        blobs.add(id);
      }
    }
  }
  return blobs;
}

/** Blob ids of the paths as they sit in the working tree right now. */
async function workingBlobs(
  root: string,
  paths: readonly string[],
): Promise<Map<string, string | null>> {
  const working = new Map<string, string | null>();
  const present: string[] = [];

  for (const path of paths) {
    // A path that is not a readable file has no blob — deleted, or replaced by
    // a directory. Either way there is nothing of the session's left there.
    const stats = await stat(join(root, path)).catch(() => undefined);
    if (stats?.isFile()) {
      present.push(path);
    } else {
      working.set(path, null);
    }
  }

  for (const batch of chunk(present, ARG_CHUNK)) {
    // Hashed through git so that whatever filters the path is subject to are
    // the same ones applied to the blobs it is about to be compared with.
    const stdout = await runGit(root, ["hash-object", "--", ...batch]);
    const ids = stdout.split("\n").filter((line) => line.trim() !== "");
    batch.forEach((path, index) => working.set(path, ids[index]?.trim() ?? null));
  }
  return working;
}

/**
 * Everything the repository has to say about a set of paths, gathered once.
 *
 * Undefined when there is no default branch to judge against — a repository
 * with no `main`, no `master` and no `origin/HEAD` is one where "did this
 * merge" has no answer, and inventing one would be worse than declining.
 */
export async function gatherRepoFacts(
  paths: readonly string[],
  cwd: string = process.cwd(),
): Promise<RepoFacts | undefined> {
  if (!(await isRepo(cwd))) {
    return undefined;
  }
  const root = await repoRoot(cwd);
  const branch = await defaultBranch(root);
  if (!branch) {
    return undefined;
  }

  const wanted = [...new Set(paths)].sort();
  return {
    branch: branch.name,
    tip: branch.tip,
    history: await historyFor(root, branch.name, wanted),
    absentAtTip: await absentAt(root, branch.tip, wanted),
    working: await workingBlobs(root, wanted),
  };
}

/** Every blob each path has ever held on the branch, path by path. */
async function historyFor(
  root: string,
  branch: string,
  wanted: readonly string[],
): Promise<Map<string, ReadonlySet<string>>> {
  const history = new Map<string, ReadonlySet<string>>();
  for (const path of wanted) {
    history.set(path, await historyOf(root, branch, path));
  }
  return history;
}

/** The paths that are not in the branch's tree at all, asked in batches. */
async function absentAt(
  root: string,
  tip: string,
  wanted: readonly string[],
): Promise<Set<string>> {
  const absent = new Set<string>();
  for (const batch of chunk(wanted, ARG_CHUNK)) {
    const ids = await blobIds(root, batch.map((path) => `${tip}:${path}`));
    batch.forEach((path, index) => {
      if (ids[index] === undefined) {
        absent.add(path);
      }
    });
  }
  return absent;
}

/**
 * The blob ids of `paths` as they are right now — what `stop` records so that
 * `settle` has something to go looking for later.
 */
export async function endStateOf(
  paths: readonly string[],
  cwd: string = process.cwd(),
): Promise<Record<string, string | null>> {
  const root = await repoRoot(cwd);
  const blobs = await workingBlobs(root, [...new Set(paths)].sort());
  return Object.fromEntries(blobs);
}
