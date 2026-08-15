import type { SessionCost } from "../store.js";

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
export const NO_COST: SessionCost = { tokens: 0, runs: 0, emptyRuns: 0, model: "" };

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
  let tokens = 0;
  let runs = 0;
  let emptyRuns = 0;

  for (const cost of costs) {
    tokens += cost.tokens;
    runs += cost.runs;
    emptyRuns += cost.emptyRuns;
    if (cost.model !== "") {
      callsByModel.set(cost.model, (callsByModel.get(cost.model) ?? 0) + cost.runs);
    }
  }

  return { tokens, runs, emptyRuns, model: dominant(callsByModel) };
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
