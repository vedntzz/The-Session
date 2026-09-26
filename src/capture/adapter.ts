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
 * did the most calls, or with no calls the most turns, so a session that mixed
 * tools still names the one that did the bulk of the work; ties break
 * alphabetically to stay deterministic.
 *
 * Only what an adapter can observe on its own is added up here: tokens, turns
 * and calls. **Nothing about what was produced**, which no adapter reports any
 * more — that is settled against the diff at `stop`, once for the session,
 * rather than being summed out of figures no transcript could supply.
 */
export function mergeCosts(costs: readonly SessionCost[]): SessionCost {
  const callsByModel = new Map<string, number>();
  const total = zeroCost();

  for (const cost of costs) {
    addTokens(total, cost);
    total.turns += cost.turns;
    total.apiCalls += cost.apiCalls;
    addPerTurn(total, cost);
    if (cost.model !== "") {
      callsByModel.set(cost.model, (callsByModel.get(cost.model) ?? 0) + cost.apiCalls);
    }
  }

  total.model = dominant(callsByModel) || dominantByTurns(costs);
  return total;
}

/** Carries per-turn fields across, leaving each absent where no adapter had any. */
function addPerTurn(total: SessionCost, part: SessionCost): void {
  if ((part.untokenedTurns ?? 0) > 0) {
    total.untokenedTurns = (total.untokenedTurns ?? 0) + part.untokenedTurns!;
  }
  if (part.turnModels !== undefined && part.turnModels.length > 0) {
    total.turnModels = [...(total.turnModels ?? []), ...part.turnModels];
    total.turnTokens = [...(total.turnTokens ?? []), ...(part.turnTokens ?? part.turnModels.map(() => null))];
  }
  if ((part.importedTurnsSkipped ?? 0) > 0) {
    total.importedTurnsSkipped = (total.importedTurnsSkipped ?? 0) + part.importedTurnsSkipped!;
  }
}

/** The model most turns ran on, for costs that name a model per turn and make no calls. */
function dominantByTurns(costs: readonly SessionCost[]): string {
  const byModel = new Map<string, number>();
  for (const model of costs.flatMap((cost) => cost.turnModels ?? [])) {
    if (model !== null) byModel.set(model, (byModel.get(model) ?? 0) + 1);
  }
  return dominant(byModel);
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
