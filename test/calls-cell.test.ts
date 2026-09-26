// `week <id> --full`: an agent that counts no API calls reads as a dash, never 0.
import { describe, expect, it } from "vitest";
import { knownAgents } from "../src/capture/index.js";
import { plainPalette } from "../src/render/palette.js";
import { formatSession, type View } from "../src/render/terminal.js";
import { zeroCost, type Session, type SessionCost } from "../src/store.js";

const view: View = { rates: new Map(), agents: knownAgents() };

function session(cost: Partial<SessionCost>): Session {
  return {
    id: "11111111-2222-3333-4444-555555555555", repo: "remote:github.com/acme/tool", intent: "tidy",
    scope: [], baseline: [], reality: ["a.ts"], drift: [], outcome: "open",
    cost: { ...zeroCost(), model: "m", turns: 2, inputTokens: 10, ...cost },
    startedAt: "2026-09-20T10:00:00.000Z", endedAt: "2026-09-20T11:00:00.000Z", startCommit: "abc1234",
  };
}

const noEdits = (cost: Partial<SessionCost>, with_: View = view): string =>
  formatSession(session(cost), plainPalette, with_).find((line) => line.trimStart().startsWith("no edits"))!;

describe("the api calls beside `no edits`", () => {
  it("counts them for an agent that reports calls", () => {
    expect(noEdits({ agents: ["claude-code"], apiCalls: 9 })).toMatch(/9 api calls$/);
  });

  it("is a dash for Codex, recorded or read off an older record", () => {
    expect(noEdits({ agents: ["codex"] })).toMatch(/— api calls$/);
    expect(noEdits({ turnModels: ["gpt-6-astra"] })).toMatch(/— api calls$/);
    expect(noEdits({ agents: ["codex"] })).not.toMatch(/\b0 api calls/);
  });

  it("is a dash for a mixed session: one agent's count is not the session's", () => {
    expect(noEdits({ agents: ["claude-code", "codex"], apiCalls: 9 })).toMatch(/— api calls$/);
  });

  it("keeps the old count where no agent is recorded or recognised", () => {
    expect(noEdits({ apiCalls: 4 }, { rates: new Map() })).toMatch(/4 api calls$/);
  });
});
