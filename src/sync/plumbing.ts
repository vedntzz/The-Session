// Every git command sync runs. No porcelain, no index, no work tree.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { repoRoot } from "../git.js";
import type { StoreOptions } from "../store.js";
import { LOG_ENTRY, REF_PREFIX } from "./refs.js";

export const execFileAsync = promisify(execFile);

// --- git plumbing --------------------------------------------------------
//
// Every git invocation in this file is below this line and nowhere else. All
// of it is plumbing: hash-object, mktree, commit-tree, update-ref, push,
// fetch, for-each-ref, cat-file. None of it touches the index, the work tree,
// or any ref a porcelain command reads, which is what makes syncing invisible
// to everything else in the repository.

/** Generous cap: a log of a few thousand records is still only megabytes. */
export const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

export async function git(cwd: string, args: string[], input?: string): Promise<string> {
  try {
    const child = execFileAsync("git", args, {
      cwd,
      maxBuffer: MAX_OUTPUT_BYTES,
      encoding: "utf8",
    });
    if (input !== undefined) {
      child.child.stdin?.end(input);
    }
    const { stdout } = await child;
    return stdout;
  } catch (error) {
    const { stderr, message } = error as { stderr?: string; message?: string };
    const detail = (stderr ?? "").trim() || message || "unknown error";
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
}

export async function tryGit(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    return await git(cwd, args);
  } catch {
    return undefined;
  }
}

/** The origin remote's URL, or undefined when there is no origin. */
export async function originUrl(root: string): Promise<string | undefined> {
  return (await tryGit(root, ["remote", "get-url", "origin"]))?.trim();
}

/** Writes `content` into the object database and returns its blob id. */
export async function writeBlob(root: string, content: string): Promise<string> {
  // --no-filters: the log is bytes to be reproduced exactly, not a work-tree
  // file to be run through anyone's clean/smudge configuration.
  const sha = await git(root, ["hash-object", "-w", "--no-filters", "--stdin"], content);
  return sha.trim();
}

/** A tree holding the log under one well-known name. */
export async function writeTree(root: string, blob: string): Promise<string> {
  const tree = await git(root, ["mktree"], `100644 blob ${blob}\t${LOG_ENTRY}\n`);
  return tree.trim();
}

export async function commitTree(
  root: string,
  tree: string,
  parent: string | undefined,
  message: string,
): Promise<string> {
  const args = ["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", message];
  return (await git(root, args)).trim();
}

/** The commit a ref points at, or undefined when the ref does not exist. */
export async function resolveRef(root: string, ref: string): Promise<string | undefined> {
  return (await tryGit(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]))?.trim();
}

/** The tree a commit points at. */
export async function treeOf(root: string, commit: string): Promise<string | undefined> {
  return (await tryGit(root, ["rev-parse", "--verify", "--quiet", `${commit}^{tree}`]))?.trim();
}

/**
 * Moves a ref, refusing if it is not where the caller thought it was. The old
 * value is a compare-and-swap: two `session push` runs at once cannot lose one
 * another's commit.
 */
export async function updateRef(
  root: string,
  ref: string,
  commit: string,
  old: string | undefined,
): Promise<void> {
  await git(root, ["update-ref", ref, commit, ...(old === undefined ? [] : [old])]);
}

/** Every session ref on this machine, with the commit each points at. */
export async function localRefs(root: string): Promise<Map<string, string>> {
  const out = await git(root, [
    "for-each-ref",
    "--format=%(refname) %(objectname)",
    REF_PREFIX,
  ]);

  const refs = new Map<string, string>();
  for (const entry of out.split("\n")) {
    const [ref, sha] = entry.trim().split(" ");
    if (ref && sha) {
      refs.set(ref, sha);
    }
  }
  return refs;
}

/** The log stored under a ref, or undefined when the ref holds something else. */
export async function readLogAt(root: string, ref: string): Promise<string | undefined> {
  return tryGit(root, ["cat-file", "-p", `${ref}:${LOG_ENTRY}`]);
}

// --- the operations ------------------------------------------------------

/** Everything the three commands need beyond where the store lives. */
export type SyncOptions = StoreOptions;

/** Said the same way by every command here, since the fix is the same one. */
export const NO_ORIGIN =
  "No origin remote. Records travel over the one your team already shares — " +
  "add it with git remote add origin <url>.";

/** The repo root, and the origin it syncs with. Refuses early and clearly. */
export async function syncingRepo(options: SyncOptions): Promise<string> {
  const cwd = options.cwd ?? process.cwd();

  let root: string;
  try {
    root = await repoRoot(cwd);
  } catch (error) {
    throw new Error(`Not a git repository: ${cwd}. Records sync over a repo's remote.`, {
      cause: error,
    });
  }

  if ((await originUrl(root)) === undefined) {
    throw new Error(NO_ORIGIN);
  }
  return root;
}
