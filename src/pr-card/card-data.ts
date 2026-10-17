// The values the PR card renders, read off the record `session pr` already transcribes. Pure.
import type { Price } from "../pricing.js";
import type { Session } from "../store.js";

type PricedPrice = Extract<Price, { priced: true }>;
type UnpricedPrice = Extract<Price, { priced: false }>;

/** What it cost, or why that cannot be said; an unpriced cost never carries a usd. */
export type CardCost = Pick<PricedPrice, "priced" | "usd"> | (Pick<UnpricedPrice, "priced"> & { reason: string });

/** Whether the log's hash chain checked out, broke, or is not there to check. */
export type CardChain = "verified" | "broken" | "missing";

/** Where the pull request landed. */
export type CardOutcome = "merged" | "pending" | "reverted" | "never-merged";

/** One changed path, and whether it sat inside the declared scope. */
export interface CardFile {
  path: string;
  inScope: boolean;
}

/** Everything one PR card shows. */
export interface CardData {
  /** The recorded intent; null means none was recorded. */
  askedFor: Session["intent"];
  agents: string[];
  files: CardFile[];
  cost: CardCost;
  chain: CardChain;
  outcome: CardOutcome;
}
