// Codex sessions priced turn by turn at each turn's own model, against the real fixture.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { costOfTurns } from "../src/capture/adapters/codex.js";
import { readRollout, turnsOf } from "../src/capture/adapters/codex-rollout.js";
import { priceSession, sessionFigure, spendOf, wasMeasured, type ModelRate } from "../src/pricing.js";
import { CACHE_WRITE_REASON } from "../src/pricing-turns.js";
import { formatWeek } from "../src/render/terminal/week.js";
import type { Session, SessionCost } from "../src/store.js";

const FIXTURE = path.join(import.meta.dirname, "fixtures/codex/rollout-2026-09-23T19-24-04-01a0d095-5bd9-7d73-871a-b6756ea97139.jsonl");
const SOL: ModelRate = { input: 4, cacheRead: 0.4, cacheCreation: 0, output: 20 };
const ASTRA: ModelRate = { input: 1, cacheRead: 0.1, cacheCreation: 0, output: 10 };
const fixtureCost = async () => costOfTurns(turnsOf(await readRollout(FIXTURE)));
const session = (cost: SessionCost): Session => ({ id: "abcdef0123", repo: "r", intent: "codex work", scope: [], baseline: [],
  reality: ["a.ts"], drift: [], cost, outcome: "open", startedAt: "2026-09-23T23:24:00Z", endedAt: "2026-09-23T23:30:00Z", startCommit: "abc" }) as Session;

describe("pricing Codex turns", () => {
  it("prices each fixture turn at its own model's rate", async () => {
    const price = priceSession(await fixtureCost(), new Map([["gpt-5.6-sol", SOL], ["gpt-6-astra", ASTRA]]));
    const sol = (14222 * 4 + 19328 * 0.4 + 206 * 20) / 1e6;
    const astra = (22980 * 1 + 16256 * 0.1 + 219 * 10 + 841 * 1 + 39040 * 0.1 + 21 * 10) / 1e6;
    expect(price).toMatchObject({ priced: true, matched: "gpt-5.6-sol, gpt-6-astra" });
    expect(price.priced && price.usd).toBeCloseTo(sol + astra, 10);
  });

  it("leaves the session unpriced, naming the model, where one turn's model has no rate", async () => {
    const cost = await fixtureCost();
    expect(priceSession(cost, new Map([["gpt-5.6-sol", SOL]]))).toEqual({ priced: false, model: "gpt-6-astra" });
    expect(sessionFigure(cost, new Map([["gpt-5.6-sol", SOL]]))).toBeUndefined();
  });

  it("leaves a turn with no model named unpriced, never at nought", async () => {
    const cost = { ...(await fixtureCost()), turnModels: [null, "gpt-6-astra", "gpt-6-astra"] };
    expect(priceSession(cost, new Map([["gpt-6-astra", ASTRA]]))).toEqual({ priced: false, model: "" });
    expect(spendOf([session(cost)], new Map([["gpt-6-astra", ASTRA]]))).toMatchObject({ usd: 0, unpriced: 1, unpricedModels: ["unknown"] });
  });

  it("prices tokens from an adapter without turns at the session's model", async () => {
    const base = await fixtureCost();
    const rates = new Map([["gpt-5.6-sol", SOL], ["gpt-6-astra", ASTRA], ["claude-x", SOL]]);
    const [price, alone] = [{ ...base, inputTokens: base.inputTokens + 1_000_000, model: "claude-x" }, base].map((c) => priceSession(c, rates));
    expect(price!.priced && alone!.priced && price!.usd - alone!.usd).toBeCloseTo(4, 10);
  });

  it("leaves a session with Codex cache writes unpriced with the reason, whatever rates there are", async () => {
    const base = await fixtureCost();
    const cost = { ...base, turnTokens: base.turnTokens!.map((t, i) => (i === 1 ? { ...t!, cacheCreationTokens: 5 } : t)) };
    const rates = new Map([["gpt-5.6-sol", SOL], ["gpt-6-astra", ASTRA]]);
    expect(priceSession(cost, rates)).toEqual({ priced: false, model: "gpt-6-astra", reason: CACHE_WRITE_REASON });
    expect(sessionFigure(cost, rates)).toBeUndefined();
    expect(spendOf([session(cost)], rates)).toMatchObject({ usd: 0, unpriced: 1, unpricedModels: [CACHE_WRITE_REASON] });
  });
});

describe("the week footer", () => {
  it("never calls a Codex session with turns uncaptured, and names its unpriced model", async () => {
    const cost = await fixtureCost();
    expect(wasMeasured(cost)).toBe(true);
    const text = formatWeek([session(cost)], 7, undefined, {}, { rates: new Map([["gpt-5.6-sol", SOL]]) }).join("\n");
    expect(text).not.toMatch(/uncaptured/);
    expect(text).toMatch(/unpriced: gpt-6-astra/);
    expect(text).not.toMatch(/\$0\.00/);
  });
});
