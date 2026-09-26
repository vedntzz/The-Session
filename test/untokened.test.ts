// Turns an adapter counted but could not tokenise: counted, never priced at nought.
import { describe, expect, it } from "vitest";
import { mergeCosts } from "../src/capture/adapter.js";
import { emptyTokensOf, emptyTurnsOf, reconcileEmpty } from "../src/empty.js";
import { sessionFigure, spendOf, wasMeasured } from "../src/pricing.js";
import { zeroCost, type Session, type SessionCost } from "../src/store.js";

const RATES = new Map([["gpt-5.6-sol", { input: 1, cacheRead: 1, cacheCreation: 1, output: 1 }]]);
const untokened = (turns: number): SessionCost => ({ ...zeroCost(), turns, untokenedTurns: turns, model: "gpt-5.6-sol" });
const tokened: SessionCost = { ...zeroCost(), turns: 2, apiCalls: 3, inputTokens: 100, model: "claude-x" };

function session(cost: SessionCost, reality: string[] = []): Session {
  return { id: "s", repo: "r", intent: "i", scope: [], baseline: [], reality, drift: [], cost, outcome: "open",
    startedAt: "2026-09-26T00:00:00Z", endedAt: "2026-09-26T01:00:00Z", startCommit: "abc" } as Session;
}

describe("untokened turns", () => {
  it("leave a session unmeasured, so no view prices it at nought", () => {
    expect(wasMeasured(untokened(3))).toBe(false);
    expect(sessionFigure(untokened(3), RATES)).toBeUndefined();
    expect(spendOf([session(untokened(3))], RATES)).toMatchObject({ usd: 0, uncaptured: 1 });
  });

  it("keep a mixed session's partial tokens from reading as its whole cost", () => {
    const merged = mergeCosts([tokened, untokened(2)]);
    expect(merged).toMatchObject({ turns: 4, untokenedTurns: 2, inputTokens: 100 });
    expect(wasMeasured(merged)).toBe(false);
  });

  it("stay absent through a merge where no adapter had any", () => {
    expect("untokenedTurns" in mergeCosts([tokened, tokened])).toBe(false);
  });

  it("still count as empty where git says nothing changed, with no token figure", () => {
    const closed = session(reconcileEmpty(untokened(3), false));
    expect(emptyTurnsOf(closed)).toBe(3);
    expect(closed.cost.emptyTurnTokens).toBeUndefined();
    expect(emptyTokensOf(closed)).toBeUndefined();
  });

  it("have no empty-turn figure where the session changed files", () => {
    expect(emptyTurnsOf(session(reconcileEmpty(untokened(3), true), ["a.ts"]))).toBeUndefined();
  });

  it("keep each turn's model in order across a merge, and name the most-used one", () => {
    const codex = { ...untokened(3), model: "", turnModels: ["gpt-5.6-sol", "gpt-6-astra", "gpt-6-astra"] };
    const merged = mergeCosts([{ ...zeroCost(), turns: 1, turnModels: ["m-a"] }, codex]);
    expect(merged.turnModels).toEqual(["m-a", "gpt-5.6-sol", "gpt-6-astra", "gpt-6-astra"]);
    expect(merged.model).toBe("gpt-6-astra");
  });

  it("name the model by calls first where any adapter made calls", () => {
    const codex = { ...untokened(3), turnModels: ["gpt-6-astra", "gpt-6-astra", "gpt-6-astra"] };
    expect(mergeCosts([tokened, codex]).model).toBe("claude-x");
  });

  it("carry a null model through a merge, and never name it", () => {
    const merged = mergeCosts([{ ...untokened(2), model: "", turnModels: [null, "gpt-6-astra"] }]);
    expect(merged.turnModels).toEqual([null, "gpt-6-astra"]);
    expect(merged.model).toBe("gpt-6-astra");
  });

  it("carry skipped imports through a merge without making them turns", () => {
    const merged = mergeCosts([tokened, { ...zeroCost(), importedTurnsSkipped: 3 }]);
    expect(merged).toMatchObject({ turns: 2, importedTurnsSkipped: 3 });
    expect("importedTurnsSkipped" in mergeCosts([tokened])).toBe(false);
  });
});
