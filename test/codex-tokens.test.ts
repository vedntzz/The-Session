// Codex tokens per turn, from token_count events in the real fixture and in hand-made lines.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mergeCosts } from "../src/capture/adapter.js";
import { costOfTurns } from "../src/capture/adapters/codex.js";
import { zeroCost } from "../src/store.js";
import { emptyRollout, foldRolloutLine, readRollout, splitUsage, turnsOf } from "../src/capture/adapters/codex-rollout.js";

const FIXTURE = path.join(import.meta.dirname, "fixtures/codex/rollout-2026-09-23T19-24-04-01a0d095-5bd9-7d73-871a-b6756ea97139.jsonl");
const usage = (input: number, cached: number, output: number) =>
  ({ input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output });
const line = (type: string, payload: object) => JSON.stringify({ timestamp: "2026-09-23T23:24:50Z", type, payload });
const tokenCount = (last: object, total: object) => line("event_msg", { type: "token_count", info: { last_token_usage: last, total_token_usage: total } });
const fold = (lines: string[]) => {
  const rollout = emptyRollout();
  for (const text of lines) foldRolloutLine(rollout, text);
  return turnsOf(rollout);
};

describe("Codex tokens", () => {
  it("reads each fixture turn's usage, cached input split out of input", async () => {
    const turns = turnsOf(await readRollout(FIXTURE));
    expect(turns.map((turn) => turn.tokens)).toEqual([
      { inputTokens: 33550 - 19328, cacheReadTokens: 19328, cacheCreationTokens: 0, outputTokens: 206 },
      { inputTokens: 39236 - 16256, cacheReadTokens: 16256, cacheCreationTokens: 0, outputTokens: 219 },
      { inputTokens: 39881 - 39040, cacheReadTokens: 39040, cacheCreationTokens: 0, outputTokens: 21 },
    ]);
  });

  it("sums the fixture's turns into the session's four counters, with the tokens per turn kept", async () => {
    const cost = costOfTurns(turnsOf(await readRollout(FIXTURE)));
    expect(cost).toMatchObject({ inputTokens: 14222 + 22980 + 841, cacheReadTokens: 19328 + 16256 + 39040, outputTokens: 446 });
    expect(cost.turnTokens).toHaveLength(3);
  });

  it("counts a total emitted twice in a row once", () => {
    const a = usage(100, 40, 5);
    const turns = fold([line("event_msg", { type: "task_started", turn_id: "t1" }),
      tokenCount(a, { total_tokens: 105 }), tokenCount(a, { total_tokens: 105 }), tokenCount(a, { total_tokens: 210 })]);
    expect(turns[0]!.tokens).toEqual({ inputTokens: 120, cacheReadTokens: 80, cacheCreationTokens: 0, outputTokens: 10 });
  });

  it("gives a turn usage only while it runs, and none after it completes", () => {
    const turns = fold([line("event_msg", { type: "task_started", turn_id: "t1" }), line("event_msg", { type: "task_complete", turn_id: "t1" }),
      tokenCount(usage(10, 0, 1), { total_tokens: 11 })]);
    expect(turns[0]!.tokens).toBeNull();
    expect(costOfTurns(turns)).toMatchObject({ turns: 1, untokenedTurns: 1, turnTokens: [null] });
  });

  it("never lets cached input go below nothing, or be billed as fresh input", () => {
    expect(splitUsage({ input_tokens: 10, cached_input_tokens: 30, output_tokens: 1 })).toEqual(
      { inputTokens: 0, cacheReadTokens: 30, cacheCreationTokens: 0, outputTokens: 1 });
    expect(splitUsage(null)).toEqual({ inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0 });
  });

  it("keeps turnTokens aligned with turnModels through a merge", () => {
    const tokens = { inputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 1 };
    const merged = mergeCosts([{ ...zeroCost(), turns: 1, turnModels: ["a"] }, { ...zeroCost(), turns: 1, turnModels: ["b"], turnTokens: [tokens] }]);
    expect(merged.turnTokens).toEqual([null, tokens]);
  });

  it("records cache writes as reported, subtracting nothing for them", () => {
    expect(splitUsage({ input_tokens: 100, cached_input_tokens: 30, cache_write_input_tokens: 20, output_tokens: 1 })).toEqual(
      { inputTokens: 70, cacheReadTokens: 30, cacheCreationTokens: 20, outputTokens: 1 });
  });
});
