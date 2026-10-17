// The card's chain line. Pure.
import type { CardChain } from "./card-data.js";

/** One phrase per state, so adding a state is a compile error here. */
const CHAIN_TEXT: Record<CardChain, string> = {
  verified: "signed log verified",
  "hashes-only": "log intact, signature not checked",
  broken: "signed log failed verification",
  missing: "no signed log",
};

/** Whether the signed log checked out, in words. */
export function formatChainStatus(chain: CardChain): string {
  return CHAIN_TEXT[chain];
}
