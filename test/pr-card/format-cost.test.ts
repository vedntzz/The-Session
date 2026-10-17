// The card's cost text: dollars when priced, the reason when not, never a made-up nought.
import { describe, expect, it } from "vitest";
import { formatCost } from "../../src/pr-card/format-cost.js";

describe("formatCost", () => {
  it("prints a priced cost to the cent", () => {
    expect(formatCost({ priced: true, usd: 1.4 })).toBe("$1.40");
  });

  it("prints a sub-cent cost as under a cent, never $0.00", () => {
    expect(formatCost({ priced: true, usd: 0.004 })).toBe("<$0.01");
  });

  it("groups thousands", () => {
    expect(formatCost({ priced: true, usd: 1234.5 })).toBe("$1,234.50");
  });

  it("names why an unpriced cost has no figure", () => {
    expect(formatCost({ priced: false, reason: "no rate for claude-x" })).toBe("unpriced (no rate for claude-x)");
  });

  it("never prints $0 for an unpriced cost", () => {
    expect(formatCost({ priced: false, reason: "no transcript" })).not.toContain("$0");
  });
});
