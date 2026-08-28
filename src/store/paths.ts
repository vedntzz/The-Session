// Which log file this repo's sessions live in.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { StoreOptions } from "./record.js";

export const execFileAsync = promisify(execFile);

// --- repo identity -------------------------------------------------------

/**
 * Normalizes a git remote so that equivalent forms of the same repository
 * collapse to one string: ssh/https, with or without credentials, with or
 * without a `.git` suffix.
 */
export function normalizeRemoteUrl(remote: string): string {
  let value = remote.trim();

  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(value);
  if (scheme) {
    try {
      const url = new URL(value);
      value = `${url.host}${url.pathname}`;
    } catch {
      value = value.slice(scheme[0].length);
    }
  } else {
    // scp-style: [user@]host:path
    const scp = /^(?:[^@/\\]+@)?([^:/\\]+):(.+)$/.exec(value);
    if (scp) {
      value = `${scp[1]}/${scp[2]}`;
    }
  }

  value = value.replace(/\/+$/, "");
  if (value.toLowerCase().endsWith(".git")) {
    value = value.slice(0, -4);
  }
  return value.toLowerCase();
}

export async function git(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, ...args]);
    const value = stdout.trim();
    return value === "" ? undefined : value;
  } catch {
    return undefined;
  }
}

/** The two kinds of identity, and how to tell one from the other. */
export const REMOTE_PREFIX = "remote:";
export const PATH_PREFIX = "path:";

/**
 * Identifies the repo this store belongs to, preferring the most stable
 * signal available: the origin remote, then the repository root, then the
 * directory itself. Using the repo root rather than the cwd means every
 * subdirectory of a repo shares one store.
 *
 * Which means a repo that gains an origin changes identity, and starts a
 * second log — the first thing it was is still on disk under the old key. That
 * is deliberate at write time and wrong at read time; see `sameRepoLogs`.
 */
export async function repoIdentity(cwd: string): Promise<string> {
  const remote = await remoteIdentity(cwd);
  return remote ?? (await pathIdentity(cwd));
}

/** What this checkout's origin remote calls it, or nothing when it has none. */
export async function remoteIdentity(cwd: string): Promise<string | undefined> {
  const remote = await git(cwd, ["remote", "get-url", "origin"]);
  return remote ? `${REMOTE_PREFIX}${normalizeRemoteUrl(remote)}` : undefined;
}

/**
 * What this checkout is called when nothing but its location is known: the
 * repository root, or the directory itself outside a repo.
 *
 * Worth asking for even when there is a remote — it is the key the log was
 * written under before the remote existed, and the only way back to it.
 */
export async function pathIdentity(cwd: string): Promise<string> {
  const root = await git(cwd, ["rev-parse", "--show-toplevel"]);
  return `${PATH_PREFIX}${path.resolve(root ?? cwd)}`;
}

/** The directory a path-keyed identity names, or nothing for a remote-keyed one. */
export function directoryOf(identity: string): string | undefined {
  return identity.startsWith(PATH_PREFIX) ? identity.slice(PATH_PREFIX.length) : undefined;
}

/**
 * What a path-keyed identity's directory is called now.
 *
 * The whole of the resolution: a log keyed on a location belongs to whatever
 * that location's origin says today. Nothing when the directory is gone, is no
 * longer a repo, or still has no remote — three different reasons for the same
 * answer, which is that this log stays where it is.
 *
 * The directory has to still be the *root* of the repo it names. A location
 * that has since become a subdirectory of some larger checkout would otherwise
 * answer with that checkout's origin, and a log about one piece of work would
 * be merged into an unrelated repository's history. Where the two disagree the
 * answer is no answer: a wrong merge is unrecoverable from the report, and a
 * missed one only leaves the log where it already was.
 */
export async function currentIdentityOf(identity: string): Promise<string | undefined> {
  const dir = directoryOf(identity);
  if (dir === undefined || (await pathIdentity(dir)) !== identity) {
    return undefined;
  }
  return remoteIdentity(dir);
}

/** The key an identity is filed under. Same repo, same key, on any machine. */
export function keyOf(identity: string): string {
  return createHash("sha256").update(identity).digest("hex").slice(0, 16);
}

/** Stable per-repo key. Same repo, same key, on any machine and any checkout. */
export async function repoKey(cwd: string = process.cwd()): Promise<string> {
  return keyOf(await repoIdentity(cwd));
}

/** The store root: where logs, and the signing key beside them, live. */
export function storeHome(options: StoreOptions = {}): string {
  return options.home ?? process.env["SESSION_HOME"] ?? path.join(homedir(), ".session");
}

/** The file an identity's log lives in. */
export function storeFileFor(identity: string, options: StoreOptions = {}): string {
  return path.join(storeHome(options), `${keyOf(identity)}.jsonl`);
}

/**
 * Absolute path of the JSONL file backing the current repo — the one every
 * append goes to.
 *
 * Writing stays single-file whatever `sameRepoLogs` reads: a log is a hash
 * chain signed by one key, and appending to whichever file the repo used to
 * be called would fork it.
 */
export async function resolveStoreFile(options: StoreOptions = {}): Promise<string> {
  return storeFileFor(await repoIdentity(options.cwd ?? process.cwd()), options);
}
