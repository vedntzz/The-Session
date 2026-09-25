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
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ answers: { choice: value } })));
}

function choice(label: unknown, confidence: unknown) {
  return { type: "choice", choice: label, confidence: 1, probabilities: {
    ...Object.fromEntries(taskTypes.map((type) => [type, 0])), [String(label)]: confidence,
    [label === "fix" ? "docs" : "fix"]: typeof confidence === "number" ? 1 - confidence : 0,
  } };
}

it.each(taskTypes)("returns exact TaskType %s", async (label) => {
  respond(choice(label, 0.5));
  expect(await tagTask(input)).toBe(label);
});

it("sends the tag question, intent and changed paths", async () => {
  respond(choice("fix", 0.8));
  await tagTask(input);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
  expect(body.state).toEqual({ intent: input.intent, files: input.changedPaths });
  expect(body.questions.choice.type).toBe("choice");
  expect(body.questions.choice.instructions).toContain("`intent`");
  expect(Object.keys(body.questions.choice.criteria)).toEqual(taskTypes);
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
    respond(choice(label, 0.5));
    expect(await tagTask(input)).toBeNull();
  },
);

it.each([0, 1])("accepts confidence boundary %s", async (confidence) => {
  respond(choice("fix", confidence));
  expect(await tagTask(input)).toBe("fix");
});

it.each([-0.1, 1.1, "0.5", null, true])("rejects bad confidence %j", async (confidence) => {
  respond(choice("fix", confidence));
  expect(await tagTask(input)).toBeNull();
});

it("rejects a JSON number that overflows to infinity", async () => {
  fetchMock.mockResolvedValue(new Response('{"answers":{"choice":{"type":"choice","choice":"fix","confidence":1,"probabilities":{"feature":0,"fix":1e400,"refactor":0,"test":0,"docs":0,"chore":0}}}}'));
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
