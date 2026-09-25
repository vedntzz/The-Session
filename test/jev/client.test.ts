import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { requestJev } from "../../src/jev/client.js";

const fetchMock = vi.fn<typeof fetch>();

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

it.each(["scope", "flag", "tag"] as const)("posts only question, intent and paths for %s", async (question) => {
  const answer = { label: "related", confidence: 0.8 };
  fetchMock.mockResolvedValue(new Response(JSON.stringify(answer)));
  expect(await requestJev(question, "fix CLI", ["src/cli.ts"])).toEqual(answer);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [endpoint, options] = fetchMock.mock.calls[0]!;
  expect(endpoint).toBe("https://jev.example/advice");
  expect(options).toMatchObject({ method: "POST", redirect: "error",
    headers: { Authorization: "Bearer test-key", "Content-Type": "application/json" } });
  expect(JSON.parse(options!.body as string)).toEqual({ question, intent: "fix CLI", paths: ["src/cli.ts"] });
  expect(vi.getTimerCount()).toBe(0);
});

it.each([undefined, 300])("returns null at the deadline (%s ms override)", async (override) => {
  fetchMock.mockImplementation(() => new Promise(() => {}));
  const result = requestJev("scope", "fix CLI", [], override);
  const signal = fetchMock.mock.calls[0]![1]!.signal!;
  let settled = false;
  void result.then(() => { settled = true; });
  await vi.advanceTimersByTimeAsync((override ?? 1000) - 1);
  expect(settled).toBe(false);
  expect(signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toBeNull();
  expect(signal.aborted).toBe(true);
});

it("bounds the time spent reading the response body", async () => {
  fetchMock.mockResolvedValue(new Response(new ReadableStream()));
  const result = requestJev("scope", "fix CLI", []);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await result).toBeNull();
});

it("returns null on a network error", async () => {
  fetchMock.mockRejectedValue(new Error("offline"));
  expect(await requestJev("scope", "fix CLI", [])).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

it("returns null on a synchronous transport error", async () => {
  fetchMock.mockImplementation(() => { throw new Error("invalid endpoint"); });
  expect(await requestJev("scope", "fix CLI", [])).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

it("returns null on bad JSON", async () => {
  fetchMock.mockResolvedValue(new Response("not JSON"));
  expect(await requestJev("scope", "fix CLI", [])).toBeNull();
});

it("returns null on an HTTP error even with valid JSON", async () => {
  fetchMock.mockResolvedValue(new Response("{}", { status: 503 }));
  expect(await requestJev("scope", "fix CLI", [])).toBeNull();
});

it.each(["JEV_API_KEY", "JEV_ENDPOINT"])("makes no request without %s", async (name) => {
  vi.stubEnv(name, undefined);
  expect(await requestJev("scope", "fix CLI", [])).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([-1, NaN, Infinity])("makes no request with invalid timeout %s", async (timeout) => {
  expect(await requestJev("scope", "fix CLI", [], timeout)).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("preserves attemptedPath first followed by agreedPaths for flag", async () => {
  fetchMock.mockResolvedValue(new Response("{}"));
  await requestJev("flag", "fix CLI", ["src/cli.ts", "src/", "test/"]);
  const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
  expect(body).toEqual({ question: "flag", intent: "fix CLI", paths: ["src/cli.ts", "src/", "test/"] });
});

it.each(["http://jev.example/advice", "ftp://jev.example/advice", "not a URL"])(
  "makes no request to a non-HTTPS or malformed endpoint: %s", async (endpoint) => {
    vi.stubEnv("JEV_ENDPOINT", endpoint);
    expect(await requestJev("scope", "fix CLI", [])).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  },
);
