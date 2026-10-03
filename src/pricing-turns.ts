// A session whose adapter recorded tokens per turn, priced turn by turn at each turn's own model. Pure.
import { priceTokens, rateFor, type Price, type RateTable } from "./pricing.js";
import { zeroTokens, type SessionCost, type TokenCounts } from "./store.js";

type Found = { usd: number; keys: Set<string> };
/** Why a session with Codex cache writes is not priced: whether `input_tokens` already counts them is unverified. */
export const CACHE_WRITE_REASON = "Codex cache writes: billing unverified";

/** Adds one part's money, or names the model no rate covers; "" stands for no model named. */
function pricePart(found: Found, tokens: TokenCounts | null, model: string | null, rates: RateTable): string | undefined {
  if (tokens === null || model === null) return model ?? "";
  const rate = rateFor(model, rates);
  if (rate === undefined) return model;
  found.usd += priceTokens(tokens, rate.rate);
  found.keys.add(rate.key);
  return undefined;
}

/** The session's counters less what its turns account for: tokens from adapters that report no turns. */
function remainder(cost: SessionCost, turns: readonly (TokenCounts | null)[]): TokenCounts | null {
  const left = { ...zeroTokens() };
  const keys = ["inputTokens", "cacheReadTokens", "cacheCreationTokens", "outputTokens"] as const;
  for (const key of keys) left[key] = cost[key] - turns.reduce((sum, tokens) => sum + (tokens?.[key] ?? 0), 0);
  return keys.some((key) => left[key] > 0) ? left : null;
}

/** Every turn at its own model's rate; any turn with no tokens, no model or no rate leaves the session unpriced. */
export function priceByTurn(cost: SessionCost, rates: RateTable): Price {
  if (cost.turnTokens === undefined) return { priced: false, model: cost.model }; // turns counted, tokens never read
  const turns = cost.turnTokens;
  if (turns.some((tokens) => (tokens?.cacheCreationTokens ?? 0) > 0)) return { priced: false, model: cost.model, reason: CACHE_WRITE_REASON };
  const models = cost.turnModels ?? [];
  const found: Found = { usd: 0, keys: new Set() };
  for (let i = 0; i < turns.length; i++) {
    const missing = pricePart(found, turns[i] ?? null, models[i] ?? null, rates);
    if (missing !== undefined) return { priced: false, model: missing };
  }
  // Tokens no turn accounts for came from an adapter that reports none; where it named a model per call, each
  // part is priced at its own rate, and otherwise the remainder at the session's model.
  const missing = cost.modelTokens !== undefined ? priceModels(found, cost.modelTokens, rates)
    : priceRemainder(found, cost, turns, rates);
  if (missing !== undefined) return { priced: false, model: missing };
  const matched = [...found.keys].sort().join(", ");
  return { priced: true, model: cost.model, matched, usd: found.usd, ...(cost.emptyTurnTokens ? { emptyUsd: found.usd } : {}) };
}

function priceRemainder(found: Found, cost: SessionCost, turns: readonly (TokenCounts | null)[], rates: RateTable): string | undefined {
  const rest = remainder(cost, turns);
  return rest === null ? undefined : pricePart(found, rest, cost.model, rates);
}

/** Each model's counters at its own rate; the first model no rate covers, or nothing. */
function priceModels(found: Found, byModel: Readonly<Record<string, TokenCounts>>, rates: RateTable): string | undefined {
  for (const model of Object.keys(byModel).sort()) {
    const missing = pricePart(found, byModel[model]!, model, rates);
    if (missing !== undefined) return missing;
  }
  return undefined;
}

/** A session whose calls named their models, priced model by model (SES-5). */
export function priceByModel(cost: SessionCost, rates: RateTable): Price {
  const found: Found = { usd: 0, keys: new Set() };
  const missing = priceModels(found, cost.modelTokens ?? {}, rates);
  if (missing !== undefined) return { priced: false, model: missing };
  const matched = [...found.keys].sort().join(", ");
  return { priced: true, model: cost.model, matched, usd: found.usd, ...(cost.emptyTurnTokens ? { emptyUsd: found.usd } : {}) };
}
