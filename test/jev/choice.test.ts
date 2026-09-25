import { afterEach, expect, it, vi } from "vitest";
import { requestChoice } from "../../src/jev/choice.js";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function evaluate(answer: unknown) {
  vi.stubEnv("JEV_ENDPOINT", "https://api.typesafe.ai/v1/systemone");
  vi.stubEnv("JEV_API_KEY", "test-key");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ answers: { choice: answer } }))));
  return requestChoice("fix CLI", ["src/a.ts"], "Which option matches `intent`?", { a: null, b: null });
}

it("uses the chosen probability instead of the separate confidence", async () => {
  expect(await evaluate({ type: "choice", choice: "a", confidence: 0.4, probabilities: { a: 0.8, b: 0.2 } }))
    .toEqual({ label: "a", confidence: 0.8 });
});

it.each([null, [], {}, { type: "noul", noul: 0.8 }])("rejects malformed choices %j", async (answer) => {
  expect(await evaluate(answer)).toBeNull();
});

it.each([{ a: 1 }, { a: 0.8, b: -0.2 }, { a: 1, b: 1 }, { a: "1", b: 0 }, { a: 1, c: 0 }])(
  "rejects malformed probability distributions %j", async (probabilities) => {
    expect(await evaluate({ type: "choice", choice: "a", confidence: 0.4, probabilities })).toBeNull();
  },
);

it.each(["A", "unknown", "toString"])("rejects unknown choices %s", async (choice) => {
  expect(await evaluate({ type: "choice", choice, confidence: 1, probabilities: { a: 1, b: 0 } })).toBeNull();
});
