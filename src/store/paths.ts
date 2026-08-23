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

/**
 * Identifies the repo this store belongs to, preferring the most stable
 * signal available: the origin remote, then the repository root, then the
 * directory itself. Using the repo root rather than the cwd means every
 * subdirectory of a repo shares one store.
 */
export async function repoIdentity(cwd: string): Promise<string> {
  const remote = await git(cwd, ["remote", "get-url", "origin"]);
  if (remote) {
    return `remote:${normalizeRemoteUrl(remote)}`;
  }

  const root = await git(cwd, ["rev-parse", "--show-toplevel"]);
  return `path:${path.resolve(root ?? cwd)}`;
}

/** Stable per-repo key. Same repo, same key, on any machine and any checkout. */
export async function repoKey(cwd: string = process.cwd()): Promise<string> {
  const identity = await repoIdentity(cwd);
  return createHash("sha256").update(identity).digest("hex").slice(0, 16);
}

/** The store root: where logs, and the signing key beside them, live. */
export function storeHome(options: StoreOptions = {}): string {
  return options.home ?? process.env["SESSION_HOME"] ?? path.join(homedir(), ".session");
}

/** Absolute path of the JSONL file backing the current repo. */
export async function resolveStoreFile(options: StoreOptions = {}): Promise<string> {
  const key = await repoKey(options.cwd ?? process.cwd());
  return path.join(storeHome(options), `${key}.jsonl`);
}
