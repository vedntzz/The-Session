// The values the PR card renders, read off the record `session pr` already transcribes. Pure.
import type { Price } from "../pricing.js";
import type { Session, SessionOutcome } from "../store.js";

type PricedPrice = Extract<Price, { priced: true }>;
type UnpricedPrice = Extract<Price, { priced: false }>;

/** What it cost, or why that cannot be said; an unpriced cost never carries a usd. */
export type CardCost = Pick<PricedPrice, "priced" | "usd"> | (Pick<UnpricedPrice, "priced"> & { reason: string });

/** Whether the log checked out with its signatures, by its hashes alone, broke, or is not there to check. */
export type CardChain = "verified" | "hashes-only" | "broken" | "missing";

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
  outcome: SessionOutcome;
  /** Whether the merged work was later reverted. */
  reverted: boolean;
}
