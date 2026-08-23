// Where a session's blobs ended up — the evidence behind an outcome.
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { RepoFacts } from "../outcome.js";
import { ARG_CHUNK, chunk, isRepo, repoRoot, runGit, runGitWithInput, tryGit } from "./run.js";
import { changedFilesSince } from "./changes.js";
import { defaultBranch } from "./branch.js";

/**
 * Blob ids for a batch of `<rev>:<path>` questions, in the order asked.
 * `cat-file --batch-check` answers a missing path with `missing` rather than
 * failing, which is what makes one call able to ask about paths that may not
 * be there.
 */
export async function blobIds(root: string, revPaths: readonly string[]): Promise<(string | undefined)[]> {
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
export async function historyOf(root: string, branch: string, path: string): Promise<Set<string>> {
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
export async function workingBlobs(
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
export async function historyFor(
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
export async function absentAt(
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
