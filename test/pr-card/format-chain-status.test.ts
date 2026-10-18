// The card's chain line: whether the signed log checked out, in words.
import { describe, expect, it } from "vitest";
import type { CardChain } from "../../src/pr-card/card-data.js";
import { formatChainStatus } from "../../src/pr-card/format-chain-status.js";

const EMOJI = /\p{Extended_Pictographic}/u;
const CHAINS: CardChain[] = ["verified", "hashes-only", "broken", "missing"];

describe("formatChainStatus", () => {
  it("says a verified log is verified", () => {
    expect(formatChainStatus("verified")).toBe("signed log verified");
  });

  it("says when only the hashes were checked, not the signatures", () => {
    expect(formatChainStatus("hashes-only")).toBe("log intact, signature not checked");
  });

  it("says a broken log failed verification", () => {
    expect(formatChainStatus("broken")).toBe("signed log failed verification");
  });

  it("says when there is no log to check", () => {
    expect(formatChainStatus("missing")).toBe("no signed log");
  });

  it("uses no emoji", () => {
    for (const chain of CHAINS) {
      expect(formatChainStatus(chain)).not.toMatch(EMOJI);
    }
  });
});
