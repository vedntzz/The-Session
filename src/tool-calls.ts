// One tool call at a time: what it changed. Pure — the records are written by
// commands/tool-call.ts under the log's lock and folded by store/read.ts. Every
// call is recorded, including calls that changed nothing (invariant 4). The
// tree state before a call is not signed: it lives in an unsigned scratch file
// until the call ends (store/scratch.ts). The log holds paths and hashes only.
import { treeStateChanges, type TreeState } from "./tree-state.js";

/** Written when a call is about to run. `n` is this session's own counter. */
export interface ToolCallStart {
  readonly callId: string;
  readonly n: number;
  readonly tool: string;
}

/** A path a call changed, and its blob after (`null`: not a regular file). */
export interface ToolCallFile {
  readonly path: string;
  readonly blob: string | null;
}

/** Written when the call has run. */
export interface ToolCallEnd {
  readonly callId: string;
  readonly n: number;
  readonly tool: string;
  readonly files: readonly ToolCallFile[];
  /** `null` when it cannot be said: overlapping or unpaired. Never a guess. */
  readonly changed: boolean | null;
  /** Another call ran during this one; files are not attributed to either. */
  readonly overlapping: boolean;
  /** No start was recorded for this call, so there is no before to compare. */
  readonly unpaired?: true;
}

/** One call as the fold presents it. `seq` fields order events in the log. */
export interface ToolCall {
  readonly callId: string;
  readonly n: number;
  readonly tool: string;
  readonly startSeq?: number;
  readonly end?: ToolCallEnd;
  readonly endSeq?: number;
}

/** The next number for this session: one past the highest yet recorded. */
export function nextCallNumber(calls: readonly ToolCall[]): number {
  return calls.reduce((max, call) => Math.max(max, call.n), 0) + 1;
}

/**
 * The call a start record opens, or undefined if that call id is already open.
 * `next` is the session's shared counter (write-checks.ts nextEventNumber),
 * which write-check events also take numbers from.
 */
export function startFor(calls: readonly ToolCall[], callId: string, tool: string, next = 1): ToolCallStart | undefined {
  if (calls.some((call) => call.callId === callId)) return undefined;
  return { callId, n: Math.max(nextCallNumber(calls), next), tool };
}

/**
 * The end record for `callId`, given the tree after it. Overlapping is decided
 * from the log alone: another call that started before now and was still open,
 * or ended after this one started, ran during it — and this rule marks both,
 * since the other call's end saw this one open or will. Overlapping and
 * unpaired calls attribute no files: `changed` is `null`, not a guess. A call
 * is unpaired when the log has no start for it or `before` is missing — the
 * scratch file that held it is gone.
 */
export function endFor(
  calls: readonly ToolCall[], callId: string, tool: string,
  before: TreeState | undefined, after: TreeState, next = 1,
): ToolCallEnd | undefined {
  const call = calls.find((item) => item.callId === callId);
  if (call?.end) return undefined;
  if (!call || before === undefined || call.startSeq === undefined) {
    return { callId, n: call?.n ?? Math.max(nextCallNumber(calls), next), tool, files: [], changed: null, overlapping: false, unpaired: true };
  }
  const startSeq = call.startSeq;
  const overlapping = calls.some((other) => other.callId !== callId && other.startSeq !== undefined &&
    (other.endSeq === undefined ? true : other.endSeq > startSeq));
  if (overlapping) return { callId, n: call.n, tool: call.tool, files: [], changed: null, overlapping: true };
  const files = filesChanged(before, after);
  return { callId, n: call.n, tool: call.tool, files, changed: files.length > 0, overlapping: false };
}

/**
 * Each path whose state moved, with its blob after. A path the call put back
 * to the start commit is absent from a plain look, so the caller must hash
 * every path `before` names (see treeStateAfter); one missing here is a caller
 * error, never quietly recorded as deleted.
 */
export function filesChanged(before: TreeState, after: TreeState): ToolCallFile[] {
  return treeStateChanges(before, after).map((path) => {
    if (!Object.hasOwn(after, path)) {
      throw new Error(`No state after the call for ${JSON.stringify(path)}. Take the look with treeStateAfter.`);
    }
    return { path, blob: after[path]! };
  });
}

/** Folds one tool-call record into the session's calls, by log position. */
export function foldToolCall(
  calls: readonly ToolCall[],
  seq: number,
  record: { toolCallStart?: ToolCallStart; toolCallEnd?: ToolCallEnd },
): ToolCall[] {
  const next = [...calls];
  const { toolCallStart: start, toolCallEnd: end } = record;
  if (start && !next.some((call) => call.callId === start.callId)) {
    next.push({ callId: start.callId, n: start.n, tool: start.tool, startSeq: seq });
  }
  if (end) {
    const index = next.findIndex((call) => call.callId === end.callId);
    if (index === -1) next.push({ callId: end.callId, n: end.n, tool: end.tool, end, endSeq: seq });
    else if (!next[index]!.end) next[index] = { ...next[index]!, end, endSeq: seq };
  }
  return next;
}

/**
 * Counts over a session's calls. Every call is in `total` — a call that could
 * not say what it changed still ran. `unattributed` (overlapping or unpaired)
 * and `running` (no end yet) are counted apart from `changed` and `unchanged`,
 * and never folded into either: an absence is not a nought.
 */
export interface CallCounts {
  readonly total: number;
  readonly changed: number;
  readonly unchanged: number;
  readonly unattributed: number;
  readonly running: number;
}

export function countCalls(calls: readonly ToolCall[]): CallCounts {
  const ended = calls.filter((call) => call.end !== undefined);
  return {
    total: calls.length,
    changed: ended.filter((call) => call.end!.changed === true).length,
    unchanged: ended.filter((call) => call.end!.changed === false).length,
    unattributed: ended.filter((call) => call.end!.changed === null).length,
    running: calls.length - ended.length,
  };
}

/**
 * The share of calls that changed nothing, over the calls that could say.
 * Unattributed and running calls are in no denominator; with none that could
 * say, there is no share — undefined, never 0.
 */
export function unchangedShare(counts: CallCounts): number | undefined {
  const known = counts.changed + counts.unchanged;
  return known === 0 ? undefined : counts.unchanged / known;
}
