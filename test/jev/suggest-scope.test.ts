import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { suggestScope } from "../../src/jev/suggest-scope.js";

const fetchMock = vi.fn<typeof fetch>();
const input = { intent: "fix CLI", candidatePaths: ["src/a.ts", "src/b.ts", "src/c.ts"] };
const suggestion = (path = "src/a.ts", confidence = 0.5, reason = "noul") => ({ path, confidence, reason });

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
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ answers: value })));
}

const noul = (noul: unknown) => ({ type: "noul", noul });

it("requests scope with exactly the supplied intent and candidates", async () => {
  respond({ q0: noul(0.5) });
  expect(await suggestScope({ ...input, candidatePaths: ["src/a.ts"] })).toEqual([suggestion()]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
    model: "jev-1.13.0", state: { intent: input.intent, files: ["src/a.ts"] },
    questions: { q0: { type: "noul", instructions: "Will the work in `intent` edit src/a.ts?" } },
  });
});

it("never returns a path outside the exact candidates", async () => {
  respond({ q0: { ...noul(0.5), path: "elsewhere" }, outside: noul(1) });
  expect(await suggestScope({ ...input, candidatePaths: ["src/a.ts"] })).toEqual([suggestion()]);
  expect(await suggestScope({ ...input, candidatePaths: [] })).toEqual([]);
});

it.each([-0.1, 1.1, "0.5", null])("rejects invalid noul %s", async (confidence) => {
  respond({ q0: noul(confidence), q1: noul(0.5), q2: noul(0.5) });
  expect(await suggestScope(input)).toEqual([]);
});

it("accepts confidence boundaries and sorts descending", async () => {
  respond({ q0: noul(0), q1: noul(1), q2: noul(0.5) });
  expect(await suggestScope(input)).toEqual([
    suggestion("src/b.ts", 1), suggestion("src/c.ts", 0.5), suggestion("src/a.ts", 0),
  ]);
});

it("breaks confidence ties by path regardless of response order", async () => {
  const ascending = [suggestion("src/a.ts"), suggestion("src/b.ts")];
  for (const keys of [["q0", "q1"], ["q1", "q0"]]) {
    respond(Object.fromEntries(keys.map((key) => [key, noul(0.5)])));
    expect(await suggestScope({ ...input, candidatePaths: ["src/b.ts", "src/a.ts"] })).toEqual(ascending);
  }
});

it("returns exactly the ten highest-confidence suggestions from twelve valid suggestions", async () => {
  const candidatePaths = Array.from({ length: 12 }, (_, index) => `src/${index}.ts`);
  const suggestions = candidatePaths.map((path, index) => suggestion(path, index / 11));
  respond(Object.fromEntries(suggestions.map((item, index) => [`q${index}`, noul(item.confidence)])));
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


it("keeps the highest noul for duplicate candidate paths", async () => {
  respond({ q0: noul(0.2), q1: noul(0.9), q2: noul(0.4) });
  expect(await suggestScope({ ...input, candidatePaths: ["src/a.ts", "src/a.ts", "src/a.ts"] }))
    .toEqual([suggestion("src/a.ts", 0.9)]);
});
