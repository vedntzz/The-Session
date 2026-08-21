import { zeroCost, type SessionCost, type TokenCounts } from "../store.js";

/** The slice of wall-clock time a session occupied. */
export interface CaptureWindow {
  /** ISO-8601. Activity at or after this instant counts. */
  from: string;
  /** ISO-8601. Activity at or before this instant counts. */
  to: string;
  /** The repo the session ran in, for adapters that can attribute by path. */
  cwd?: string;
}

/** What every adapter returns when it finds nothing. */
export const NO_COST: SessionCost = zeroCost();

/**
 * One coding tool's transcripts, reduced to the normalised shape the core
 * stores. Adding a tool means adding an Adapter and registering it; nothing
 * outside this directory knows which tool produced a session's cost.
 */
export interface Adapter {
  /** Stable identifier, e.g. `claude-code`. */
  readonly name: string;
  /** True when this tool has left anything readable on this machine. */
  isAvailable(): Promise<boolean>;
  /** Cost observed inside `window`. Returns zeros rather than throwing. */
  capture(window: CaptureWindow): Promise<SessionCost>;
}

/**
 * Adds costs from several adapters together. The reported model is whichever
 * did the most calls, so a session that mixed tools still names the one that
 * did the bulk of the work; ties break alphabetically to stay deterministic.
 */
export function mergeCosts(costs: readonly SessionCost[]): SessionCost {
  const callsByModel = new Map<string, number>();
  const total = zeroCost();

  const empty = total.emptyTurnTokens as TokenCounts;

  for (const cost of costs) {
    addTokens(total, cost);
    // An adapter too old to report the split contributes nothing to it, rather
    // than having a share of its total invented on its behalf.
    if (cost.emptyTurnTokens) {
      addTokens(empty, cost.emptyTurnTokens);
    }
    total.turns += cost.turns;
    total.emptyTurns += cost.emptyTurns;
    total.apiCalls += cost.apiCalls;
    total.callsWithoutEdits += cost.callsWithoutEdits;
    if (cost.model !== "") {
      callsByModel.set(cost.model, (callsByModel.get(cost.model) ?? 0) + cost.apiCalls);
    }
  }

  total.model = dominant(callsByModel);
  return total;
}

/**
 * Adds one set of the four counters onto a running total.
 *
 * Four, never one sum: each bills at a different rate, so a total cannot be
 * converted back into money. Shared with the adapters, which add calls up the
 * same way.
 */
export function addTokens(total: TokenCounts, part: TokenCounts): void {
  total.inputTokens += part.inputTokens;
  total.cacheReadTokens += part.cacheReadTokens;
  total.cacheCreationTokens += part.cacheCreationTokens;
  total.outputTokens += part.outputTokens;
}

/** The key with the highest count, ties broken by name. "" when empty. */
export function dominant(counts: ReadonlyMap<string, number>): string {
  let best = "";
  let bestCount = 0;
  for (const [key, count] of [...counts].sort(([a], [b]) => a.localeCompare(b))) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}
