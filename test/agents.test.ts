// Which agents captured a session, and when its calls are unknown rather than nought.
import { describe, expect, it } from "vitest";
import { agentsOf, callsOf, countsCalls } from "../src/agents.js";
import { captureCost, knownAgents } from "../src/capture/index.js";
import { zeroCost, type SessionCost } from "../src/store.js";

const KNOWN = knownAgents();
const cost = (fields: Partial<SessionCost>): SessionCost => ({ ...zeroCost(), ...fields });
const WINDOW = { from: "2026-09-01T00:00:00.000Z", to: "2026-09-02T00:00:00.000Z" };

describe("agentsOf", () => {
  it("reads the recorded list first, sorted and without repeats", () => {
    expect(agentsOf(cost({ agents: ["codex", "claude-code", "codex"], apiCalls: 0 }), KNOWN)).toEqual(["claude-code", "codex"]);
  });

  it("keeps a recorded empty list: captured, and nothing found", () => {
    expect(agentsOf(cost({ agents: [], apiCalls: 4 }), KNOWN)).toEqual([]);
  });

  it("reads an older record off the counters each adapter alone writes", () => {
    expect(agentsOf(cost({ turns: 2, apiCalls: 4 }), KNOWN)).toEqual(["claude-code"]);
    expect(agentsOf(cost({ turns: 1, turnModels: ["gpt-6-astra"] }), KNOWN)).toEqual(["codex"]);
    expect(agentsOf(cost({ turns: 3, apiCalls: 4, turnModels: ["gpt-6-astra"] }), KNOWN)).toEqual(["claude-code", "codex"]);
    expect(agentsOf(zeroCost(), KNOWN)).toEqual([]);
  });
});

describe("callsOf", () => {
  it("is the count where every agent in the session counts calls", () => {
    expect(callsOf(cost({ agents: ["claude-code"], apiCalls: 9 }), KNOWN)).toBe(9);
  });

  it("is unknown, never nought, where an agent counts no calls", () => {
    expect(callsOf(cost({ agents: ["codex"], apiCalls: 0 }), KNOWN)).toBeUndefined();
    expect(callsOf(cost({ turns: 1, turnModels: ["gpt-6-astra"] }), KNOWN)).toBeUndefined();
  });

  it("is unknown for a mixed session: the count is one agent's, not the session's", () => {
    expect(callsOf(cost({ agents: ["claude-code", "codex"], apiCalls: 9 }), KNOWN)).toBeUndefined();
  });

  it("is unknown for an agent no adapter here describes", () => {
    expect(countsCalls("someone-else", KNOWN)).toBe(false);
    expect(callsOf(cost({ agents: ["someone-else"], apiCalls: 3 }), KNOWN)).toBeUndefined();
  });
});

describe("captureCost records its agents", () => {
  const stub = (name: string, fields: Partial<SessionCost>) => ({
    name, isAvailable: async () => true, capture: async () => cost({ model: name, ...fields }),
  });

  it("names every adapter that found a turn or a call, and none that found nothing", async () => {
    const captured = await captureCost(WINDOW, [stub("b", { turns: 1 }), stub("a", { apiCalls: 2 }), stub("c", {})]);
    expect(captured.agents).toEqual(["a", "b"]);
  });

  it("names none when nothing was found", async () => {
    expect((await captureCost(WINDOW, [stub("a", {})])).agents).toEqual([]);
  });
});
