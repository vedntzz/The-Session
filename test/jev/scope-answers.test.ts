import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { requestScope } from "../../src/jev/scope-answers.js";
import { suggestScope } from "../../src/jev/suggest-scope.js";

const fetchMock = vi.fn<typeof fetch>();
const input = { intent: "fix CLI", candidatePaths: ["src/a.ts"] };
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("JEV_ENDPOINT", "https://api.typesafe.ai/v1/systemone");
  vi.stubEnv("JEV_API_KEY", "test-key");
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); fetchMock.mockReset(); });

it("batches 401 questions as 200, 200, 1 with full state and stable answer IDs", async () => {
  const candidatePaths = Array.from({ length: 401 }, (_, i) => `src/${i}.ts`);
  fetchMock.mockImplementation(async (_url, options) => {
    const body = JSON.parse(options!.body as string);
    expect(body.state).toEqual({ intent: input.intent, files: candidatePaths });
    return new Response(JSON.stringify({ answers: Object.fromEntries(Object.keys(body.questions).reverse()
      .map((key) => [key, { type: "noul", noul: Number(key.slice(1)) / 500 }])) }));
  });
  const result = await requestScope({ ...input, candidatePaths });
  expect(fetchMock.mock.calls.map(([, options]) => Object.keys(JSON.parse(options!.body as string).questions).length)).toEqual([200, 200, 1]);
  expect(result).toHaveLength(401);
  expect(result?.[400]).toEqual({ path: "src/400.ts", confidence: 0.8, reason: "noul" });
});

it.each([null, {}, { q0: null }, { q0: { type: "choice", noul: 0.5 } }, { q0: { type: "noul", noul: -1 } },
  { q0: { type: "noul", noul: 2 } }, { q0: { type: "noul", noul: "0.5" } }])("rejects malformed answers %j", async (answers) => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ answers })));
  expect(await requestScope(input)).toBeNull();
});

it("times out concurrent batches together after one second", async () => {
  fetchMock.mockImplementation(() => new Promise(() => {}));
  const result = requestScope({ ...input, candidatePaths: Array.from({ length: 201 }, (_, i) => `${i}.ts`) });
  let settled = false;
  void result.then(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(999);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("makes no request for no candidates", async () => {
  expect(await requestScope({ ...input, candidatePaths: [] })).toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("returns no partial ranking when one batch fails", async () => {
  fetchMock.mockImplementation(async (_url, options) => {
    const { questions } = JSON.parse(options!.body as string);
    if ("q200" in questions) throw new Error("offline");
    return new Response(JSON.stringify({ answers: Object.fromEntries(Object.keys(questions)
      .map((key) => [key, { type: "noul", noul: 0.9 }])) }));
  });
  expect(await suggestScope({ ...input, candidatePaths: Array.from({ length: 201 }, (_, i) => `${i}.ts`) })).toEqual([]);
});

it("rejects a noul that overflows to infinity", async () => {
  fetchMock.mockResolvedValue(new Response('{"answers":{"q0":{"type":"noul","noul":1e400}}}'));
  expect(await requestScope(input)).toBeNull();
});
