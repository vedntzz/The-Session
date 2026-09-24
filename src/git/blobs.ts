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

/**
 * The working tree as it differs from `commit`: every changed, deleted or
 * untracked path, with its blob id now (`null` where it is not a regular
 * file). A path not in the map is as it was at `commit`. What `start` records
 * as `baselineState` is this, taken at the start commit's instant; taken again
 * after a tool call, two of them say what that call changed.
 */
export async function treeStateSince(
  commit: string,
  cwd: string = process.cwd(),
): Promise<Record<string, string | null>> {
  return endStateOf(await changedFilesSince(commit, cwd), cwd);
}

/**
 * A look after a tool call: `treeStateSince`, plus the blob of every path the
 * look before named that is now back as it was at `commit`. Without those, a
 * path the call put back would be absent from the look and could not be told
 * from one that never changed. Every path `before` names is in the answer.
 */
export async function treeStateAfter(
  before: Readonly<Record<string, string | null>>,
  commit: string,
  cwd: string = process.cwd(),
): Promise<Record<string, string | null>> {
  const now = await treeStateSince(commit, cwd);
  const restored = Object.keys(before).filter((path) => !Object.hasOwn(now, path));
  if (restored.length === 0) return now;
  const blobs = await workingBlobs(await repoRoot(cwd), restored);
  return { ...now, ...Object.fromEntries(blobs) };
}

/** One path's stat fields when its blob was taken, as decimal strings (ns precision). */
export interface StatEntry {
  readonly mtimeNs: string;
  readonly ctimeNs: string;
  readonly size: string;
  readonly ino: string;
  readonly blob: string;
}

/** Blobs remembered between looks, and when the look that wrote them began. */
export interface StatCache {
  readonly writtenAtNs: string;
  readonly entries: Readonly<Record<string, StatEntry>>;
}

/**
 * `treeStateSince` (plus `extra` paths, as `treeStateAfter` needs), rehashing
 * only what may have changed. The path list always comes from git, so new and
 * deleted paths are always resolved; a cached blob is reused only when every
 * stat field matches **and** the file's mtime is older than the look that
 * cached it. A file written in the same tick as that look is racily clean — its
 * stat can match while its content does not — so it is rehashed, as git does
 * for its index. `writtenAtNs` is taken before any stat, so an edit landing
 * during this look is rehashed next time too. Non-files are `null`, never
 * cached. With no cache this is exactly `treeStateSince`.
 */
export async function treeStateCached(
  commit: string,
  cwd: string,
  cache: StatCache | undefined,
  extra: readonly string[] = [],
): Promise<{ state: Record<string, string | null>; cache: StatCache }> {
  const writtenAtNs = BigInt(Date.now()) * 1_000_000n;
  const root = await repoRoot(cwd);
  const dirty = await changedFilesSince(commit, cwd);
  const paths = [...new Set([...dirty, ...extra])].sort();
  const before = cache ? BigInt(cache.writtenAtNs) : 0n;

  const state = new Map<string, string | null>();
  const entries: Record<string, StatEntry> = {};
  const toHash: { path: string; stat: Omit<StatEntry, "blob"> }[] = [];
  for (const path of paths) {
    const info = await stat(join(root, path), { bigint: true }).catch(() => undefined);
    if (!info?.isFile()) {
      state.set(path, null);
      continue;
    }
    const fields = { mtimeNs: String(info.mtimeNs), ctimeNs: String(info.ctimeNs), size: String(info.size), ino: String(info.ino) };
    const hit = cache?.entries[path];
    if (hit && hit.mtimeNs === fields.mtimeNs && hit.ctimeNs === fields.ctimeNs && hit.size === fields.size &&
      hit.ino === fields.ino && info.mtimeNs < before) {
      state.set(path, hit.blob);
      entries[path] = hit;
    } else {
      state.set(path, null); // placeholder, filled below in the same order
      toHash.push({ path, stat: fields });
    }
  }
  for (const batch of chunk(toHash, ARG_CHUNK)) {
    const stdout = await runGit(root, ["hash-object", "--", ...batch.map((item) => item.path)]);
    const ids = stdout.split("\n").filter((line) => line.trim() !== "");
    batch.forEach((item, index) => {
      const blob = ids[index]?.trim();
      state.set(item.path, blob ?? null);
      if (blob) entries[item.path] = { ...item.stat, blob };
    });
  }
  return { state: Object.fromEntries(state), cache: { writtenAtNs: String(writtenAtNs), entries } };
}
