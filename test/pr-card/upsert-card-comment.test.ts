// Leaving exactly one card comment on the PR, against a fake fetch: nothing here reaches the network.
import { describe, expect, it } from "vitest";
import type { FetchFn } from "../../src/pr-card/github-comments.js";
import { CARD_MARKER } from "../../src/pr-card/render-pr-card.js";
import { upsertCardComment } from "../../src/pr-card/upsert-card-comment.js";

const target = { owner: "acme", repo: "tool", number: 42 };
const TOKEN = "ghp_secret0123456789";
const LIST = "https://api.github.com/repos/acme/tool/issues/42/comments?per_page=100";
const CREATE = "https://api.github.com/repos/acme/tool/issues/42/comments";
const card = `${CARD_MARKER}\n### Session\nnew`;

interface Call {
  method: string;
  url: string;
}

type Answer = { status: number; json: unknown };

/** A fetch that answers by method and URL, and records each call; an unexpected call fails the test. */
function routedFetch(routes: Record<string, Answer>): { fetchFn: FetchFn; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    const method = init.method ?? "GET";
    calls.push({ method, url });
    const answer = routes[`${method} ${url}`];
    if (!answer) throw new Error(`unexpected ${method} ${url}`);
    return new Response(JSON.stringify(answer.json), { status: answer.status });
  };
  return { fetchFn, calls };
}

const other = { id: 1, body: "looks good", updated_at: "2026-10-18T09:00:00Z" };
const oldCard = { id: 5, body: `${CARD_MARKER}\n### Session\nold`, updated_at: "2026-10-18T10:00:00Z" };

describe("upsertCardComment", () => {
  it("creates the card when the PR has none", async () => {
    const { fetchFn, calls } = routedFetch({
      [`GET ${LIST}`]: { status: 200, json: [other] },
      [`POST ${CREATE}`]: { status: 201, json: { id: 77 } },
    });
    expect(await upsertCardComment(target, card, TOKEN, fetchFn)).toEqual({ action: "created", id: 77 });
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]);
  });

  it("updates the card findCardComment picks", async () => {
    const newer = { ...oldCard, id: 6, updated_at: "2026-10-18T11:00:00Z" };
    const { fetchFn, calls } = routedFetch({
      [`GET ${LIST}`]: { status: 200, json: [other, oldCard, newer] },
      ["PATCH https://api.github.com/repos/acme/tool/issues/comments/6"]: { status: 200, json: { id: 6 } },
    });
    expect(await upsertCardComment(target, card, TOKEN, fetchFn)).toEqual({ action: "updated", id: 6 });
    expect(calls.map((c) => c.method)).toEqual(["GET", "PATCH"]);
  });

  it("creates a new card when the one found was deleted before the update", async () => {
    const { fetchFn, calls } = routedFetch({
      [`GET ${LIST}`]: { status: 200, json: [oldCard] },
      ["PATCH https://api.github.com/repos/acme/tool/issues/comments/5"]: { status: 404, json: { message: "Not Found" } },
      [`POST ${CREATE}`]: { status: 201, json: { id: 78 } },
    });
    expect(await upsertCardComment(target, card, TOKEN, fetchFn)).toEqual({ action: "created", id: 78 });
    expect(calls.map((c) => c.method)).toEqual(["GET", "PATCH", "POST"]);
  });

  it("rethrows any other update failure without creating a second card", async () => {
    const { fetchFn, calls } = routedFetch({
      [`GET ${LIST}`]: { status: 200, json: [oldCard] },
      ["PATCH https://api.github.com/repos/acme/tool/issues/comments/5"]: { status: 403, json: { message: "Forbidden" } },
    });
    await expect(upsertCardComment(target, card, TOKEN, fetchFn)).rejects.toThrow(/403.*Forbidden/);
    expect(calls.map((c) => c.method)).toEqual(["GET", "PATCH"]);
  });

  it("sends nothing when the card already has this body", async () => {
    const { fetchFn, calls } = routedFetch({ [`GET ${LIST}`]: { status: 200, json: [other, { ...oldCard, body: card }] } });
    expect(await upsertCardComment(target, card, TOKEN, fetchFn)).toEqual({ action: "unchanged", id: 5 });
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("refuses a body that is not a card before any request", async () => {
    for (const body of ["looks good", `### Session\n${CARD_MARKER}`, `${CARD_MARKER} trailing\n### Session`, ""]) {
      const { fetchFn, calls } = routedFetch({});
      await expect(upsertCardComment(target, body, TOKEN, fetchFn)).rejects.toThrow(/marker/);
      expect(calls).toHaveLength(0);
    }
  });
});
