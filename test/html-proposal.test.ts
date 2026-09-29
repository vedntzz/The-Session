import { describe, expect, it } from "vitest";
import { PRIME_RULE, type PrimeProposal } from "../src/prime.js";
import { declaredPane } from "../src/render/html/detail.js";
import { zeroCost, type Session } from "../src/store.js";

/**
 * The declared pane of the HTML page, for a session that started from a
 * proposal.
 *
 * Two lists, both printed whole: what was proposed, which is immutable like
 * the intent, and what was accepted, which is the only thing drift is ever
 * measured against. A reader a month later should be able to see what was
 * offered, what was dropped from it and what replaced it.
 */

function proposal(scope: string[]): PrimeProposal {
  return {
    proposer: "prime",
    rule: PRIME_RULE,
    intent: "add rate limiting to /orders",
    scope,
    candidates: [],
    history: 4,
    comparable: 2,
    tracked: 120,
    omitted: 0,
  };
}

function session(over: Partial<Session> = {}): Session {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    repo: "remote:github.com/acme/tool",
    intent: "add rate limiting to /orders",
    scope: [],
    baseline: [],
    reality: [],
    drift: [],
    cost: zeroCost(),
    outcome: "open",
    startedAt: "2026-08-20T09:14:00.000Z",
    endedAt: "2026-08-20T09:51:00.000Z",
    startCommit: "abc1234",
    ...over,
  };
}

/** The two panes, split at the second heading. */
function panes(html: string): { proposed: string; accepted: string } {
  const at = html.indexOf('<p class="pane-label">Scope accepted</p>');
  expect(at, "no accepted pane").toBeGreaterThan(-1);
  return { proposed: html.slice(0, at), accepted: html.slice(at) };
}

describe("declaredPane with a proposal", () => {
  it("prints the proposal first and the accepted scope after it", () => {
    const html = declaredPane(session({ scope: ["api/orders.ts"], proposal: proposal(["api/orders.ts"]) }));
    const proposedAt = html.indexOf("Prime proposed — immutable");
    const acceptedAt = html.indexOf("Scope accepted");
    expect(proposedAt).toBeGreaterThan(-1);
    expect(acceptedAt).toBeGreaterThan(proposedAt);
    expect(html).toContain("What was declared · 1 path");
  });

  it("says a proposal accepted whole was accepted whole, in both panes", () => {
    const html = declaredPane(
      session({ scope: ["api/orders.ts", "api/limits.ts"], proposal: proposal(["api/orders.ts", "api/limits.ts"]) }),
    );
    const { proposed, accepted } = panes(html);

    expect(proposed).toContain('<li class="kept">api/orders.ts<span class="tag">accepted</span></li>');
    expect(proposed).toContain('<li class="kept">api/limits.ts<span class="tag">accepted</span></li>');
    expect(proposed).toContain("The proposal was accepted whole");
    expect(proposed).not.toContain("dropped");

    expect(accepted).toContain('<li class="kept">api/orders.ts</li>');
    expect(accepted).toContain('<li class="kept">api/limits.ts</li>');
    expect(accepted).toContain("Nothing was replaced: the accepted scope is the proposal.");
    expect(accepted).not.toContain("replaced the proposal");
  });

  it("keeps a dropped path in the proposal, marked as not accepted", () => {
    const html = declaredPane(
      session({ scope: ["api/orders.ts"], proposal: proposal(["api/orders.ts", "db/schema.sql"]) }),
    );
    const { proposed, accepted } = panes(html);

    expect(proposed).toContain('<li class="dropped">db/schema.sql<span class="tag">not accepted</span></li>');
    expect(proposed).toContain("1 path was not accepted.");
    expect(proposed).toContain("kept exactly as offered");
    expect(accepted).not.toContain("db/schema.sql");
  });

  it("counts several dropped paths in the plural", () => {
    const html = declaredPane(
      session({ scope: ["a.ts"], proposal: proposal(["a.ts", "b.ts", "c.ts"]) }),
    );
    expect(panes(html).proposed).toContain("2 paths were not accepted.");
  });

  it("marks a path the developer added as replacing the proposal", () => {
    const html = declaredPane(
      session({ scope: ["api/orders.ts", "api/new.ts"], proposal: proposal(["api/orders.ts"]) }),
    );
    const { proposed, accepted } = panes(html);

    expect(proposed).not.toContain("api/new.ts");
    expect(accepted).toContain('<li class="kept">api/new.ts<span class="tag">replaced the proposal</span></li>');
    expect(accepted).toContain('<li class="kept">api/orders.ts</li>');
    expect(accepted).toContain("1 path replaced what Prime offered.");
    expect(accepted).toContain("never against the suggestion");
  });

  it("shows a proposal replaced outright: every path dropped, every path added", () => {
    const html = declaredPane(
      session({ scope: ["web/", "docs/"], proposal: proposal(["api/"]) }),
    );
    const { proposed, accepted } = panes(html);

    expect(proposed).toContain('<li class="dropped">api/<span class="tag">not accepted</span></li>');
    expect(proposed).toContain("1 path was not accepted.");
    expect(accepted).toContain("2 paths replaced what Prime offered.");
    expect(html).toContain("What was declared · 2 paths");
  });

  it("lists the proposal in its own order and the accepted scope in its own", () => {
    const html = declaredPane(
      session({ scope: ["z.ts", "a.ts"], proposal: proposal(["b.ts", "a.ts", "z.ts"]) }),
    );
    const { proposed, accepted } = panes(html);
    const order = (pane: string, paths: string[]) => paths.map((p) => pane.indexOf(`>${p}<`));

    const inProposal = order(proposed, ["b.ts", "a.ts", "z.ts"]);
    expect([...inProposal].sort((x, y) => x - y)).toEqual(inProposal);
    const inAccepted = order(accepted, ["z.ts", "a.ts"]);
    expect([...inAccepted].sort((x, y) => x - y)).toEqual(inAccepted);
  });

  it("escapes a path rather than letting it write markup into the page", () => {
    const html = declaredPane(
      session({ scope: ["<b>ok</b>.ts"], proposal: proposal(["<img src=x onerror=alert(1)>.ts"]) }),
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>ok</b>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;.ts");
    expect(html).toContain("&lt;b&gt;ok&lt;/b&gt;.ts");
  });

  it("prints both panes for an empty proposal, rather than leaving the offer out", () => {
    const html = declaredPane(session({ scope: ["api/"], proposal: proposal([]) }));
    const { proposed, accepted } = panes(html);

    expect(proposed).toContain("Prime proposed — immutable");
    expect(proposed).toContain('<ul class="paths"></ul>');
    expect(accepted).toContain("1 path replaced what Prime offered.");
  });
});

describe("declaredPane without a proposal", () => {
  it("prints one plain list, with no proposal pane", () => {
    const html = declaredPane(session({ scope: ["api/"] }));
    expect(html).toContain('<ul class="paths"><li class="kept">api/</li></ul>');
    expect(html).not.toContain("Prime");
    expect(html).not.toContain("Scope accepted");
  });

  it("says nothing was declared, even where a proposal was made and all of it refused", () => {
    const html = declaredPane(session({ scope: [], proposal: proposal(["api/"]) }));
    expect(html).toContain("No scope declared.");
    expect(html).not.toContain("Prime proposed");
  });
});
