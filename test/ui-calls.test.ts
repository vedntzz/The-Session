// `session ui`'s evidence panel: an agent that counts no API calls reads —, never 0.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { knownAgents } from "../src/capture/index.js";
import { renderUi, type UiData } from "../src/render/tui/screen.js";
import { initialState } from "../src/render/tui/state.js";
import { zeroCost, type Session, type SessionCost } from "../src/store.js";

beforeEach(() => { vi.stubEnv("TERM", "xterm-256color"); });
afterEach(() => { vi.unstubAllEnvs(); });

function data(cost: Partial<SessionCost>, agents = knownAgents()): UiData {
  const session: Session = {
    id: "11111111-2222-3333-4444-555555555555", repo: "path:/example", intent: "tidy", scope: [], baseline: [],
    reality: ["a.ts"], drift: [], outcome: "open", startCommit: "abc", startedAt: "2026-09-17T12:00:00Z",
    endedAt: "2026-09-17T12:30:00Z", cost: { ...zeroCost(), model: "m", turns: 2, inputTokens: 10, ...cost },
  };
  return { sessions: [session], repo: "example", days: 7, rates: new Map(), agents };
}

const callsLine = (input: UiData): string | undefined =>
  renderUi(input, { ...initialState(), expanded: true, evidence: true }, 160, 65).lines.find((line) => line.includes("API calls"));

describe("the evidence panel's API calls", () => {
  it("counts them for an agent that reports calls", () => {
    expect(callsLine(data({ agents: ["claude-code"], apiCalls: 41 }))).toContain("41 API calls · m");
  });

  it("is a dash for Codex and for a mixed session, never 0", () => {
    expect(callsLine(data({ agents: ["codex"] }))).toContain("— API calls · m");
    expect(callsLine(data({ turnModels: ["gpt-6-astra"] }))).toContain("— API calls");
    expect(callsLine(data({ agents: ["claude-code", "codex"], apiCalls: 9 }))).toContain("— API calls");
  });
});
