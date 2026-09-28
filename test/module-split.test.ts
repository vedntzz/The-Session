// Files split by responsibility keep their public surface: every name the old
// module exported still comes from it, and is the same function as the new home's.
import { describe, expect, it } from "vitest";
import * as pricing from "../src/pricing.js";
import * as spend from "../src/pricing-spend.js";

describe("pricing.ts, split", () => {
  it("exports exactly what it did before the split", () => {
    expect(Object.keys(pricing).sort()).toEqual([
      "RATES_FILE",
      "USER_RATES_FILE",
      "bundledRatesFile",
      "formatUsd",
      "isPriced",
      "loadChecked",
      "loadRates",
      "parseChecked",
      "parseRates",
      "priceSession",
      "priceTokens",
      "rateFor",
      "rateStub",
      "sessionFigure",
      "shippedNote",
      "spendOf",
      "unpricedThroughout",
      "wasMeasured",
    ]);
  });

  it("re-exports a window's spend from pricing-spend.ts", () => {
    expect(pricing.spendOf).toBe(spend.spendOf);
    expect(pricing.shippedNote).toBe(spend.shippedNote);
    expect(pricing.unpricedThroughout).toBe(spend.unpricedThroughout);
  });
});
