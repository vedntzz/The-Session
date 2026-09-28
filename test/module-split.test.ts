// Files split by responsibility keep their public surface: every name the old
// module exported still comes from it, and is the same function as the new home's.
import { describe, expect, it } from "vitest";
import * as pricing from "../src/pricing.js";
import * as rates from "../src/pricing-rates.js";
import * as spend from "../src/pricing-spend.js";
import * as brief from "../src/render/terminal/brief.js";
import * as sentences from "../src/render/terminal/brief-sentences.js";
import * as session from "../src/render/terminal/session.js";
import * as sessionCost from "../src/render/terminal/session-cost.js";
import * as sessionPaths from "../src/render/terminal/session-paths.js";

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

  it("re-exports the rates file, its stub and its loading from pricing-rates.ts", () => {
    for (const name of [
      "RATES_FILE",
      "USER_RATES_FILE",
      "bundledRatesFile",
      "loadChecked",
      "loadRates",
      "parseChecked",
      "parseRates",
      "rateStub",
    ] as const) {
      expect(pricing[name]).toBe(rates[name]);
    }
  });

  it("still finds the bundled rates.json beside the package", async () => {
    expect(new URL(rates.bundledRatesFile()).pathname.endsWith("/rates.json")).toBe(true);
    expect((await rates.loadRates()).size).toBeGreaterThan(0);
  });
});

describe("brief.ts, split", () => {
  it("exports exactly what it did before the split", () => {
    expect(Object.keys(brief)).toEqual(["formatBrief"]);
  });

  it("takes its three sentences from brief-sentences.ts", () => {
    expect(Object.keys(sentences).sort()).toEqual(["WHERE_IT_WENT", "askedFor", "wentOutside"]);
  });
});

describe("session.ts, split", () => {
  it("exports exactly what it did before the split", () => {
    expect(Object.keys(session)).toEqual(["formatSession"]);
  });

  it("takes its path rows from session-paths.ts", () => {
    expect(Object.keys(sessionPaths).sort()).toEqual([
      "changedLines",
      "declaredLine",
      "labelledPaths",
      "outsideLines",
    ]);
  });

  it("takes its cost rows from session-cost.ts", () => {
    expect(Object.keys(sessionCost).sort()).toEqual(["costLines", "pricesLines"]);
  });
});
