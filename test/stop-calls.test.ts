// `session stop`'s cost line: an agent that counts no API calls reads —, never 0, and is not hidden.
import { describe, expect, it } from "vitest";
import { formatStopped } from "../src/commands/stop.js";
import { zeroCost, type Session, type SessionCost } from "../src/store.js";

function stopped(cost: Partial<SessionCost>): Session {
  return {
    id: "s1", repo: "remote:x", intent: "tidy", scope: [], baseline: [], reality: ["a.ts"], drift: [], outcome: "open",
    cost: { ...zeroCost(), model: "m", turns: 2, inputTokens: 1_000, ...cost },
    startedAt: "2026-09-26T10:00:00.000Z", endedAt: "2026-09-26T11:00:00.000Z", startCommit: "abc",
  };
}

const costLine = (cost: Partial<SessionCost>): string | undefined =>
  formatStopped(stopped(cost)).find((line) => line.startsWith("  cost"));

describe("formatStopped, api calls", () => {
  it("counts them for an agent that reports calls", () => {
    expect(costLine({ agents: ["claude-code"], apiCalls: 41 })).toBe("  cost     1,000 tokens  2 turns  (41 api calls)");
  });

  it("prints the line for a Codex session, calls as a dash", () => {
    expect(costLine({ agents: ["codex"] })).toBe("  cost     1,000 tokens  2 turns  (— api calls)");
    expect(costLine({ turnModels: ["gpt-6-astra", "gpt-6-astra"] })).toMatch(/\(— api calls\)$/);
  });

  it("is a dash for a mixed session: one agent's count is not the session's", () => {
    expect(costLine({ agents: ["claude-code", "codex"], apiCalls: 9 })).toMatch(/\(— api calls\)$/);
  });

  it("still prints no cost line when nothing was captured", () => {
    expect(costLine({ turns: 0, inputTokens: 0, agents: [] })).toBeUndefined();
  });
});
