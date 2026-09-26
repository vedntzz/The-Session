// Sessions, rates and a clock for the `week --md` tests.
import type { RateTable } from "../../src/pricing.js";
import { renderMarkdownWeek } from "../../src/render/markdown.js";
import { zeroCost, type Session, type SessionCost } from "../../src/store.js";

/** At $15 per million input tokens, 100,000 input tokens is exactly $1.50. */
export const RATES: RateTable = new Map([
  ["claude-opus-4-1", { input: 15, cacheRead: 1.5, cacheCreation: 18.75, output: 75 }],
]);
export const priced = { rates: RATES };

/**
 * A fixed clock, so the heading is a fact about the arguments rather than
 * about the day the suite runs. Built from a local-time Date for the reason
 * `terminal.test.ts` gives: the formatter prints wall-clock dates, and pinning
 * a timezone here would only test the pin.
 */
export const NOW = new Date(2026, 7, 18, 17, 0);

export function on(day: number, month = 7): string {
  return new Date(2026, month, day, 9, 14).toISOString();
}

export function cost(overrides: Partial<SessionCost> = {}): SessionCost {
  return { ...zeroCost(), model: "claude-opus-4-1", turns: 5, apiCalls: 20, ...overrides };
}

export function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    repo: "remote:github.com/acme/tool",
    intent: "add rate limiting to /orders",
    scope: ["src/api/"],
    baseline: [],
    reality: ["src/api/orders.ts"],
    drift: [],
    cost: cost({ inputTokens: 100_000 }),
    outcome: "merged",
    startedAt: on(12),
    endedAt: on(12),
    startCommit: "abc1234",
    ...overrides,
  };
}

/** The rendered document, split so a test can point at one line. */
export function lines(sessions: readonly Session[], days = 7): string[] {
  return renderMarkdownWeek(sessions, days, priced, NOW).split("\n");
}
