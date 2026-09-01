import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dominant, mergeCosts, NO_COST } from "../src/capture/adapter.js";
import { createClaudeCodeAdapter } from "../src/capture/adapters/claude-code.js";
import { captureCost } from "../src/capture/index.js";
import { totalTokens, zeroCost, zeroTokens } from "../src/store.js";

let root: string;
let projects: string;

const T = {
  before: "2026-08-15T08:00:00.000Z",
  from: "2026-08-15T09:00:00.000Z",
  during: "2026-08-15T10:00:00.000Z",
  later: "2026-08-15T10:30:00.000Z",
  to: "2026-08-15T11:00:00.000Z",
  after: "2026-08-15T12:00:00.000Z",
};

const WINDOW = { from: T.from, to: T.to };

/** One assistant transcript line, in the shape Claude Code writes. */
function assistant(params: {
  requestId: string;
  timestamp: string;
  tokens?: Partial<Record<string, number>>;
  model?: string;
  tool?: string;
  cwd?: string;
}): string {
  const content: unknown[] = [{ type: "text", text: "..." }];
  if (params.tool !== undefined) {
    content.push({ type: "tool_use", name: params.tool, input: {} });
  }
  return JSON.stringify({
    type: "assistant",
    requestId: params.requestId,
    timestamp: params.timestamp,
    cwd: params.cwd ?? "/repo",
    message: {
      model: params.model ?? "claude-opus-5",
      content,
      usage: {
        input_tokens: params.tokens?.["input"] ?? 0,
        cache_creation_input_tokens: params.tokens?.["cacheWrite"] ?? 0,
        cache_read_input_tokens: params.tokens?.["cacheRead"] ?? 0,
        output_tokens: params.tokens?.["output"] ?? 0,
      },
    },
  });
}

/** A developer-authored prompt: `type: "user"` with plain string content. */
function prompt(timestamp: string, text = "do the thing"): string {
  return JSON.stringify({
    type: "user",
    timestamp,
    cwd: "/repo",
    message: { role: "user", content: text },
  });
}

/** The harness feeding a tool result back to the agent — not a new turn. */
function toolResult(timestamp: string): string {
  return JSON.stringify({
    type: "user",
    timestamp,
    cwd: "/repo",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] },
  });
}

/**
 * Writes a transcript under a project slug. The mtime defaults to the end of
 * the window, since these fixtures use timestamps that are not "now".
 */
