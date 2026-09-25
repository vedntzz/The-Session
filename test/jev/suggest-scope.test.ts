import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { suggestScope } from "../../src/jev/suggest-scope.js";

const fetchMock = vi.fn<typeof fetch>();
const input = { intent: "fix CLI", candidatePaths: ["src/a.ts", "src/b.ts", "src/c.ts"] };
const suggestion = (path = "src/a.ts", confidence = 0.5, reason = "related") => ({ path, confidence, reason });

beforeEach(() => {
  vi.stubEnv("JEV_ENDPOINT", "https://jev.example/advice");
  vi.stubEnv("JEV_API_KEY", "test-key");
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

function respond(value: unknown): void {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(value)));
}

it("requests scope with exactly the supplied intent and candidates", async () => {
  respond([suggestion()]);
  expect(await suggestScope(input)).toEqual([suggestion()]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
    question: "scope", intent: input.intent, paths: input.candidatePaths,
  });
});

it("never returns a path outside the exact candidates", async () => {
  respond([suggestion(), suggestion("src/"), suggestion("src/a.ts/child"), suggestion("elsewhere")]);
  expect(await suggestScope(input)).toEqual([suggestion()]);
  expect(await suggestScope({ ...input, candidatePaths: [] })).toEqual([]);
});

it.each([-0.1, 1.1, "0.5", null])("drops invalid confidence %s", async (confidence) => {
  respond([{ ...suggestion(), confidence }, suggestion("src/b.ts")]);
  expect(await suggestScope(input)).toEqual([suggestion("src/b.ts")]);
});

it("accepts confidence boundaries and sorts descending", async () => {
  respond([suggestion("src/a.ts", 0), suggestion("src/b.ts", 1), suggestion("src/c.ts", 0.5)]);
  expect(await suggestScope(input)).toEqual([
    suggestion("src/b.ts", 1), suggestion("src/c.ts", 0.5), suggestion("src/a.ts", 0),
  ]);
});

it("breaks confidence ties by path regardless of response order", async () => {
  const ascending = [suggestion("src/a.ts"), suggestion("src/b.ts")];
  for (const response of [ascending, [...ascending].reverse()]) {
    respond(response);
    expect(await suggestScope(input)).toEqual(ascending);
  }
});

it("returns exactly the ten highest-confidence suggestions from twelve valid suggestions", async () => {
  const candidatePaths = Array.from({ length: 12 }, (_, index) => `src/${index}.ts`);
  const suggestions = candidatePaths.map((path, index) => suggestion(path, index / 11));
  respond(suggestions);
  const result = await suggestScope({ ...input, candidatePaths });
  expect(result).toHaveLength(10);
  expect(result).toEqual(suggestions.slice(2).reverse());
  expect(result[0]).toEqual(suggestion("src/11.ts", 1));
});

it.each([null, {}, "bad", 1, true])("returns an empty list for malformed output %j", async (value) => {
  respond(value);
  expect(await suggestScope(input)).toEqual([]);
});

it("returns an empty list when the client fails", async () => {
  fetchMock.mockRejectedValue(new Error("offline"));
  expect(await suggestScope(input)).toEqual([]);
});

it("returns an empty list for invalid JSON", async () => {
  fetchMock.mockResolvedValue(new Response("not JSON"));
  expect(await suggestScope(input)).toEqual([]);
});

