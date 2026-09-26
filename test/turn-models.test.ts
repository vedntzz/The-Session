// `week <id>` names the model each turn ran on and the imported turns set aside, from the real fixture.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { costOfTurns } from "../src/capture/adapters/codex.js";
import { readRollout, turnsOf } from "../src/capture/adapters/codex-rollout.js";
import { formatBrief } from "../src/render/terminal/brief.js";
import { formatSession } from "../src/render/terminal/session.js";
import { formatWeek } from "../src/render/terminal/week.js";
import { modelRuns } from "../src/render/terminal/turn-models.js";
import { zeroCost, type Session, type SessionCost } from "../src/store.js";

const FIXTURE = path.join(import.meta.dirname, "fixtures/codex/rollout-2026-09-23T19-24-04-01a0d095-5bd9-7d73-871a-b6756ea97139.jsonl");
const session = (cost: SessionCost): Session => ({ id: "abcdef0123", repo: "r", intent: "codex work", scope: [], baseline: [],
  reality: ["a.ts"], drift: [], cost, outcome: "open", startedAt: "2026-09-23T23:24:00Z", endedAt: "2026-09-23T23:30:00Z", startCommit: "abc" }) as Session;
const fixture = async () => session({ ...costOfTurns(turnsOf(await readRollout(FIXTURE))), importedTurnsSkipped: 2 });

describe("models per turn in week <id>", () => {
  it("collapses runs of one model in order, and names a turn with none unnamed", () => {
    expect(modelRuns(["gpt-5.6-sol", "gpt-6-astra", "gpt-6-astra"])).toBe("gpt-5.6-sol, gpt-6-astra ×2");
    expect(modelRuns([null, "a", null])).toBe("unnamed, a, unnamed");
  });

  it("closes the brief view with the fixture's models and the skipped imports", async () => {
    const lines = formatBrief(await fixture());
    expect(lines.at(-1)).toBe("  turns ran on gpt-5.6-sol, gpt-6-astra ×2 · 2 imported turns skipped, not counted");
  });

  it("gives the full view a row for each", async () => {
    const text = formatSession(await fixture()).join("\n");
    expect(text).toMatch(/models {6}gpt-5\.6-sol, gpt-6-astra ×2/);
    expect(text).toMatch(/imported {4}2 imported turns skipped, not counted/);
  });

  it("adds nothing for a session whose adapter records no per-turn models", () => {
    const plain = session({ ...zeroCost(), turns: 2, apiCalls: 3, model: "claude-x" });
    expect(formatBrief(plain).join("\n")).not.toMatch(/turns ran on|imported/);
    expect(formatSession(plain).join("\n")).not.toMatch(/models|imported/);
  });

  it("says why a session with cache writes is unpriced, and offers no rate stub for it", async () => {
    const base = await fixture();
    const cached = session({ ...base.cost, turnTokens: base.cost.turnTokens!.map((t) => ({ ...t!, cacheCreationTokens: 1 })) });
    const rates = new Map([["gpt-5.6-sol", { input: 1, cacheRead: 1, cacheCreation: 1, output: 1 }]]);
    const week = formatWeek([cached], 7, undefined, {}, { rates }).join("\n");
    expect(week).toMatch(/1 session unpriced: Codex cache writes: billing unverified$/m);
    expect(week).not.toMatch(/save this as|"models"/);
    expect(formatBrief(cached, undefined, { rates }).join("\n")).toMatch(/tokens, unpriced: Codex cache writes: billing unverified/);
  });
});
