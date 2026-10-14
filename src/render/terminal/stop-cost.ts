import { isPriced, priceSession, type RateTable } from "../../pricing.js";
import { totalTokens, type SessionCost } from "../../store.js";
import { unpricedTokens } from "./cost.js";

/**
 * The tokens, and the model where no rate covers it.
 *
 * `stop` reports tokens rather than money — it is the line printed the moment
 * an agent finishes, and the money is what `week` and `week <id>` are for. What it
 * owes the reader is the model, in the same words `week` and `scan` use, so a
 * session that turns up unpriced in the week is recognisable here.
 *
 * Without a rate table nothing is claimed either way. `stop` is called in
 * places that have no rates to hand, and "unpriced" would then mean "nobody
 * asked" rather than "no rate covers this".
 */
export function tokensSpent(cost: SessionCost, rates?: RateTable): string {
  const tokens = `${totalTokens(cost).toLocaleString("en-US")} tokens`;
  if (rates === undefined || isPriced(priceSession(cost, rates))) {
    return tokens;
  }
  return unpricedTokens(cost);
}

