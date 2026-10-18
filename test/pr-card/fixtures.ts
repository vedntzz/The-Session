// Cards for the PR card tests.
import type { CardData } from "../../src/pr-card/card-data.js";

/** A priced, verified, merged card, with the given fields replaced. */
export function cardDataWith(overrides: Partial<CardData> = {}): CardData {
  return {
    askedFor: "add a retry to the fetch client",
    agents: ["claude-code"],
    files: [{ path: "src/fetch.ts", inScope: true }],
    cost: { priced: true, usd: 0.42 },
    chain: "verified",
    outcome: "merged",
    reverted: false,
    ...overrides,
  };
}
