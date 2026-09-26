// `week --open`'s counters: an agent that counts no API calls reads —, never 0.
import { describe, expect, it } from "vitest";
import { knownAgents } from "../src/capture/index.js";
import { renderWeek } from "../src/render/html.js";
import { zeroCost, type Session, type SessionCost } from "../src/store.js";

function page(cost: Partial<SessionCost>, agents = knownAgents()): string {
  const session: Session = {
    id: "11111111-2222-3333-4444-555555555555", repo: "remote:x", intent: "tidy", scope: [], baseline: [],
    reality: ["a.ts"], drift: [], outcome: "open", startCommit: "abc", startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(), cost: { ...zeroCost(), model: "m", turns: 2, inputTokens: 10, ...cost },
  };
  return renderWeek([session], 7, {}, { rates: new Map(), agents });
}

/** The value printed under the `API calls` term. */
const calls = (html: string): string | undefined => html.match(/<dt>API calls<\/dt><dd><span class="big [a-z]+">([^<]*)</)?.[1];

describe("the API calls counter", () => {
  it("counts them for an agent that reports calls", () => {
    expect(calls(page({ agents: ["claude-code"], apiCalls: 1_234 }))).toBe("1,234");
  });

  it("is a dash for Codex and for a mixed session, never 0", () => {
    expect(calls(page({ agents: ["codex"] }))).toBe("—");
    expect(calls(page({ turnModels: ["gpt-6-astra"] }))).toBe("—");
    expect(calls(page({ agents: ["claude-code", "codex"], apiCalls: 9 }))).toBe("—");
  });

  it("keeps the recorded count where no agent is described", () => {
    expect(calls(page({ apiCalls: 4 }, []))).toBe("4");
  });
});
