// What the before-call and after-call recorders do, before they are wired to
// an editor's hooks. Silent and never blocking: they record, they do not
// decide. The snapshot runs outside the lock; the lock covers only reading the
// log, numbering the call and appending — so parallel calls do not queue
// behind each other's snapshots.
import { realpath } from "node:fs/promises";
import { repoRoot, treeStateAfter, treeStateSince } from "../git.js";
import {
  deleteCallScratch, deleteSessionCache, findCallScratch, findSessionCacheFor, foldLog, readLogAt,
  readSessionCache, resolveStoreFile, writeCallScratch, writeRecordFrom, writeSessionCache,
  type Session, type SessionCache, type StoreOptions,
} from "../store.js";
import { endFor, startFor, type ToolCallEnd, type ToolCallStart } from "../tool-calls.js";
import type { TreeState } from "../tree-state.js";

export interface CallHookInput {
  /** The call id the editor's hook payload carries; it pairs start and end. */
  readonly callId: string;
  readonly tool: string;
}

/** Seams for tests. `snapshot` defaults to the git look at the start commit. */
export interface CallHookDeps {
  readonly snapshot?: (startCommit: string, cwd: string) => Promise<TreeState>;
}

function openSession(sessions: readonly Session[]): Session | undefined {
  return sessions.filter((session) => session.endedAt === null).at(-1);
}

/**
 * The slow path, taken on a session's first call or when the cache went
 * stale: resolve the repo identity once, read the log once, cache what the
 * next calls need. Undefined when no session is open.
 */
async function refreshSessionCache(cwd: string, options: StoreOptions): Promise<SessionCache | undefined> {
  const storeFile = await resolveStoreFile(options);
  const session = openSession(foldLog(await readLogAt(storeFile)));
  if (!session) return undefined;
  const checkout = session.checkout ?? await realpath(await repoRoot(cwd));
  const cache = { sessionId: session.id, checkout, storeFile, startCommit: session.startCommit };
  await writeSessionCache(cache, options);
  return cache;
}

/**
 * Numbers the call and records that it is about to run. Snapshot first, with
 * no lock held; then, under the lock, confirm the cached session is still open,
 * assign `n` and append. A stale cache is dropped and refreshed once. The
 * before state goes to an unsigned scratch file; the signed record is only
 * `{callId, n, tool}`. Undefined when no session is open or the id is taken.
 */
export async function beforeToolCall(
  input: CallHookInput, options: StoreOptions = {}, deps: CallHookDeps = {},
): Promise<ToolCallStart | undefined> {
  const cwd = options.cwd ?? process.cwd();
  const snapshot = deps.snapshot ?? treeStateSince;
  for (const attempt of [0, 1]) {
    const cache = (attempt === 0 ? await findSessionCacheFor(cwd, options) : undefined)
      ?? await refreshSessionCache(cwd, options);
    if (!cache) return undefined;
    const before = await snapshot(cache.startCommit, cwd);
    // Set inside the builder; declared wide so the checks below are not narrowed away.
    let outcome = "taken" as "started" | "stale" | "taken";
    let started: ToolCallStart | undefined;
    await writeRecordFrom({ ...options, storeFile: cache.storeFile }, (log) => {
      const session = foldLog(log).find((item) => item.id === cache.sessionId);
      if (!session || session.endedAt !== null) { outcome = "stale"; return undefined; }
      started = startFor(session.toolCalls ?? [], input.callId, input.tool);
      if (!started) return undefined;
      outcome = "started";
      return { id: session.id, set: { toolCallStart: started } };
    });
    if (outcome === "stale") { await deleteSessionCache(cache.sessionId, options); continue; }
    if (outcome === "taken" || !started) return undefined;
    await writeCallScratch({ sessionId: cache.sessionId, callId: input.callId, before }, options);
    return started;
  }
  return undefined;
}

/**
 * Records what the call changed. The call scratch (found by call id) names the
 * session; its cache names the log and the start commit — no identity lookup.
 * Snapshot outside the lock, append under it. No call scratch: the end is
 * recorded as unpaired against the open session — never a guess at its files.
 */
export async function afterToolCall(input: CallHookInput, options: StoreOptions = {}): Promise<ToolCallEnd | undefined> {
  const cwd = options.cwd ?? process.cwd();
  const scratch = await findCallScratch(input.callId, options);
  const cache = (scratch ? await readSessionCache(scratch.sessionId, options) : await findSessionCacheFor(cwd, options))
    ?? await refreshSessionCache(cwd, options);
  if (!cache) return undefined;
  // No before state means nothing to compare: the end is unpaired whatever the tree holds.
  const after = scratch ? await treeStateAfter(scratch.before, cache.startCommit, cwd) : {};
  let ended: ToolCallEnd | undefined;
  await writeRecordFrom({ ...options, storeFile: cache.storeFile }, (log) => {
    const session = foldLog(log).find((item) => item.id === (scratch?.sessionId ?? cache.sessionId));
    if (!session) return undefined;
    ended = endFor(session.toolCalls ?? [], input.callId, input.tool, scratch?.before, after);
    return ended ? { id: session.id, set: { toolCallEnd: ended } } : undefined;
  });
  if (scratch) await deleteCallScratch(scratch.sessionId, input.callId, options);
  return ended;
}
