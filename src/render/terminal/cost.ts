// The cost cells and the ink every view puts them in.
import { formatUsd, rateStub, USER_RATES_FILE, type Price, type RateTable } from "../../pricing.js";
import { totalTokens, type SessionCost, type SessionOutcome } from "../../store.js";
import type { Palette } from "../palette.js";
import { figure, INDENT } from "./text.js";

/**
 * What a view knows beyond the sessions themselves. Both fields are absent in
 * the tests that only care about layout, and a view with no rates prices
 * nothing and says so — which is the same path a genuinely unknown model takes.
 */
export interface View {
  /** The rates in force. See `pricing.ts`. */
  rates?: RateTable;
  /** Whether `--tokens` asked for the raw counters as well. */
  tokens?: boolean;
  /** Whether `--class` asked for the class column as well. */
  classes?: boolean;
}

export const NO_RATES: RateTable = new Map();

/** Where to send a reader whose model has no price on it. */
export const RATES_HINT = USER_RATES_FILE;

/** Stands in for a session whose model carries no price. */
export const NO_PRICE = "—";

/** The money, or the tokens and the reason there is no money. */
export function costCell(cost: SessionCost, price: Price): string {
  if (price.priced) {
    return formatUsd(price.usd);
  }
  const model = cost.model === "" ? "model" : cost.model;
  return `${figure(totalTokens(cost))} tokens, ${model} unpriced`;
}

/** A figure, and whether it is a figure worth raising your voice about. */
export interface Cell {
  text: string;
  /** True when the figure is not zero. See `wasteCell`. */
  spent: boolean;
}

/**
 * What the turns that changed no files came to.
 *
 * `spent` is what decides whether it is printed in red, and it is false at
 * zero: a session that wasted nothing showing `$0.00` in alarm colour would
 * teach the reader to ignore the colour, and then the one that wasted $40
 * would not be seen either. Red has to mean there is something there.
 */
export function wasteCell(cost: SessionCost, price: Price): Cell {
  if (price.priced && price.emptyUsd !== undefined) {
    return { text: formatUsd(price.emptyUsd), spent: price.emptyUsd > 0 };
  }
  if (cost.emptyTurnTokens) {
    const tokens = totalTokens(cost.emptyTurnTokens);
    return { text: `${figure(tokens)} tokens`, spent: tokens > 0 };
  }
  // Captured before the split was recorded. A share of the total worked out
  // from the turn count would look like a measurement and would not be one.
  return { text: "not recorded", spent: false };
}

/** The four counters, spelled out. Only ever shown when `--tokens` asks. */
export function breakdown(cost: SessionCost): string {
  return [
    `${figure(cost.inputTokens)} in`,
    `${figure(cost.cacheReadTokens)} cache read`,
    `${figure(cost.cacheCreationTokens)} cache write`,
    `${figure(cost.outputTokens)} out`,
  ].join(" · ");
}

/**
 * How an outcome is written, wherever one is printed.
 *
 * `open` is left in the terminal's own colour on purpose. It is the ordinary
 * case — most sessions are open most of the time — and a view that colours
 * every outcome emphasises none of them.
 */
export function outcomeInk(palette: Palette, outcome: SessionOutcome): (text: string) => string {
  switch (outcome) {
    case "merged":
      return (text) => palette.merged(text);
    case "abandoned":
      return (text) => palette.abandoned(text);
    default:
      return (text) => text;
  }
}

/**
 * The file to write, whole, under the line that said a price was missing.
 *
 * A pointer at `~/.session/rates.json` tells somebody where to go and not what
 * to put there, and the format is not one anybody knows by heart. This is the
 * whole document with the model already in it, so the answer to an unpriced
 * week is a paste and four numbers.
 *
 * `meta`, like the line above it: it is framing around the figures, and no
 * view earns a colour role for showing a file.
 */
export function stubLines(models: readonly string[], palette: Palette): string[] {
  return rateStub(models)
    .split("\n")
    .map((line) => palette.meta(`${INDENT}${line}`));
}
