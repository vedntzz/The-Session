import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dominant, mergeCosts, NO_COST } from "../src/capture/adapter.js";
import { createClaudeCodeAdapter } from "../src/capture/adapters/claude-code.js";
import { captureCost } from "../src/capture/index.js";
import { totalTokens, zeroCost } from "../src/store.js";

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

  it("credits a call that edited in any one of its fragments", async () => {
    await transcript("a", [
      assistant({ requestId: "req_1", timestamp: T.during, tokens: { output: 10 } }),
      assistant({ requestId: "req_1", timestamp: T.during, tokens: { output: 10 }, tool: "Edit" }),
    ]);

    const cost = await createClaudeCodeAdapter({ root: projects }).capture(WINDOW);
    expect(cost.apiCalls).toBe(1);
    expect(cost.callsWithoutEdits).toBe(0);
  });

  it("counts calls that wrote no files", async () => {
    await transcript("a", [
      assistant({ requestId: "req_1", timestamp: T.during, tool: "Edit" }),
      assistant({ requestId: "req_2", timestamp: T.during, tool: "Write" }),
      assistant({ requestId: "req_3", timestamp: T.during, tool: "Bash" }),
      assistant({ requestId: "req_4", timestamp: T.during }),
    ]);

    const cost = await createClaudeCodeAdapter({ root: projects }).capture(WINDOW);
    expect(cost.apiCalls).toBe(4);
    expect(cost.callsWithoutEdits).toBe(2);
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

describe("captureCost", () => {
  it("adds up every available adapter", async () => {
    const stub = (name: string, outputTokens: number, apiCalls: number) => ({
      name,
      isAvailable: async () => true,
      capture: async () => ({ ...zeroCost(), outputTokens, apiCalls, callsWithoutEdits: 1, model: name }),
    });

    await expect(captureCost(WINDOW, [stub("a", 100, 3), stub("b", 50, 1)])).resolves.toEqual({
      ...zeroCost(),
      outputTokens: 150,
      apiCalls: 4,
      callsWithoutEdits: 2,
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
