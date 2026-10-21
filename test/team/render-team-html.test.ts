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
    window: { from: "2026-10-01", to: "2026-10-07" },
    totals: {
      sessions: 10,
      pricedUsd: 125.5,
      unpricedSessions: 2,
      outcomes: { shipped: 5, reverted: 1, neverMerged: 1, stillOpen: 2, noChanges: 1 },
    },
    groups: [],
    costliestUnshipped: [],
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
    expect(html).toContain("2 unpriced");
    expect(html).toContain("50% shipped");
    expect(html).toContain("10% never-merged");
    expect(html).toContain("20% still-open");
    expect(html).toContain("10% no-changes");
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
});
