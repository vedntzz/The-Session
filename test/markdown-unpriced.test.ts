import { describe, expect, it } from "vitest";
import { CACHE_WRITE_REASON } from "../src/pricing-turns.js";
import { renderMarkdownWeek } from "../src/render/markdown.js";
import type { Session } from "../src/store.js";
import { cost, lines, NOW, on, priced, session } from "./fixtures/markdown.js";

describe("a week with sessions unpriced for a reason no rate fixes", () => {
  // A turn with Codex cache writes, on a model the table has a rate for: the
  // session is unpriced for the reason, not for the model.
  const cacheWrites = (over: Partial<Session> = {}): Session =>
    session({
      startedAt: on(13),
      cost: cost({
        inputTokens: 100_000,
        cacheCreationTokens: 5,
        turnTokens: [{ inputTokens: 100_000, cacheReadTokens: 0, cacheCreationTokens: 5, outputTokens: 0 }],
        turnModels: ["claude-opus-4-1"],
      }),
      ...over,
    });
  const mystery = session({ startedAt: on(14), cost: cost({ model: "mystery-9", inputTokens: 100_000 }) });

  it("states the reason, never a model with no rate", () => {
    const document = renderMarkdownWeek([session({ startedAt: on(12) }), cacheWrites()], 7, priced, NOW);

    expect(document).toContain(
      `The cost below covers 1 of 2 sessions. 1 session could not be priced (${CACHE_WRITE_REASON}).`,
    );
    expect(document).not.toContain("no rate");
  });

  it("names a reason and a missing rate apart, each with its own count", () => {
    const week = [session({ startedAt: on(12) }), cacheWrites(), mystery];

    expect(lines(week).find((line) => line.startsWith("The cost below"))).toBe(
      "The cost below covers 1 of 3 sessions. 1 session ran on a model with no rate (mystery-9). " +
        `1 session could not be priced (${CACHE_WRITE_REASON}).`,
    );
  });

  it("sends nobody to the rates file when no rate would fix any of it", () => {
    const document = renderMarkdownWeek([cacheWrites(), cacheWrites({ startedAt: on(14) })], 7, priced, NOW);

    expect(document).toContain(`2 sessions could not be priced (${CACHE_WRITE_REASON}).`);
    expect(document).not.toContain("Add one to");
    expect(document).not.toContain("no rate");
    expect(document).not.toContain("$0.00");
  });

  it("says why a session that changed nothing could not be priced", () => {
    const empty = cacheWrites({ outcome: "empty", reality: [] });
    const document = renderMarkdownWeek([session({ startedAt: on(12) }), empty], 7, priced, NOW);

    expect(document).toContain(
      "1 session changed no files and is not in the table, " +
        `costing an amount that could not be priced (${CACHE_WRITE_REASON}).`,
    );
    expect(document).not.toContain("no rate");
  });
});
