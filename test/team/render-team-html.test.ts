import { describe, expect, it } from "vitest";
import { escapeHtml, renderTeamHtml } from "../../src/team/render-team-html.js";
import type { TeamReport } from "../../src/team/team-report.js";

describe("escapeHtml", () => {
  it("escapes script tags", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes quotes and ampersands", () => {
    expect(escapeHtml(`"hello" & 'world'`)).toBe("&quot;hello&quot; &amp; &#39;world&#39;");
  });
});

describe("renderTeamHtml", () => {
  const emptyReport: TeamReport = {
    window: { from: "2026-10-01", to: "2026-10-07" },
    totals: {
      sessions: 0,
      pricedUsd: 0,
      unpricedSessions: 0,
      outcomes: { shipped: 0, reverted: 0, neverMerged: 0, stillOpen: 0, noChanges: 0 },
    },
    groups: [],
    costliestUnshipped: [],
  };

  const sampleReport: TeamReport = {
    window: { from: "2026-10-01T12:00:00.000Z", to: "2026-10-07T12:00:00.000Z" },
    totals: {
      sessions: 10,
      pricedUsd: 125.5,
      unpricedSessions: 2,
      outcomes: { shipped: 5, reverted: 1, neverMerged: 1, stillOpen: 2, noChanges: 1 },
    },
    groups: [
      {
        repo: "repo-b",
        agent: "claude",
        sessions: 3,
        pricedUsd: 20.0,
        unpricedSessions: 0,
        outcomes: { shipped: 2, reverted: 0, neverMerged: 1, stillOpen: 0, noChanges: 0 },
      },
      {
        repo: "repo-c",
        agent: "gemini",
        sessions: 2,
        pricedUsd: 0,
        unpricedSessions: 2,
        outcomes: { shipped: 1, reverted: 0, neverMerged: 0, stillOpen: 1, noChanges: 0 },
      },
      {
        repo: "repo-a",
        agent: "codex",
        sessions: 5,
        pricedUsd: 105.5,
        unpricedSessions: 0,
        outcomes: { shipped: 2, reverted: 1, neverMerged: 0, stillOpen: 1, noChanges: 1 },
      },
    ],
    costliestUnshipped: [
      { date: "2026-10-02", repo: "repo-b", agent: "claude", outcome: "never-merged", usd: 15.0 },
      { date: "2026-10-03", repo: "repo-c", agent: "gemini", outcome: "never-merged", usd: null },
      { date: "2026-10-04", repo: "repo-a", agent: "codex", outcome: "reverted", usd: 8.5 },
      { date: "2026-10-05", repo: "repo-b", agent: "claude", outcome: "never-merged", usd: 5.0 },
      { date: "2026-10-06", repo: "repo-a", agent: "codex", outcome: "reverted", usd: 3.2 },
      { date: "2026-10-07", repo: "repo-a", agent: "codex", outcome: "reverted", usd: 1.0 },
    ],
  };

  it("renders a clear empty page with no table for empty reports", () => {
    const html = renderTeamHtml(emptyReport);
    expect(html).toContain("No sessions in this window");
    expect(html).not.toContain("<table");
  });

  it("is self-contained with no scripts or external URLs", () => {
    const html = renderTeamHtml(sampleReport);
    expect(html.toLowerCase()).toContain("<!doctype html>");
    expect(html).toContain("<style>");
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/https?:\/\//i);
  });

  it("includes light and dark mode styles via prefers-color-scheme", () => {
    const html = renderTeamHtml(sampleReport);
    expect(html).toContain("prefers-color-scheme");
  });

  it("renders summary row with priced spend, unpriced count, and outcome shares", () => {
    const html = renderTeamHtml(sampleReport);
    expect(html).toContain("$125.50");
    expect(html).toContain('2</span><span class="lbl">unpriced');
    expect(html).toContain('56%</span><span class="lbl">shipped (of sessions that changed code)');
    expect(html).toContain('11%</span><span class="lbl">never merged');
    expect(html).toContain('22%</span><span class="lbl">still open');
    expect(html).toContain('1</span><span class="lbl">no changes');
  });

  it("never shows unpriced spend as $0", () => {
    const unpricedReport: TeamReport = {
      window: { from: "2026-10-01", to: "2026-10-07" },
      totals: {
        sessions: 3,
        pricedUsd: 0,
        unpricedSessions: 3,
        outcomes: { shipped: 3, reverted: 0, neverMerged: 0, stillOpen: 0, noChanges: 0 },
      },
      groups: [],
      costliestUnshipped: [],
    };
    const html = renderTeamHtml(unpricedReport);
    expect(html).not.toContain("$0");
    expect(html).not.toContain("$0.00");
    expect(html).toContain("unpriced");
  });

  it("never labels still open sessions as waste or failed", () => {
    const html = renderTeamHtml(sampleReport);
    expect(html).not.toMatch(/still-?open[^>]*waste/i);
    expect(html).not.toMatch(/still-?open[^>]*failed/i);
    expect(html).not.toMatch(/failed[^>]*still-?open/i);
  });

  it("renders group table sorted by spend with unpriced-only groups last", () => {
    const html = renderTeamHtml(sampleReport);
    expect(html).toContain("<table");
    const posA = html.indexOf("<td>codex");
    const posB = html.indexOf("<td>claude");
    const posC = html.indexOf("<td>gemini");
    expect(posA).toBeLessThan(posB);
    expect(posB).toBeLessThan(posC);
    expect(html).toContain("$105.50");
    expect(html).toContain("$20.00");
  });

  it("escapes the repo heading and agent strings in group table", () => {
    const dangerousReport: TeamReport = {
      window: { from: "2026-10-01", to: "2026-10-07" },
      totals: {
        sessions: 1,
        pricedUsd: 10,
        unpricedSessions: 0,
        outcomes: { shipped: 1, reverted: 0, neverMerged: 0, stillOpen: 0, noChanges: 0 },
      },
      groups: [
        {
          repo: "<script>bad()</script>",
          agent: "bot & 'evil'",
          sessions: 1,
          pricedUsd: 10,
          unpricedSessions: 0,
          outcomes: { shipped: 1, reverted: 0, neverMerged: 0, stillOpen: 0, noChanges: 0 },
        },
      ],
      costliestUnshipped: [],
    };
    const html = renderTeamHtml(dangerousReport);
    expect(html).not.toContain("<script>bad()</script>");
    expect(html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
    expect(html).toContain("bot &amp; &#39;evil&#39;");
  });

  it("renders costliest unshipped list capped at 5 entries with unpriced indicator", () => {
    const html = renderTeamHtml(sampleReport);
    expect(html).toContain("Costliest Unshipped");
    expect(html).toContain("$15.00");
    expect(html).toContain("$8.50");
    expect(html).toContain("$5.00");
    expect(html).toContain("$3.20");
    expect(html).not.toContain("$1.00");
  });

  it("leaves repo out of the costliest list and escapes agent strings", () => {
    const dangerousReport: TeamReport = {
      window: { from: "2026-10-01", to: "2026-10-07" },
      totals: {
        sessions: 1,
        pricedUsd: 0,
        unpricedSessions: 1,
        outcomes: { shipped: 0, reverted: 0, neverMerged: 1, stillOpen: 0, noChanges: 0 },
      },
      groups: [],
      costliestUnshipped: [
        {
          date: "2026-10-02",
          repo: "<script>alert('repo')</script>",
          agent: "agent & 'co'",
          outcome: "never-merged",
          usd: null,
        },
      ],
    };
    const html = renderTeamHtml(dangerousReport);
    expect(html).not.toContain("<script>alert('repo')</script>");
    expect(html).not.toContain("alert(&#39;repo&#39;)");
    expect(html).toContain("agent &amp; &#39;co&#39;");
  });

  it("matches snapshot for a typical report", () => {
    const html = renderTeamHtml(sampleReport);
    expect(html).toMatchSnapshot();
  });
});

describe("renderTeamHtml readability", () => {
  const outcomes = { shipped: 3, reverted: 0, neverMerged: 1, stillOpen: 0, noChanges: 3 };
  const report: TeamReport = {
    window: { from: "2026-09-23T12:00:00.000Z", to: "2026-10-23T12:00:00.000Z" },
    totals: { sessions: 7, pricedUsd: 42, unpricedSessions: 2, outcomes },
    groups: [
      { repo: "remote:github.com/acme/tool", agent: "claude-code", sessions: 5, pricedUsd: 42, unpricedSessions: 0,
        outcomes: { shipped: 3, reverted: 0, neverMerged: 1, stillOpen: 0, noChanges: 1 } },
      { repo: "remote:github.com/acme/tool", agent: "unknown", sessions: 2, pricedUsd: 0, unpricedSessions: 2,
        outcomes: { shipped: 0, reverted: 0, neverMerged: 0, stillOpen: 0, noChanges: 2 } },
    ],
    costliestUnshipped: [
      { date: "2026-10-02", repo: "remote:github.com/acme/tool", agent: "unknown", outcome: "never-merged", usd: null },
    ],
  };
  const html = renderTeamHtml(report);
  const text = html.replace(/<head>[\s\S]*<\/head>/, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  it("titles the page with owner/name and a readable window", () => {
    expect(html).toContain("<title>Team report · acme/tool · Sep 23 – Oct 23, 2026 (30 days)</title>");
  });

  it("shows no raw ISO timestamp or date anywhere", () => {
    expect(html).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("shows the repo once, as owner/name, with no storage prefix", () => {
    expect(text.split("acme/tool").length - 1).toBe(1);
    expect(html).not.toContain("github.com");
    expect(html).not.toMatch(/remote:|path:/);
    expect(html).not.toContain("<th>Repo</th>");
  });

  it("reads spend across priced sessions and counts unpriced separately", () => {
    expect(text).toContain("$42.00 across 5 priced sessions");
    expect(text).toContain("2 unpriced");
    expect(html).not.toContain("Coverage");
  });

  it("takes the shipped share of sessions that changed code only", () => {
    expect(text).toContain("75% shipped (of sessions that changed code)");
    expect(text).toContain("3 no changes");
  });

  it("names an unknown agent as not recorded", () => {
    expect(text).toContain("agent not recorded");
    expect(html).not.toMatch(/>unknown</);
  });

  it("never repeats a card's value word in its label", () => {
    expect(html).not.toMatch(/class="val">[^<]*shipped<\/span><span class="lbl">Shipped/i);
    expect(html).not.toMatch(/class="val">[^<]*[a-z][^<]*<\/span><span class="lbl">/i);
  });
});
