// The fixture builder for the PR card's data: valid defaults, narrow overrides.
import { describe, expect, it } from "vitest";
import { cardDataWith } from "./fixtures.js";

describe("cardDataWith", () => {
  it("defaults to a priced, verified, merged card", () => {
    const card = cardDataWith();
    expect(card.cost).toEqual({ priced: true, usd: expect.any(Number) });
    expect(card.chain).toBe("verified");
    expect(card.outcome).toBe("merged");
    expect(card.reverted).toBe(false);
    expect(card.askedFor).not.toBeNull();
  });

  it("replaces only the fields it is given", () => {
    const card = cardDataWith({ chain: "broken", askedFor: null });
    expect(card).toEqual({ ...cardDataWith(), chain: "broken", askedFor: null });
  });

  it("gives an unpriced cost a reason and never a usd of 0", () => {
    const card = cardDataWith({ cost: { priced: false, reason: "no rate for claude-x" } });
    expect(card.cost).toEqual({ priced: false, reason: "no rate for claude-x" });
    expect(card.cost).not.toHaveProperty("usd");
  });

  it("accepts a session that changed nothing as an outcome", () => {
    expect(cardDataWith({ outcome: "empty" }).outcome).toBe("empty");
  });
});
