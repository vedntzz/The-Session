// Self-contained HTML report for team-level agent activity.
import { formatUsd } from "../pricing.js";
import { escapeHtml } from "../render/html/text.js";
import type { TeamReport } from "./team-report.js";

export { escapeHtml };

// Inline styling supporting both light and dark color schemes.
const TEAM_STYLE = `
:root { --bg: #ffffff; --card: #f6f8fa; --fg: #1f2328; --muted: #656d76; --border: #d0d7de; --font: ui-monospace, SFMono-Regular, Menlo, monospace; }
@media (prefers-color-scheme: dark) { :root { --bg: #0d1117; --card: #161b22; --fg: #e6edf3; --muted: #848d97; --border: #30363d; } }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--bg); color: var(--fg); font-family: var(--font); font-size: 14px; padding: 2rem; }
main { max-width: 64rem; margin: 0 auto; }
h1 { font-size: 1.25rem; font-weight: 600; margin-bottom: 1.5rem; }
.summary { display: flex; flex-wrap: wrap; gap: 1rem; margin-bottom: 2rem; }
.metric { background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 0.75rem 1rem; min-width: 9rem; }
.metric .val { display: block; font-size: 1.1rem; font-weight: 600; }
.metric .lbl { display: block; font-size: 0.75rem; color: var(--muted); margin-top: 0.25rem; }
.empty { padding: 2rem 0; color: var(--muted); }
`.trim();

// Formats a count as a rounded share percentage of total sessions.
function percent(count: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((count / total) * 100)}%`;
}

// Formats priced spend or returns unpriced when no money is known.
function spendDisplay(usd: number, unpriced: number): string {
  if (usd === 0 && unpriced > 0) return "unpriced";
  return formatUsd(usd);
}

// Renders an individual summary card metric with label and value.
function summaryItem(label: string, value: string): string {
  return `<div class="metric"><span class="val">${escapeHtml(value)}</span><span class="lbl">${escapeHtml(label)}</span></div>`;
}

// Assembles summary metric cards from the totals block.
function renderMetrics(report: TeamReport): string[] {
  const t = report.totals;
  const s = t.sessions;
  return [
    summaryItem("Spend", spendDisplay(t.pricedUsd, t.unpricedSessions)),
    summaryItem("Coverage", `${t.unpricedSessions} unpriced`),
    summaryItem("Shipped", `${percent(t.outcomes.shipped, s)} shipped`),
    summaryItem("Never Merged", `${percent(t.outcomes.neverMerged, s)} never-merged`),
    summaryItem("Still Open", `${percent(t.outcomes.stillOpen, s)} still-open`),
    summaryItem("No Changes", `${percent(t.outcomes.noChanges, s)} no-changes`),
  ];
}

// Renders the top summary row containing overall metrics.
function renderSummary(report: TeamReport): string {
  return `<div class="summary">${renderMetrics(report).join("")}</div>`;
}

// Renders main content or an empty state when 0 sessions exist.
function renderBody(report: TeamReport): string {
  if (report.totals.sessions === 0) {
    return `<p class="empty">No sessions in this window</p>`;
  }
  return renderSummary(report);
}

// Builds the document head with meta tags, title, and inline styles.
function renderHead(title: string): string {
  const meta = '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">';
  return `<head>${meta}<title>${escapeHtml(title)}</title><style>${TEAM_STYLE}</style></head>`;
}

// Renders a complete self-contained HTML page for the team report.
export function renderTeamHtml(report: TeamReport): string {
  const title = `Team Report (${report.window.from} to ${report.window.to})`;
  const head = renderHead(title);
  const body = `<body><main><h1>${escapeHtml(title)}</h1>${renderBody(report)}</main></body>`;
  return `<!doctype html>\n<html lang="en">\n${head}\n${body}\n</html>\n`;
}