async function transcript(
  name: string,
  lines: string[],
  mtime: Date = new Date(Date.parse(T.to)),
  slug = "-repo",
): Promise<string> {
  const dir = path.join(projects, slug);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${name}.jsonl`);
  await writeFile(file, `${lines.join("\n")}\n`, "utf8");
  await utimes(file, mtime, mtime);
  return file;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-capture-"));
  projects = path.join(root, "projects");
  await mkdir(projects, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("claude-code adapter", () => {
  it("keeps the four token counters separate, since they bill differently", async () => {
    await transcript("a", [
      assistant({
        requestId: "req_1",
        timestamp: T.during,
        tokens: { input: 2, cacheWrite: 8346, cacheRead: 13929, output: 132 },
      }),
    ]);

    const cost = await createClaudeCodeAdapter({ root: projects }).capture(WINDOW);
    expect(cost.inputTokens).toBe(2);
    expect(cost.cacheCreationTokens).toBe(8346);
    expect(cost.cacheReadTokens).toBe(13929);
    expect(cost.outputTokens).toBe(132);
    expect(cost.apiCalls).toBe(1);
    // The sum is still available for display, but only as a derived value.
    expect(totalTokens(cost)).toBe(2 + 8346 + 13929 + 132);
  });

  it("adds each counter across calls without mixing them", async () => {
    await transcript("a", [
      assistant({
        requestId: "req_1",
        timestamp: T.during,
        tokens: { input: 1, cacheWrite: 10, cacheRead: 100, output: 1000 },
      }),
      assistant({
        requestId: "req_2",
        timestamp: T.later,
        tokens: { input: 2, cacheWrite: 20, cacheRead: 200, output: 2000 },
      }),
    ]);

    const cost = await createClaudeCodeAdapter({ root: projects }).capture(WINDOW);
    expect(cost).toMatchObject({
      inputTokens: 3,
      cacheCreationTokens: 30,
      cacheReadTokens: 300,
      outputTokens: 3000,
      apiCalls: 2,
    });
  });

  it("counts a streaming call once, however many fragments it wrote", async () => {
    // Claude Code repeats the identical usage block on every fragment.
    const fragment = assistant({
      requestId: "req_1",
      timestamp: T.during,
      tokens: { input: 100, output: 50 },
    });
    await transcript("a", [fragment, fragment, fragment, fragment]);

    const cost = await createClaudeCodeAdapter({ root: projects }).capture(WINDOW);
    expect(cost.apiCalls).toBe(1);
    expect(cost.inputTokens).toBe(100);
    expect(cost.outputTokens).toBe(50);
  });

  it("counts a fragmented call once, whatever its fragments named", async () => {
    await transcript("a", [
      assistant({ requestId: "req_1", timestamp: T.during, tokens: { output: 10 } }),
      assistant({ requestId: "req_1", timestamp: T.during, tokens: { output: 10 }, tool: "Edit" }),
    ]);

    const cost = await createClaudeCodeAdapter({ root: projects }).capture(WINDOW);
    expect(cost.apiCalls).toBe(1);
    expect(cost.outputTokens).toBe(10);
  });

  it("says nothing about what the calls wrote, whichever tools they named", async () => {
    await transcript("a", [
      assistant({ requestId: "req_1", timestamp: T.during, tool: "Edit" }),
      assistant({ requestId: "req_2", timestamp: T.during, tool: "Write" }),
      assistant({ requestId: "req_3", timestamp: T.during, tool: "Bash" }),
      assistant({ requestId: "req_4", timestamp: T.during }),
    ]);

    const cost = await createClaudeCodeAdapter({ root: projects }).capture(WINDOW);
    expect(cost.apiCalls).toBe(4);
    // A transcript names the tool a call used, never what it did to the disk.
    // `Bash` writes files as readily as `Edit` does, so the tool name settles
    // nothing and no figure is derived from it. Absent, not nought.
    expect(cost.callsWithoutEdits).toBeUndefined();
    expect(cost.emptyTurns).toBeUndefined();
    expect(cost.emptyTurnTokens).toBeUndefined();
  });

  it("ignores activity outside the window", async () => {
    await transcript("a", [
      assistant({ requestId: "early", timestamp: T.before, tokens: { output: 1000 } }),
      assistant({ requestId: "inside", timestamp: T.during, tokens: { output: 7 } }),
      assistant({ requestId: "late", timestamp: T.after, tokens: { output: 1000 } }),
    ]);

    const cost = await createClaudeCodeAdapter({ root: projects }).capture(WINDOW);
    expect(cost.apiCalls).toBe(1);
    expect(cost.outputTokens).toBe(7);
  });

  it("skips transcripts last written before the window opened", async () => {
    await transcript(
      "stale",
      [assistant({ requestId: "req_1", timestamp: T.during, tokens: { output: 999 } })],
      new Date(Date.parse(T.before)),
    );

    const cost = await createClaudeCodeAdapter({ root: projects }).capture(WINDOW);
    expect(cost).toEqual(NO_COST);
  });

  it("reads across every project directory", async () => {
    await transcript("a", [assistant({ requestId: "req_1", timestamp: T.during })]);
    await transcript(
      "b",
      [assistant({ requestId: "req_2", timestamp: T.later })],
      undefined,
      "-other",
    );

    const cost = await createClaudeCodeAdapter({ root: projects }).capture(WINDOW);
    expect(cost.apiCalls).toBe(2);
  });

  it("attributes only work from the same checkout when cwd is given", async () => {
    await transcript("a", [
      assistant({ requestId: "here", timestamp: T.during, cwd: "/repo/packages/core" }),
      assistant({ requestId: "elsewhere", timestamp: T.during, cwd: "/somewhere/else" }),
    ]);

    const cost = await createClaudeCodeAdapter({ root: projects }).capture({
      ...WINDOW,
      cwd: "/repo",
    });
    expect(cost.apiCalls).toBe(1);
  });

  it("reports the model that did the most calls", async () => {
    await transcript("a", [
      assistant({ requestId: "req_1", timestamp: T.during, model: "claude-opus-5" }),
      assistant({ requestId: "req_2", timestamp: T.during, model: "claude-opus-5" }),
      assistant({ requestId: "req_3", timestamp: T.during, model: "claude-haiku-4-5" }),
    ]);

    const cost = await createClaudeCodeAdapter({ root: projects }).capture(WINDOW);
    expect(cost.model).toBe("claude-opus-5");
  });

  it("survives malformed and unrelated lines", async () => {
    await transcript("a", [
      "{ not json",
      JSON.stringify({ type: "user", timestamp: T.during }),
      JSON.stringify({ type: "assistant" }), // no requestId
      assistant({ requestId: "req_1", timestamp: T.during, tokens: { output: 5 } }),
      '{"type":"assistant","requestId":"trunc"',
    ]);

    const cost = await createClaudeCodeAdapter({ root: projects }).capture(WINDOW);
    expect(cost.apiCalls).toBe(1);
    expect(cost.outputTokens).toBe(5);
  });

  it("returns zeros when Claude Code has never run here", async () => {
    const adapter = createClaudeCodeAdapter({ root: path.join(root, "absent") });

    await expect(adapter.isAvailable()).resolves.toBe(false);
    await expect(adapter.capture(WINDOW)).resolves.toEqual(NO_COST);
  });

  it("is available once the transcript root exists", async () => {
    await expect(createClaudeCodeAdapter({ root: projects }).isAvailable()).resolves.toBe(true);
  });
});

describe("turn segmentation", () => {
  const at = (minute: number) => `2026-08-15T09:${String(minute).padStart(2, "0")}:00.000Z`;

  it("groups every call after a prompt into one turn", async () => {
    await transcript("a", [
      prompt(at(1)),
      assistant({ requestId: "req_1", timestamp: at(2) }),
      assistant({ requestId: "req_2", timestamp: at(3) }),
      assistant({ requestId: "req_3", timestamp: at(4) }),
    ]);

    const cost = await createClaudeCodeAdapter({ root: projects }).capture(WINDOW);
    expect(cost.turns).toBe(1);
    expect(cost.apiCalls).toBe(3);
  });

  it("starts a new turn at each prompt", async () => {
    await transcript("a", [
      prompt(at(1)),
      assistant({ requestId: "req_1", timestamp: at(2) }),
      prompt(at(3)),
      assistant({ requestId: "req_2", timestamp: at(4) }),
      assistant({ requestId: "req_3", timestamp: at(5) }),
      prompt(at(6)),
      assistant({ requestId: "req_4", timestamp: at(7) }),
    ]);

    const cost = await createClaudeCodeAdapter({ root: projects }).capture(WINDOW);
    expect(cost.turns).toBe(3);
    expect(cost.apiCalls).toBe(4);
  });

  it("does not split on a tool result, which is the harness talking", async () => {
    await transcript("a", [
      prompt(at(1)),
      assistant({ requestId: "req_1", timestamp: at(2), tool: "Bash" }),
      toolResult(at(3)),
      assistant({ requestId: "req_2", timestamp: at(4), tool: "Bash" }),
      toolResult(at(5)),
      assistant({ requestId: "req_3", timestamp: at(6) }),
    ]);

    const cost = await createClaudeCodeAdapter({ root: projects }).capture(WINDOW);
    expect(cost.turns).toBe(1);
    expect(cost.apiCalls).toBe(3);
  });

  it("cuts turns at each prompt and leaves what they produced to the diff", async () => {
    await transcript("a", [
      prompt(at(1)),
      assistant({ requestId: "req_1", timestamp: at(2), tool: "Read" }),
      assistant({ requestId: "req_2", timestamp: at(3), tool: "Bash" }),
      assistant({ requestId: "req_3", timestamp: at(4), tool: "Edit" }),
      prompt(at(5)),
      assistant({ requestId: "req_4", timestamp: at(6), tool: "Read" }),
      assistant({ requestId: "req_5", timestamp: at(7), tool: "Bash" }),
    ]);

    const cost = await createClaudeCodeAdapter({ root: projects }).capture(WINDOW);
    expect(cost.turns).toBe(2);
    expect(cost.apiCalls).toBe(5);
    // The second turn ran `Bash`, which may have written the whole feature or
    // nothing at all. The transcript cannot tell them apart, so the adapter
    // does not guess — `reconcileEmpty` answers it from the diff at `stop`.
    expect(cost.emptyTurns).toBeUndefined();
  });

  it("keeps every token in the total, whichever turn moved it", async () => {
    await transcript("a", [
      prompt(at(1)),
      assistant({ requestId: "req_1", timestamp: at(2), tool: "Edit", tokens: { input: 100 } }),
      prompt(at(3)),
      assistant({
        requestId: "req_2",
        timestamp: at(4),
        tool: "Read",
        tokens: { input: 900, cacheRead: 50_000, cacheWrite: 2_000, output: 300 },
      }),
    ]);

    const cost = await createClaudeCodeAdapter({ root: projects }).capture(WINDOW);

    expect(cost.inputTokens).toBe(1000);
    expect(cost.cacheReadTokens).toBe(50_000);
    expect(totalTokens(cost)).toBe(53_300);
    // No split here. Where every turn was empty the split is the total, and
    // that is settled against the diff; anything else would be the session's
    // total times the share of turns that were empty, which is a number
    // nobody observed.
    expect(cost.emptyTurnTokens).toBeUndefined();
  });

  it("segments in timestamp order even when lines are out of order", async () => {
    await transcript("a", [
      assistant({ requestId: "req_2", timestamp: at(4) }),
      prompt(at(3)),
      assistant({ requestId: "req_1", timestamp: at(2) }),
      prompt(at(1)),
    ]);

    const cost = await createClaudeCodeAdapter({ root: projects }).capture(WINDOW);
    expect(cost.turns).toBe(2);
  });

  it("counts a turn whose prompt predates the window but whose calls do not", async () => {
    await transcript("a", [
      prompt(T.before),
      assistant({ requestId: "early", timestamp: T.before }),
      assistant({ requestId: "inside", timestamp: T.during }),
    ]);

    const cost = await createClaudeCodeAdapter({ root: projects }).capture(WINDOW);
    expect(cost.turns).toBe(1);
    expect(cost.apiCalls).toBe(1);
  });

  it("keeps turns from separate transcripts apart", async () => {
    await transcript("a", [prompt(at(1)), assistant({ requestId: "req_1", timestamp: at(2) })]);
    await transcript(
      "b",
      [prompt(at(3)), assistant({ requestId: "req_2", timestamp: at(4) })],
      undefined,
      "-other",
    );

    const cost = await createClaudeCodeAdapter({ root: projects }).capture(WINDOW);
    expect(cost.turns).toBe(2);
  });

  it("attributes calls made before any prompt to their own turn", async () => {
    await transcript("a", [
      assistant({ requestId: "orphan", timestamp: at(1) }),
      prompt(at(2)),
      assistant({ requestId: "req_1", timestamp: at(3) }),
    ]);

    const cost = await createClaudeCodeAdapter({ root: projects }).capture(WINDOW);
    expect(cost.turns).toBe(2);
  });

  it("does not treat a subagent's prompt as a developer turn", async () => {
    const sidechain = JSON.stringify({
      type: "user",
      timestamp: at(3),
      cwd: "/repo",
      isSidechain: true,
      message: { role: "user", content: "go research this" },
    });
    await transcript("a", [
      prompt(at(1)),
      assistant({ requestId: "req_1", timestamp: at(2) }),
      sidechain,
      assistant({ requestId: "req_2", timestamp: at(4) }),
    ]);

    const cost = await createClaudeCodeAdapter({ root: projects }).capture(WINDOW);
    expect(cost.turns).toBe(1);
    expect(cost.apiCalls).toBe(2);
  });
});

describe("captureCost", () => {
  it("adds up every available adapter", async () => {
    const stub = (name: string, outputTokens: number, apiCalls: number) => ({
      name,
      isAvailable: async () => true,
      capture: async () => ({ ...zeroCost(), outputTokens, apiCalls, model: name }),
    });

    // Tokens, turns and calls: what an adapter can observe on its own. What a
    // session produced is not summed out of adapters here — it is settled once
    // against the diff at `stop`.
    await expect(captureCost(WINDOW, [stub("a", 100, 3), stub("b", 50, 1)])).resolves.toEqual({
      ...zeroCost(),
      outputTokens: 150,
      apiCalls: 4,
      model: "a",
    });
  });

  it("skips adapters that are unavailable", async () => {
    const absent = {
      name: "absent",
      isAvailable: async () => false,
      capture: async () => ({ ...zeroCost(), outputTokens: 999, apiCalls: 9, model: "nope" }),
    };

    await expect(captureCost(WINDOW, [absent])).resolves.toEqual(NO_COST);
  });

  it("treats a failing adapter as zero rather than failing the stop", async () => {
    const broken = {
      name: "broken",
      isAvailable: async () => true,
      capture: async () => {
        throw new Error("transcripts unreadable");
      },
    };

    await expect(captureCost(WINDOW, [broken])).resolves.toEqual(NO_COST);
  });
});

describe("mergeCosts", () => {
  it("is zero for no adapters", () => {
    expect(mergeCosts([])).toEqual(NO_COST);
  });

  it("names the model with the most calls", () => {
    expect(
      mergeCosts([
        { ...zeroCost(), apiCalls: 1, model: "small" },
        { ...zeroCost(), apiCalls: 5, model: "big" },
      ]).model,
    ).toBe("big");
  });
});

describe("dominant", () => {
  it("breaks ties by name so the result is deterministic", () => {
    expect(dominant(new Map([["b", 2]]))).toBe("b");
    expect(
      dominant(
        new Map([
          ["b", 2],
          ["a", 2],
        ]),
      ),
    ).toBe("a");
  });

  it("is empty for no counts", () => {
    expect(dominant(new Map())).toBe("");
  });
});
