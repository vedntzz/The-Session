// `session agents`: rows per agent and source, mixed sessions under each, pending never counted against.
import { describe, expect, it } from "vitest";
import { agentBlocks } from "../src/agents-report.js";
import type { Session, SessionOutcome } from "../src/store.js";
import { event, inputs, merged, row, session } from "./fixtures/agents.js";

describe("agentBlocks", () => {
  it("prints every known agent and every source, even with nothing in them", () => {
    const blocks = agentBlocks([], inputs());
    expect(blocks.map((block) => block.agent)).toEqual(["claude-code", "codex"]);
    expect(blocks[1]!.rows.map((r) => [r.source, r.sessions])).toEqual([["declared", 0], ["primed", 0], ["captured", 0]]);
  });

  it("keeps declared and captured apart under one agent", () => {
    const sessions = [session(["codex"]), session(["codex"], { intentSource: "captured" }), session(["codex"], { intentSource: "captured" })];
    expect(row(sessions, "codex", "declared").sessions).toBe(1);
    expect(row(sessions, "codex", "captured").sessions).toBe(2);
  });

  it("lists a mixed session whole under each agent, and says so", () => {
    const mixed = [session(["claude-code", "codex"])];
    for (const agent of ["claude-code", "codex"]) {
      expect(row(mixed, agent, "declared")).toMatchObject({ sessions: 1, mixed: 1 });
      expect(row(mixed, agent, "declared").spend.usd).toBeCloseTo(1);
    }
  });

  it("puts sessions no adapter captured under their own block, never under an agent", () => {
    const blocks = agentBlocks([session([], {}, { turns: 0, apiCalls: 0 })], inputs());
    expect(blocks.map((block) => block.agent)).toEqual(["claude-code", "codex", null]);
    expect(blocks[2]!.rows[0]!.sessions).toBe(1);
    expect(blocks[2]!.rows[0]).not.toHaveProperty("writes");
    expect(blocks[2]!.rows[0]).not.toHaveProperty("calls");
  });
});

describe("where the work went", () => {
  it("gives counts and never a merge rate, however many merged", () => {
    const sessions = [...Array.from({ length: 6 }, () => merged(["claude-code"], 3)), session(["claude-code"], { outcome: "open" })];
    expect(row(sessions, "claude-code", "declared")).toMatchObject({ merged: 6, abandoned: 0, open: 1 });
    expect(Object.keys(row(sessions, "claude-code", "declared")).filter((key) => /rate/i.test(key))).toEqual([]);
  });

  it("counts abandoned only where marked: a computed one is still open", () => {
    const computed = session(["claude-code"], { outcome: "abandoned" });
    const marked = (): Session => session(["claude-code"], { outcome: "abandoned",
      observations: [{ outcome: "abandoned", observedAt: "2026-09-01T00:00:00Z", commit: "c", branch: "main", source: "manual" }] });
    const opens = Array.from({ length: 10 }, () => session(["claude-code"], { outcome: "open" as SessionOutcome }));
    const sessions = [...Array.from({ length: 4 }, () => merged(["claude-code"], 3)), marked(), computed, ...opens];
    expect(row(sessions, "claude-code", "declared")).toMatchObject({ merged: 4, abandoned: 1, open: 11 });
  });
});

describe("survived 30 days", () => {
  it("rates only closed, checked windows; the young are pending and out of the denominator", () => {
    const sessions = [...Array.from({ length: 5 }, () => merged(["claude-code"], 40, true)),
      ...Array.from({ length: 7 }, () => merged(["claude-code"], 3))];
    const { survival } = row(sessions, "claude-code", "declared");
    expect(survival).toMatchObject({ measured: 5, pending: 7 });
    expect(survival.figures).toMatchObject({ paths: 5, rate: 1 });
  });

  it("prints no rate over fewer than five checked sessions", () => {
    const sessions = Array.from({ length: 4 }, () => merged(["claude-code"], 40, true));
    expect(row(sessions, "claude-code", "declared").survival).toMatchObject({ measured: 4 });
    expect(row(sessions, "claude-code", "declared").survival).not.toHaveProperty("figures");
  });
});

describe("writes, calls and money", () => {
  it("counts the agent's own asks and denials, and no check at all as absent rather than nought", () => {
    const [a, b] = [session(["claude-code", "codex"]), session(["claude-code"])];
    const checks = { [a.id]: [event("claude-code", "ask"), event("claude-code", "silent")], [b.id]: [event("claude-code", "deny")] };
    expect(row([a, b], "claude-code", "declared", inputs(checks)).writes).toEqual({ asked: 1, denied: 1 });
    expect(row([a, b], "codex", "declared", inputs(checks)).writes).toBeUndefined();
  });

  it("sums calls for an agent that counts them, and leaves Codex's unknown", () => {
    const sessions = [session(["claude-code"]), session(["claude-code"]), session(["codex"], {}, { apiCalls: 0 })];
    expect(row(sessions, "claude-code", "declared").calls).toBe(4);
    expect(row(sessions, "codex", "declared").calls).toBeUndefined();
  });

  it("keeps an unpriced session unpriced, never a nought", () => {
    const spend = row([session(["codex"], {}, { model: "gpt-6-astra" })], "codex", "declared").spend;
    expect(spend).toMatchObject({ usd: 0, unpriced: 1, unpricedModels: ["gpt-6-astra"] });
  });
});
