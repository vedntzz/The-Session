// The card's outcome line: where the work landed, in words that pass no verdict on open work.
import { describe, expect, it } from "vitest";
import { formatOutcome } from "../../src/pr-card/format-outcome.js";
import type { SessionOutcome } from "../../src/store.js";

const OUTCOMES: SessionOutcome[] = ["open", "merged", "abandoned", "empty"];
const EMOJI = /\p{Extended_Pictographic}/u;

describe("formatOutcome", () => {
  it("labels each outcome", () => {
    expect(formatOutcome("open", false)).toBe("still open");
    expect(formatOutcome("merged", false)).toBe("merged");
    expect(formatOutcome("abandoned", false)).toBe("didn't ship");
    expect(formatOutcome("empty", false)).toBe("no changes");
  });

  it("marks merged work that was reverted", () => {
    expect(formatOutcome("merged", true)).toBe("merged · reverted");
  });

  it("ignores reverted on work that never merged", () => {
    for (const outcome of OUTCOMES.filter((each) => each !== "merged")) {
      expect(formatOutcome(outcome, true)).toBe(formatOutcome(outcome, false));
    }
  });

  it("never calls open work a failure or waste, nor an empty session waste", () => {
    expect(formatOutcome("open", false)).not.toMatch(/fail|waste/i);
    expect(formatOutcome("empty", false)).not.toMatch(/waste/i);
  });

  it("uses no emoji", () => {
    for (const outcome of OUTCOMES) {
      expect(formatOutcome(outcome, true)).not.toMatch(EMOJI);
      expect(formatOutcome(outcome, false)).not.toMatch(EMOJI);
    }
  });
});
