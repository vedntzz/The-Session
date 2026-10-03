// Each call's tokens, kept under the model that billed them. Pure.
import { zeroTokens, type SessionCost, type TokenCounts } from "../store.js";

const COUNTERS = ["inputTokens", "cacheReadTokens", "cacheCreationTokens", "outputTokens"] as const;

function addTokens(total: TokenCounts, part: TokenCounts): void {
  for (const key of COUNTERS) total[key] += part[key];
}

/**
 * The four counters per model, for a list of calls that each name one.
 *
 * A session that runs a main model and a cheaper one for subagents bills each
 * call at its own model's rate, so the record keeps them apart; one figure
 * priced at whichever model made the most calls is wrong by the gap between
 * the two rates. A model whose calls carried no tokens — a synthetic entry —
 * is left out, since it adds nothing to the bill and has no rate to look up.
 * Nothing at all where no call carried tokens.
 */
export function modelTokensOf(
  calls: readonly (TokenCounts & { model: string })[],
): Pick<SessionCost, "modelTokens"> {
  const byModel: Record<string, TokenCounts> = {};
  for (const call of calls) {
    if (call.inputTokens + call.cacheReadTokens + call.cacheCreationTokens + call.outputTokens === 0) continue;
    addTokens((byModel[call.model] ??= zeroTokens()), call);
  }
  return Object.keys(byModel).length === 0 ? {} : { modelTokens: byModel };
}

/** Adds one cost's per-model counters onto a running total's. */
export function addModelTokens(total: SessionCost, part: SessionCost): void {
  if (part.modelTokens === undefined) return;
  total.modelTokens ??= {};
  for (const [model, tokens] of Object.entries(part.modelTokens)) {
    addTokens((total.modelTokens[model] ??= zeroTokens()), tokens);
  }
}
