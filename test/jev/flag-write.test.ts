import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flagWrite } from "../../src/jev/flag-write.js";

const fetchMock = vi.fn<typeof fetch>();
const input = { intent: "fix CLI", attemptedPath: "src/cli.ts", agreedPaths: ["src/", "test/"] };

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

it("sends the attempted path first, followed by the agreed paths", async () => {
  respond({ label: "related", confidence: 0.8 });
  await flagWrite(input);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
    question: "flag", intent: "fix CLI", paths: ["src/cli.ts", "src/", "test/"],
  });
});

it("times out at 300 ms instead of the client default", async () => {
  fetchMock.mockImplementation(() => new Promise(() => {}));
  const result = flagWrite(input);
  const signal = fetchMock.mock.calls[0]![1]!.signal!;
  let settled = false;
  void result.then(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(299);
  expect(settled).toBe(false);
  expect(signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(settled).toBe(true);
  expect(await result).toBeNull();
  expect(signal.aborted).toBe(true);
});

it.each([
  { label: "related", confidence: 0 },
  { label: "unrelated", confidence: 1 },
  { label: "unsure", confidence: 0.5 },
])("returns the advisory label and confidence: %j", async (response) => {
  respond(response);
  expect(await flagWrite(input)).toEqual(response);
});

it.each(["unexpected", "RELATED", "", null, 42])("rejects unknown label %j", async (label) => {
  respond({ label, confidence: 0.5 });
  expect(await flagWrite(input)).toBeNull();
});

it.each([-0.1, 1.1, "0.5", null, true])("rejects bad confidence %j", async (confidence) => {
  respond({ label: "related", confidence });
  expect(await flagWrite(input)).toBeNull();
});

it("rejects a JSON number that overflows to infinity", async () => {
  fetchMock.mockResolvedValue(new Response('{"label":"related","confidence":1e400}'));
  expect(await flagWrite(input)).toBeNull();
});

it.each([null, [], {}, "bad", 1, true, { label: "related" }, { confidence: 0.5 }])(
  "returns null for a malformed or null response: %j", async (response) => {
    respond(response);
    expect(await flagWrite(input)).toBeNull();
  },
);

it("returns only label and confidence, without a decision field", async () => {
  respond({ label: "related", confidence: 0.8, decision: "ignored", extra: "ignored" });
  const result = await flagWrite(input);
  expect(result).toEqual({ label: "related", confidence: 0.8 });
  expect(result).not.toHaveProperty("decision");
});

it("returns null when the client fails", async () => {
  fetchMock.mockRejectedValue(new Error("offline"));
  expect(await flagWrite(input)).toBeNull();
});

it("returns null when the client receives invalid JSON", async () => {
  fetchMock.mockResolvedValue(new Response("not JSON"));
  expect(await flagWrite(input)).toBeNull();
});
