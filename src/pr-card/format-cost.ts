// The card's cost text. Pure.
import { formatUsd } from "../pricing.js";
import type { CardCost } from "./card-data.js";

/** Dollars when priced; otherwise the reason, never a figure nobody measured. */
export function formatCost(cost: CardCost): string {
  return cost.priced ? formatUsd(cost.usd) : `unpriced (${cost.reason})`;
}
