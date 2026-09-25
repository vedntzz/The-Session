import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { tagTask } from "../../src/jev/tag-task.js";
import type { TaskType } from "../../src/jev/interface.js";

const fetchMock = vi.fn<typeof fetch>();
const input = { intent: "fix CLI", changedPaths: ["src/cli.ts", "test/cli.test.ts"] };
const taskTypes: readonly TaskType[] = ["feature", "fix", "refactor", "test", "docs", "chore"];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("JEV_ENDPOINT", "https://jev.example/advice");
  vi.stubEnv("JEV_API_KEY", "test-key");
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

function respond(value: unknown): void {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(value)));
}

it.each(taskTypes)("returns exact TaskType %s", async (label) => {
  respond({ label, confidence: 0.5 });
  expect(await tagTask(input)).toBe(label);
});

it("sends the tag question, intent and changed paths", async () => {
  respond({ label: "fix", confidence: 0.8 });
  await tagTask(input);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
    question: "tag", intent: input.intent, paths: input.changedPaths,
  });
});

it("uses the default 1000 ms timeout", async () => {
  fetchMock.mockImplementation(() => new Promise(() => {}));
  const result = tagTask(input);
  const signal = fetchMock.mock.calls[0]![1]!.signal!;
  let settled = false;
  void result.then(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(999);
  expect(settled).toBe(false);
  expect(signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(settled).toBe(true);
  expect(await result).toBeNull();
  expect(signal.aborted).toBe(true);
});

it.each(["unknown", "Fix", "bugfix", "FIX", " fix", "fix ", "", null, 42])(
  "rejects unknown or near-miss label %j", async (label) => {
    respond({ label, confidence: 0.5 });
    expect(await tagTask(input)).toBeNull();
  },
);

it.each([0, 1])("accepts confidence boundary %s", async (confidence) => {
  respond({ label: "fix", confidence });
  expect(await tagTask(input)).toBe("fix");
});

it.each([-0.1, 1.1, "0.5", null, true])("rejects bad confidence %j", async (confidence) => {
  respond({ label: "fix", confidence });
  expect(await tagTask(input)).toBeNull();
});

it("rejects a JSON number that overflows to infinity", async () => {
  fetchMock.mockResolvedValue(new Response('{"label":"fix","confidence":1e400}'));
  expect(await tagTask(input)).toBeNull();
});

it.each([null, [], {}, "fix", 1, true, { label: "fix" }, { confidence: 0.5 }])(
  "returns null for malformed or null output %j", async (response) => {
    respond(response);
    expect(await tagTask(input)).toBeNull();
  },
);

it("returns null when the client fails", async () => {
  fetchMock.mockRejectedValue(new Error("offline"));
  expect(await tagTask(input)).toBeNull();
});

it("returns null when the client receives invalid JSON", async () => {
  fetchMock.mockResolvedValue(new Response("not JSON"));
  expect(await tagTask(input)).toBeNull();
});

it("returns null without a request when the client is disabled", async () => {
  vi.stubEnv("JEV_API_KEY", undefined);
  expect(await tagTask(input)).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});
