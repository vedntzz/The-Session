import { describe, expect, it } from "vitest";
import { escapeHtml, renderTeamHtml } from "../../src/team/render-team-html.js";
import type { TeamReport } from "../../src/team/team-report.js";

describe("team HTML privacy guard", () => {
  const smuggledRepo = "org/repo-smuggle-user@corp.example.com";
  const smuggledAgent = "agent-author: alice (login: alice99, email: alice@example.com)";
  const costlyRepo = "author: bob <bob@corp.internal>";
  const costlyAgent = "agent-login: bob99";

  const smuggledReport: TeamReport = {
    window: { from: "2026-10-01", to: "2026-10-07" },
    totals: {
      sessions: 4,
      pricedUsd: 50.0,
      unpricedSessions: 1,
      outcomes: { shipped: 2, reverted: 0, neverMerged: 1, stillOpen: 1, noChanges: 0 },
    },
    groups: [
      {
        repo: smuggledRepo,
        agent: smuggledAgent,
        sessions: 3,
        pricedUsd: 50.0,
        unpricedSessions: 0,
        outcomes: { shipped: 2, reverted: 0, neverMerged: 1, stillOpen: 0, noChanges: 0 },
      },
      {
        repo: "clean-repo",
        agent: "clean-agent",
        sessions: 1,
        pricedUsd: 0,
        unpricedSessions: 1,
        outcomes: { shipped: 0, reverted: 0, neverMerged: 0, stillOpen: 1, noChanges: 0 },
      },
    ],
    costliestUnshipped: [
      {
        date: "2026-10-03",
        repo: costlyRepo,
        agent: costlyAgent,
        outcome: "never-merged",
        usd: 25.0,
      },
    ],
  };

  it("never contains an email pattern outside the escaped input strings", () => {
    const html = renderTeamHtml(smuggledReport);
    const stripped = html
      .replaceAll(escapeHtml(smuggledRepo), "")
      .replaceAll(escapeHtml(smuggledAgent), "")
      .replaceAll(escapeHtml(costlyRepo), "")
      .replaceAll(escapeHtml(costlyAgent), "");

    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    expect(stripped).not.toMatch(emailPattern);
  });

  it("never labels any field as author, name, email, or login", () => {
    const html = renderTeamHtml(smuggledReport);
    const forbiddenLabels = [
      /<th[^>]*>\s*(author|name|email|login)\b/i,
      /<span[^>]*class="lbl"[^>]*>\s*(author|name|email|login)\b/i,
      /<h[1-6][^>]*>\s*(author|name|email|login)\b/i,
      /<label[^>]*>\s*(author|name|email|login)\b/i,
      /<dt[^>]*>\s*(author|name|email|login)\b/i,
    ];
    for (const pattern of forbiddenLabels) {
      expect(html).not.toMatch(pattern);
    }
  });

  it("does not leak personal identifiers on clean reports", () => {
    const cleanReport: TeamReport = {
      window: { from: "2026-10-01", to: "2026-10-07" },
      totals: {
        sessions: 2,
        pricedUsd: 15.0,
        unpricedSessions: 0,
        outcomes: { shipped: 2, reverted: 0, neverMerged: 0, stillOpen: 0, noChanges: 0 },
      },
      groups: [
        {
          repo: "clean/repo",
          agent: "claude-code",
          sessions: 2,
          pricedUsd: 15.0,
          unpricedSessions: 0,
          outcomes: { shipped: 2, reverted: 0, neverMerged: 0, stillOpen: 0, noChanges: 0 },
        },
      ],
      costliestUnshipped: [],
    };
    const html = renderTeamHtml(cleanReport);
    expect(html).not.toMatch(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    expect(html).not.toMatch(/<th>\s*(author|name|email|login)/i);
    expect(html).not.toMatch(/class="lbl">\s*(author|name|email|login)/i);
  });
});
