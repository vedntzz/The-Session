// Unsigned working state for tool calls in flight. Never part of the signed
// record: it is a cache the hooks need and nothing else does. Three kinds, all
// under ~/.session/tmp/<session>/, all 0600, hashes, stat fields and paths only:
//
// - session.json, one per session: where its log is (its repo identity,
//   resolved once) and what it diffs against. Found by the hook's working
//   directory, so the common path spawns no git and reads no log.
// - call-<id>.json, one per call in flight: the tree state before it. Deleted
//   when the call's end record is written.
// - stat-cache.json, one per session: each dirty path's stat fields and blob
//   at the last look, so the next look rehashes only what may have changed.
//
// Anything older than a day is removed by the sweep; see pruneScratch.
import { mkdir, readdir, readFile, realpath, rm, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StatCache } from "../git/blobs.js";
import type { TreeState } from "../tree-state.js";
import { storeHome } from "./paths.js";
import type { StoreOptions } from "./record.js";

export interface SessionCache {
  readonly sessionId: string;
  /** The checkout's canonical root; a hook finds this cache by being inside it. */
  readonly checkout: string;
  /** The session's log, resolved once: its repo identity, cached. */
  readonly storeFile: string;
  readonly startCommit: string;
}

export interface CallScratch {
  readonly sessionId: string;
  readonly callId: string;
  readonly before: TreeState;
}

const SESSION_FILE = "session.json";
const STAT_FILE = "stat-cache.json";

function scratchDir(options: StoreOptions): string {
  return path.join(storeHome(options), "tmp");
}
function sessionDir(options: StoreOptions, sessionId: string): string {
  return path.join(scratchDir(options), encodeURIComponent(sessionId));
}
/** Prefixed, so no call id can collide with session.json; encoded, so none names a path. */
function callName(callId: string): string {
  return `call-${encodeURIComponent(callId)}.json`;
}

async function writePrivate(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
}

async function readJson<T>(file: string): Promise<T | undefined> {
  const text = await readFile(file, "utf8").catch(() => undefined);
  return text === undefined ? undefined : (JSON.parse(text) as T);
}

export async function writeSessionCache(cache: SessionCache, options: StoreOptions): Promise<void> {
  await writePrivate(path.join(sessionDir(options, cache.sessionId), SESSION_FILE), cache);
}

export async function readSessionCache(sessionId: string, options: StoreOptions): Promise<SessionCache | undefined> {
  return readJson<SessionCache>(path.join(sessionDir(options, sessionId), SESSION_FILE));
}

/**
 * The newest session cache whose checkout holds `cwd`. A filesystem walk, no
 * git and no log: the caller confirms under the lock that the session is still
 * open, and refreshes when it is not.
 */
export async function findSessionCacheFor(cwd: string, options: StoreOptions): Promise<SessionCache | undefined> {
  const here = await realpath(cwd).catch(() => path.resolve(cwd));
  let best: { cache: SessionCache; mtime: number } | undefined;
  for (const dir of await readdir(scratchDir(options)).catch(() => [] as string[])) {
    const file = path.join(scratchDir(options), dir, SESSION_FILE);
    const cache = await readJson<SessionCache>(file);
    if (!cache || !(here === cache.checkout || here.startsWith(cache.checkout + path.sep))) continue;
    const mtime = (await stat(file)).mtimeMs;
    if (!best || mtime > best.mtime) best = { cache, mtime };
  }
  return best?.cache;
}

/**
 * Per path, the stat fields and blob of the last look, for the incremental
 * snapshot. A cache, never evidence: a wrong or missing one costs a rehash,
 * because every entry is checked against the file before it is trusted.
 */
export async function readStatCache(sessionId: string, options: StoreOptions): Promise<StatCache | undefined> {
  return readJson<StatCache>(path.join(sessionDir(options, sessionId), STAT_FILE));
}

export async function writeStatCache(sessionId: string, cache: StatCache, options: StoreOptions): Promise<void> {
  await writePrivate(path.join(sessionDir(options, sessionId), STAT_FILE), cache);
}

export async function deleteSessionCache(sessionId: string, options: StoreOptions): Promise<void> {
  await rm(path.join(sessionDir(options, sessionId), SESSION_FILE), { force: true });
}

export async function writeCallScratch(scratch: CallScratch, options: StoreOptions): Promise<void> {
  await writePrivate(path.join(sessionDir(options, scratch.sessionId), callName(scratch.callId)), scratch);
}

/** The scratch for a call id, found without reading any log. */
export async function findCallScratch(callId: string, options: StoreOptions): Promise<CallScratch | undefined> {
  for (const dir of await readdir(scratchDir(options)).catch(() => [] as string[])) {
    const value = await readJson<CallScratch>(path.join(scratchDir(options), dir, callName(callId)));
    if (value?.callId === callId) return value;
  }
  return undefined;
}

export async function deleteCallScratch(sessionId: string, callId: string, options: StoreOptions): Promise<void> {
  await rm(path.join(sessionDir(options, sessionId), callName(callId)), { force: true });
}

/** A day: long past any tool call's host timeout, short enough not to pile up. */
export const SCRATCH_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Removes scratch files not touched for `maxAgeMs` — a call whose after hook
 * never ran, a session long closed — and any directory left empty. Returns how
 * many files went. Nothing here is evidence: the signed log is untouched.
 */
export async function pruneScratch(options: StoreOptions, now: number = Date.now(), maxAgeMs = SCRATCH_MAX_AGE_MS): Promise<number> {
  let removed = 0;
  for (const dir of await readdir(scratchDir(options)).catch(() => [] as string[])) {
    const full = path.join(scratchDir(options), dir);
    for (const name of await readdir(full).catch(() => [] as string[])) {
      const file = path.join(full, name);
      const info = await stat(file).catch(() => undefined);
      if (info && now - info.mtimeMs > maxAgeMs) {
        await rm(file, { force: true });
        removed++;
      }
    }
    await rmdir(full).catch(() => {}); // only succeeds once empty
  }
  return removed;
}
