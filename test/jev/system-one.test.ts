import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { requestJev } from "../../src/jev/client.js";

const fetchMock = vi.fn<typeof fetch>();
const questions = { q0: { type: "noul", instructions: "Will the work in `intent` edit src/a.ts?" } };

beforeEach(() => {
  vi.stubEnv("JEV_ENDPOINT", "https://api.typesafe.ai/v1/systemone");
  vi.stubEnv("JEV_API_KEY", "test-key");
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); fetchMock.mockReset(); });

it("posts the pinned model, minimal state and typed questions and returns answers", async () => {
  const answers = { q0: { type: "noul", noul: 0.8 } };
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: {} })));
  expect(await requestJev("fix CLI", ["src/a.ts"], questions)).toEqual(answers);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
    model: "jev-1.13.0", state: { intent: "fix CLI", files: ["src/a.ts"] }, questions,
  });
});

it.each([null, [], 42, "bad", {}, { answers: null }, { answers: [] }, { answers: "bad" }])(
  "returns null for a malformed envelope %j", async (response) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(response)));
    expect(await requestJev("fix CLI", [], questions)).toBeNull();
  },
);

it("returns null on transport failure", async () => {
  fetchMock.mockRejectedValue(new Error("offline"));
  expect(await requestJev("fix CLI", [], questions)).toBeNull();
});
