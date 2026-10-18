// Posting the card as a PR comment through GitHub's REST API, against a fake fetch: nothing here reaches the network.
import { describe, expect, it } from "vitest";
import { CommentGoneError, createComment, listComments, updateComment, type FetchFn } from "../../src/pr-card/github-comments.js";

const target = { owner: "acme", repo: "tool", number: 42 };
const TOKEN = "ghp_secret0123456789";
const card = "<!-- session-card -->\n### Session";

interface Call {
  url: string;
  init: RequestInit;
}

/** A fetch that records each call and answers with `status` and `json`. */
function fakeFetch(status: number, json: unknown): { fetchFn: FetchFn; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
  };
  return { fetchFn, calls };
}

describe("createComment", () => {
  it("POSTs to the PR's issue comments", async () => {
    const { fetchFn, calls } = fakeFetch(201, { id: 7 });
    await createComment(target, card, TOKEN, fetchFn);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.github.com/repos/acme/tool/issues/42/comments");
    expect(calls[0]!.init.method).toBe("POST");
  });

  it("sends the token, GitHub's media type and the pinned API version", async () => {
    const { fetchFn, calls } = fakeFetch(201, { id: 7 });
    await createComment(target, card, TOKEN, fetchFn);
    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("Accept")).toBe("application/vnd.github+json");
    expect(headers.get("X-GitHub-Api-Version")).toBe("2022-11-28");
  });

  it("sends the markdown as the JSON body, and nothing else", async () => {
    const { fetchFn, calls } = fakeFetch(201, { id: 7 });
    await createComment(target, card, TOKEN, fetchFn);
    expect(new Headers(calls[0]!.init.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ body: card });
  });

  it("returns the new comment's id on 201", async () => {
    const { fetchFn } = fakeFetch(201, { id: 123456, body: card, updated_at: "2026-10-18T10:00:00Z" });
    expect(await createComment(target, card, TOKEN, fetchFn)).toBe(123456);
  });

  it("throws with the status and GitHub's message on a non-2xx answer", async () => {
    const { fetchFn } = fakeFetch(403, { message: "Resource not accessible by integration" });
    await expect(createComment(target, card, TOKEN, fetchFn)).rejects.toThrow(
      /403.*Resource not accessible by integration/,
    );
  });

  it("throws on a 2xx answer that names no comment id, rather than returning a guess", async () => {
    const { fetchFn } = fakeFetch(201, { message: "ok" });
    await expect(createComment(target, card, TOKEN, fetchFn)).rejects.toThrow(/no comment id/);
  });

  it("keeps the token out of an error whose GitHub message repeats it", async () => {
    const { fetchFn } = fakeFetch(401, { message: `Bad credentials: ${TOKEN}` });
    const error = await createComment(target, card, TOKEN, fetchFn).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("401");
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it("keeps the token out of an error from fetch itself", async () => {
    const fetchFn: FetchFn = async () => {
      throw new Error(`connect ECONNREFUSED while sending Bearer ${TOKEN}`);
    };
    const error = await createComment(target, card, TOKEN, fetchFn).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("ECONNREFUSED");
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it("keeps the token out of an error whose answer is not JSON", async () => {
    const fetchFn: FetchFn = async () => new Response(`<html>${TOKEN}</html>`, { status: 502 });
    const error = await createComment(target, card, TOKEN, fetchFn).catch((e: Error) => e);
    expect((error as Error).message).toContain("502");
    expect((error as Error).message).not.toContain(TOKEN);
  });
});

describe("updateComment", () => {
  it("PATCHes the comment by id", async () => {
    const { fetchFn, calls } = fakeFetch(200, { id: 99 });
    await updateComment(target, 99, card, TOKEN, fetchFn);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.github.com/repos/acme/tool/issues/comments/99");
    expect(calls[0]!.init.method).toBe("PATCH");
  });

  it("sends the same headers as createComment, and the markdown as the JSON body", async () => {
    const created = fakeFetch(201, { id: 99 });
    await createComment(target, card, TOKEN, created.fetchFn);
    const updated = fakeFetch(200, { id: 99 });
    await updateComment(target, 99, card, TOKEN, updated.fetchFn);
    const want = Object.fromEntries(new Headers(created.calls[0]!.init.headers));
    expect(Object.fromEntries(new Headers(updated.calls[0]!.init.headers))).toEqual(want);
    expect(JSON.parse(String(updated.calls[0]!.init.body))).toEqual({ body: card });
  });

  it("returns the comment's id on 200", async () => {
    const { fetchFn } = fakeFetch(200, { id: 99, body: card });
    expect(await updateComment(target, 99, card, TOKEN, fetchFn)).toBe(99);
  });

  it("throws CommentGoneError on 404, so the caller can post a new comment", async () => {
    const { fetchFn } = fakeFetch(404, { message: "Not Found" });
    const error = await updateComment(target, 99, card, TOKEN, fetchFn).catch((e: Error) => e);
    expect(error).toBeInstanceOf(CommentGoneError);
    expect((error as Error).message).toContain("404");
  });

  it("throws with the status and GitHub's message on any other non-2xx answer", async () => {
    const { fetchFn } = fakeFetch(403, { message: "Resource not accessible by integration" });
    const error = await updateComment(target, 99, card, TOKEN, fetchFn).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(CommentGoneError);
    expect((error as Error).message).toMatch(/403.*Resource not accessible by integration/);
  });

  it("keeps the token out of every error it throws", async () => {
    for (const status of [401, 404, 422, 500]) {
      const { fetchFn } = fakeFetch(status, { message: `Bad: ${TOKEN}` });
      const error = await updateComment(target, 99, card, TOKEN, fetchFn).catch((e: Error) => e);
      expect((error as Error).message).toContain(String(status));
      expect((error as Error).message).not.toContain(TOKEN);
    }
    const thrower: FetchFn = async () => {
      throw new Error(`ECONNRESET Bearer ${TOKEN}`);
    };
    const error = await updateComment(target, 99, card, TOKEN, thrower).catch((e: Error) => e);
    expect((error as Error).message).not.toContain(TOKEN);
  });
});

const FIRST = "https://api.github.com/repos/acme/tool/issues/42/comments?per_page=100";

/** The URL GitHub's Link header gives for page `n`. */
function pageUrl(n: number): string {
  return `https://api.github.com/repositories/1/issues/42/comments?per_page=100&page=${n}`;
}

/** A fetch that answers page n of `total` with `items(n)`, and a Link to page n+1 while one is left. */
function pagedFetch(total: number, items: (n: number) => unknown[]): { fetchFn: FetchFn; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url, init });
    const n = url === FIRST ? 1 : Number(new URL(url).searchParams.get("page"));
    const links = [`<${pageUrl(1)}>; rel="first"`];
    if (n < total) links.unshift(`<${pageUrl(n + 1)}>; rel="next"`, `<${pageUrl(total)}>; rel="last"`);
    return new Response(JSON.stringify(items(n)), { status: 200, headers: { Link: links.join(", ") } });
  };
  return { fetchFn, calls };
}

