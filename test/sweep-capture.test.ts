// SES-5: the edges around per-model pricing.
import { describe, expect, it } from "vitest";
import { mergeCosts } from "../src/capture/adapter.js";
import { modelTokensOf } from "../src/capture/model-tokens.js";
import { priceSession, type ModelRate, type RateTable } from "../src/pricing.js";
import { zeroCost, type SessionCost } from "../src/store.js";

const OPUS: ModelRate = { input: 5, cacheRead: 0.5, cacheCreation: 6.25, output: 25 };
const HAIKU: ModelRate = { input: 1, cacheRead: 0.1, cacheCreation: 1.25, output: 5 };
const GPT: ModelRate = { input: 2, cacheRead: 0.2, cacheCreation: 0, output: 10 };
const RATES: RateTable = new Map([["claude-opus-5", OPUS], ["claude-haiku-4-5", HAIKU], ["gpt-5.5", GPT]]);
const tokens = (input: number, output: number) => ({ inputTokens: input, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: output });
const usd = (cost: SessionCost) => { const price = priceSession(cost, RATES); return price.priced ? price.usd : undefined; };

describe("SES-5: tokens kept per model", () => {
  it("leaves out a model whose calls carried no tokens, such as a synthetic entry", () => {
    const byModel = modelTokensOf([{ model: "claude-opus-5", ...tokens(10, 5) }, { model: "<synthetic>", ...tokens(0, 0) }]);
    expect(byModel).toEqual({ modelTokens: { "claude-opus-5": tokens(10, 5) } });
    expect(modelTokensOf([{ model: "<synthetic>", ...tokens(0, 0) }])).toEqual({});
  });

  it("still prices a record from before the split at the model it names", () => {
    const legacy: SessionCost = { ...zeroCost(), ...tokens(1_000_000, 0), turns: 1, apiCalls: 1, model: "claude-opus-5" };
    expect(usd(legacy)).toBeCloseTo(5, 10);
  });

  it("is unpriced, naming the model, when one of the models has no rate", () => {
    const cost: SessionCost = { ...zeroCost(), ...tokens(2, 2), turns: 1, apiCalls: 2, model: "claude-opus-5",
      modelTokens: { "claude-opus-5": tokens(1, 1), "claude-nova-1": tokens(1, 1) } };
    expect(priceSession(cost, RATES)).toEqual({ priced: false, model: "claude-nova-1" });
  });

  it("prices a session that mixed Claude and Codex by turn and by model, never the remainder at one rate", () => {
    const claude: SessionCost = { ...zeroCost(), ...tokens(2_000_000, 0), turns: 1, apiCalls: 2, model: "claude-haiku-4-5",
      modelTokens: { "claude-opus-5": tokens(1_000_000, 0), "claude-haiku-4-5": tokens(1_000_000, 0) } };
    const codex: SessionCost = { ...zeroCost(), ...tokens(1_000_000, 0), turns: 1, apiCalls: 0, model: "gpt-5.5",
      turnModels: ["gpt-5.5"], turnTokens: [tokens(1_000_000, 0)] };
    expect(usd(mergeCosts([claude, codex]))).toBeCloseTo(5 + 1 + 2, 10);
  });
});
