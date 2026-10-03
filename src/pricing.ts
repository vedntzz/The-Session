import type { SessionCost, TokenCounts } from "./store.js";
import { priceByModel, priceByTurn } from "./pricing-turns.js";
export {
  bundledRatesFile, loadChecked, loadRates, parseChecked, parseRates, RATES_FILE, rateStub, USER_RATES_FILE,
} from "./pricing-rates.js";
export { shippedNote, spendOf, unpricedThroughout, type Spend } from "./pricing-spend.js";

/**
 * What a session cost in money.
 *
 * The four token counters bill at four different rates, which is why the record
 * never collapses them into one figure: a total cannot be turned back into
 * dollars. This is where they are turned into dollars, and it is the only place
 * that knows a price.
 *
 * Prices are data, not code. They live in `rates.json` beside the package and
 * in `~/.session/rates.json` if you keep your own, so a rate change is an edit
 * to a file rather than a release. A model in neither is reported as unpriced —
 * never priced at whatever the nearest model costs, because a guessed rate on
 * an invoice is worse than an admitted gap.
 *
 * What a window adds up to is in `pricing-spend.ts` and the rates file in
 * `pricing-rates.ts`; both are re-exported from here, so callers import one
 * module.
 */

/** Rates for one model, in USD per million tokens. */
export interface ModelRate {
  input: number;
  cacheRead: number;
  cacheCreation: number;
  output: number;
}

/** Model name to its rates. Keyed as written in the file. */
export type RateTable = ReadonlyMap<string, ModelRate>;

/** Rates are quoted per million tokens, which is how vendors publish them. */
const PER = 1_000_000;

// --- pricing, pure -------------------------------------------------------

/** What a set of token counters costs at one model's rates. */
export function priceTokens(tokens: TokenCounts, rate: ModelRate): number {
  return (
    (tokens.inputTokens * rate.input +
      tokens.cacheReadTokens * rate.cacheRead +
      tokens.cacheCreationTokens * rate.cacheCreation +
      tokens.outputTokens * rate.output) /
    PER
  );
}

/** A snapshot date ending a model id: `-20250929`, or `-2024-08-06`. Nothing else. */
const SNAPSHOT_DATE = /-(?:\d{8}|\d{4}-\d{2}-\d{2})$/;

/**
 * The rates entry that covers a model.
 *
 * Exactly, or as the same id with a snapshot date on the end: transcripts
 * report dated ids like `claude-sonnet-4-5-20250929` (or OpenAI's
 * `gpt-4o-2024-08-06`), and a table that had to list every snapshot would be
 * stale the week it shipped. Only a date: any other suffix is another model —
 * `claude-opus-5-5` is not `claude-opus-5`, and neither is `claude-opus-45` or
 * `claude-opus-5-latest` — and pricing it at its neighbour's rate is the guess
 * this table exists to refuse. Such a model is unpriced, by name.
 */
export function rateFor(
  model: string,
  rates: RateTable,
): { key: string; rate: ModelRate } | undefined {
  for (const key of [model, model.replace(SNAPSHOT_DATE, "")]) {
    const rate = rates.get(key);
    if (rate) {
      return { key, rate };
    }
  }
  return undefined;
}

/** What a session cost, or which model stopped it being answerable. */
export type Price =
  | {
      priced: true;
      /** The model as the transcript reported it. */
      model: string;
      /** The rates key that covered it: the model, or the model less its snapshot date. */
      matched: string;
      usd: number;
      /**
       * The part of `usd` spent on turns that changed no files. Undefined on a
       * session captured before that was recorded — an estimate from the turn
       * count would be a number nobody measured.
       *
       * **Never print this without asking `emptyTokensOf` first.** It is
       * priced straight off `cost.emptyTurnTokens`, which is the raw field,
       * and the raw field is exactly what `empty.ts` exists to stand in front
       * of: a record written under the old `tools` rule can carry a whole
       * session's tokens here while having changed files, a figure git refutes
       * and `emptyTurnsOf` refuses. `wasteCell` guards, which is why nothing
       * wrong is shown today. A second caller that reads this field and prints
       * it resurrects the refuted figure — see invariant 4.
       */
      emptyUsd?: number;
    }
  | { priced: false; model: string; reason?: string };

export function isPriced(price: Price): price is Extract<Price, { priced: true }> {
  return price.priced;
}

/** What a session cost. Unpriced when no entry covers the model it ran on. */
export function priceSession(cost: SessionCost, rates: RateTable): Price {
  if (cost.turnTokens !== undefined || (cost.untokenedTurns ?? 0) > 0) return priceByTurn(cost, rates);
  if (cost.modelTokens !== undefined) return priceByModel(cost, rates);
  const found = rateFor(cost.model, rates);
  if (!found) {
    return { priced: false, model: cost.model };
  }
  return {
    priced: true,
    model: cost.model,
    matched: found.key,
    usd: priceTokens(cost, found.rate),
    ...(cost.emptyTurnTokens
      ? { emptyUsd: priceTokens(cost.emptyTurnTokens, found.rate) }
      : {}),
  };
}

/**
 * Whether anything at all was captured for a session.
 *
 * The nought-versus-unknown test at the grain of one session, as
 * `unpricedThroughout` is at the grain of a window. **Turns, and nothing
 * else.** A turn is a prompt somebody sent; a session with none of them had no
 * transcript found for it, and every counter on it is a nought that nobody
 * measured. It may still have changed files — the diff at `stop` sees those
 * whether or not an adapter saw anything — so "it changed nothing" is not the
 * reason and cannot be the test.
 *
 * A session with turns whose tokens come to nothing is the other case, and it
 * keeps `$0.00`: that figure was measured. A turn with no tokens is still a
 * turn captured; `priceSession` leaves its money unpriced, never nought.
 */
export function wasMeasured(cost: Pick<SessionCost, "turns">): boolean {
  return cost.turns > 0;
}

/**
 * One session's money, or nothing where it ran on a model no rate covers.
 *
 * Every surface that prints a per-session figure goes through here, for the
 * same reason every surface that prints a total goes through
 * `unpricedThroughout`. The terminal table and the Markdown one are two views
 * of one record: a row reading an em dash in the terminal and `$0.00` in the
 * document somebody pasted into Notion is this tool failing at the one thing it
 * claims. That is what happened while this carve-out lived in the Markdown
 * renderer alone — and the terminal row disagreed with the footer directly
 * under it, which counted no unpriced sessions and said `$0.00 spent`.
 *
 * `undefined` rather than a word, because the word is the surface's own: a
 * column read at a glance has an em dash to spare, a table read cold spells it
 * out. What may not differ between them is which sessions get it.
 *
 * Two ways to have no figure, and `wasMeasured` is asked first. A session
 * nothing was captured for is not priced at nought: nought is a claim that it
 * was free, and what happened is that no transcript was found — for a session
 * that may well have changed files and billed for it.
 */
export function sessionFigure(cost: SessionCost, rates: RateTable): string | undefined {
  if (!wasMeasured(cost)) {
    return undefined;
  }
  const price = priceSession(cost, rates);
  return price.priced ? formatUsd(price.usd) : undefined;
}

/**
 * Money, as a line of a report reads it.
 *
 * Always two decimal places, so a column of them lines up on the point. A
 * non-zero amount too small to show at that precision reads `<$0.01` rather
 * than `$0.00` — the session cost something, and a rounded nought says it did
 * not.
 */
export function formatUsd(value: number): string {
  if (value > 0 && value < 0.005) {
    return "<$0.01";
  }
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
