// Three capture bugs, reproduced against fixture transcripts. Each fails today and states the answer a fix must give.
import { copyFile, mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CaptureWindow } from "../src/capture/adapter.js";
import { createClaudeCodeAdapter } from "../src/capture/adapters/claude-code.js";
import { createCodexAdapter } from "../src/capture/adapters/codex.js";
import { captureCost } from "../src/capture/index.js";
import { priceSession, priceTokens, type ModelRate, type RateTable } from "../src/pricing.js";

const FIXTURES = path.join(import.meta.dirname, "fixtures/capture-bugs");
const BOUND = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const MIXED = "33333333-3333-4333-8333-333333333333";
const ROLLOUT = "rollout-2026-08-15T08-50-00-44444444-4444-4444-8444-444444444444.jsonl";

const WINDOW: CaptureWindow = { from: "2026-08-15T09:00:00.000Z", to: "2026-08-15T11:00:00.000Z", cwd: "/repo" };
const MTIME = new Date(Date.parse(WINDOW.to));

let root: string;

/** Copies a fixture into place with an mtime inside the window, since the adapters skip files untouched since `from`. */
async function place(name: string, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await copyFile(path.join(FIXTURES, name), file);
  await utimes(file, MTIME, MTIME);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "capture-bugs-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("attribution binds to one agent session, not a time window", () => {
  it("counts only the bound Claude Code session when another runs in the same cwd at the same time", async () => {
    const projects = path.join(root, "projects");
    await place(`${BOUND}.jsonl`, path.join(projects, "-repo"));
    await place(`${OTHER}.jsonl`, path.join(projects, "-repo"));

    // The binding: the agent's own session id, as its hook payload names it. Nothing carries it today.
    const window: CaptureWindow & { agentSessionId: string } = { ...WINDOW, agentSessionId: BOUND };
    const cost = await captureCost(window, [createClaudeCodeAdapter({ root: projects })]);

    expect(cost).toMatchObject({
      inputTokens: 10 + 20,
      cacheCreationTokens: 100 + 200,
      cacheReadTokens: 1000 + 2000,
      outputTokens: 50 + 60,
      apiCalls: 2,
      turns: 1,
    });
  });
});

describe("a Claude session that used two models", () => {
  const OPUS: ModelRate = { input: 5, cacheRead: 0.5, cacheCreation: 6.25, output: 25 };
  const HAIKU: ModelRate = { input: 1, cacheRead: 0.1, cacheCreation: 1.25, output: 5 };
  const RATES: RateTable = new Map([["claude-opus-5", OPUS], ["claude-haiku-4-5", HAIKU]]);
  const tokens = (input: number, cacheCreation: number, cacheRead: number, output: number) =>
    ({ inputTokens: input, cacheCreationTokens: cacheCreation, cacheReadTokens: cacheRead, outputTokens: output });

  it("prices each call at its own model's rate, never every call at the dominant model's", async () => {
    const projects = path.join(root, "projects");
    await place(`${MIXED}.jsonl`, path.join(projects, "-repo"));

    const cost = await createClaudeCodeAdapter({ root: projects }).capture(WINDOW);
    const price = priceSession(cost, RATES);

    const expected =
      priceTokens(tokens(10, 1000, 20000, 500), OPUS) +
      priceTokens(tokens(400, 2000, 30000, 800), HAIKU) +
      priceTokens(tokens(300, 500, 10000, 200), HAIKU);
    expect(price.priced).toBe(true);
    expect(price.priced && price.usd).toBeCloseTo(expected, 10);
    expect(price.priced && price.matched).toBe("claude-haiku-4-5, claude-opus-5");
  });
});

describe("a Codex turn that straddles the window", () => {
  it("counts each token_count by its own timestamp, not by when its turn started", async () => {
    const sessions = path.join(root, "sessions");
    await place(ROLLOUT, path.join(sessions, "2026", "08", "15"));

    const cost = await createCodexAdapter({ root: sessions }).capture(WINDOW);

    // turn-early started 08:55, before `from`: its 09:10 event is inside and counts, its 08:56 event does not.
    // turn-late started 10:50, inside: its 10:55 event counts, its 11:05 event is after `to` and does not.
    const early = { inputTokens: 2000 - 800, cacheReadTokens: 800, cacheCreationTokens: 0, outputTokens: 20 };
    const late = { inputTokens: 3000 - 1200, cacheReadTokens: 1200, cacheCreationTokens: 0, outputTokens: 30 };
    expect(cost).toMatchObject({
      inputTokens: early.inputTokens + late.inputTokens,
      cacheReadTokens: early.cacheReadTokens + late.cacheReadTokens,
      cacheCreationTokens: 0,
      outputTokens: early.outputTokens + late.outputTokens,
    });
    expect(cost.turnTokens).toEqual([early, late]);
  });
});