function comment(id: number): Record<string, unknown> {
  return { id, body: `comment ${id}`, updated_at: `2026-10-18T10:00:${String(id % 60).padStart(2, "0")}Z` };
}

describe("listComments", () => {
  it("GETs the PR's comments a hundred at a time, with the same headers as createComment", async () => {
    const created = fakeFetch(201, { id: 7 });
    await createComment(target, card, TOKEN, created.fetchFn);
    const listed = fakeFetch(200, []);
    await listComments(target, TOKEN, listed.fetchFn);
    expect(listed.calls).toHaveLength(1);
    expect(listed.calls[0]!.url).toBe(FIRST);
    expect(listed.calls[0]!.init.method).toBe("GET");
    expect(listed.calls[0]!.init.body).toBeUndefined();
    const want = new Headers(created.calls[0]!.init.headers);
    want.delete("Content-Type");
    expect(Object.fromEntries(new Headers(listed.calls[0]!.init.headers))).toEqual(Object.fromEntries(want));
  });

  it("follows rel=next until there is none, and returns every page in order", async () => {
    const { fetchFn, calls } = pagedFetch(3, (n) => [comment(n * 10 + 1), comment(n * 10 + 2)]);
    const comments = await listComments(target, TOKEN, fetchFn);
    expect(calls.map((c) => c.url)).toEqual([FIRST, pageUrl(2), pageUrl(3)]);
    expect(comments.map((c) => c.id)).toEqual([11, 12, 21, 22, 31, 32]);
    for (const call of calls) expect(new Headers(call.init.headers).get("Authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("returns the one page when the answer has no Link header", async () => {
    const { fetchFn, calls } = fakeFetch(200, [comment(1), comment(2)]);
    const comments = await listComments(target, TOKEN, fetchFn);
    expect(calls).toHaveLength(1);
    expect(comments.map((c) => c.id)).toEqual([1, 2]);
  });

  it("stops after 20 pages with an error naming the limit", async () => {
    const { fetchFn, calls } = pagedFetch(1000, (n) => [comment(n)]);
    await expect(listComments(target, TOKEN, fetchFn)).rejects.toThrow(/20 pages/);
    expect(calls).toHaveLength(20);
  });

  it("keeps id, body and updated_at, and drops who wrote it", async () => {
    const item = { ...comment(5), user: { login: "octocat", id: 1 }, html_url: "https://github.com/x", author_association: "OWNER" };
    const { fetchFn } = fakeFetch(200, [item, { id: 6, body: null, updated_at: "2026-10-18T11:00:00Z" }]);
    expect(await listComments(target, TOKEN, fetchFn)).toEqual([
      { id: 5, body: "comment 5", updated_at: "2026-10-18T10:00:05Z" },
      { id: 6, body: null, updated_at: "2026-10-18T11:00:00Z" },
    ]);
  });

  it("refuses a next page off api.github.com rather than send the token there", async () => {
    const calls: Call[] = [];
    const fetchFn: FetchFn = async (url, init) => {
      calls.push({ url, init });
      return new Response("[]", { status: 200, headers: { Link: '<https://evil.example/comments?page=2>; rel="next"' } });
    };
    await expect(listComments(target, TOKEN, fetchFn)).rejects.toThrow(/not on https:\/\/api\.github\.com/);
    expect(calls).toHaveLength(1);
  });

  it("throws with the status and GitHub's message on a non-2xx answer", async () => {
    const { fetchFn } = fakeFetch(403, { message: "Resource not accessible by integration" });
    await expect(listComments(target, TOKEN, fetchFn)).rejects.toThrow(/403.*Resource not accessible by integration/);
  });

  it("keeps the token out of every error it throws", async () => {
    for (const status of [401, 404, 500]) {
      const { fetchFn } = fakeFetch(status, { message: `Bad: ${TOKEN}` });
      const error = await listComments(target, TOKEN, fetchFn).catch((e: Error) => e);
      expect((error as Error).message).toContain(String(status));
      expect((error as Error).message).not.toContain(TOKEN);
    }
    const thrower: FetchFn = async () => {
      throw new Error(`ECONNRESET Bearer ${TOKEN}`);
    };
    const error = await listComments(target, TOKEN, thrower).catch((e: Error) => e);
    expect((error as Error).message).not.toContain(TOKEN);
  });
});
