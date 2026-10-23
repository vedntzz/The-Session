// Self-contained HTML report for team-level agent activity.
import { formatUsd } from "../pricing.js";
import { escapeHtml } from "../render/html/text.js";
import { REMOTE_PREFIX, repoName } from "../store/paths.js";
import { shareOfChanged } from "./changed-share.js";
import type { CostlyUnshipped, TeamGroup, TeamReport } from "./team-report.js";

export { escapeHtml };

// Inline styling supporting both light and dark color schemes.
const TEAM_STYLE = `
:root { --bg: #ffffff; --card: #f6f8fa; --fg: #1f2328; --muted: #656d76; --border: #d0d7de; --font: ui-monospace, SFMono-Regular, Menlo, monospace; }
@media (prefers-color-scheme: dark) { :root { --bg: #0d1117; --card: #161b22; --fg: #e6edf3; --muted: #848d97; --border: #30363d; } }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--bg); color: var(--fg); font-family: var(--font); font-size: 14px; padding: 2rem; }
main { max-width: 64rem; margin: 0 auto; }
h1 { font-size: 1.25rem; font-weight: 600; margin-bottom: 1.5rem; }
h2 { font-size: 1rem; font-weight: 600; margin: 1.5rem 0 0.5rem; }
.summary { display: flex; flex-wrap: wrap; gap: 1rem; margin-bottom: 2rem; }
.metric { background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 0.75rem 1rem; min-width: 9rem; }
.metric .val { display: block; font-size: 1.1rem; font-weight: 600; }
.metric .lbl { display: block; font-size: 0.75rem; color: var(--muted); margin-top: 0.25rem; }
.empty { padding: 2rem 0; color: var(--muted); }
table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); }
th { font-weight: 600; color: var(--muted); font-size: 0.8rem; text-transform: uppercase; }
ol { padding-left: 1.5rem; margin-top: 0.5rem; }
li { padding: 0.25rem 0; }
`.trim();

const DAY_MS = 24 * 60 * 60 * 1000;
const SHIPPED_LABEL = "shipped (of sessions that changed code)";

// The label for an agent aggregation could not name.
function agentDisplay(agent: string): string {
  return agent === "unknown" ? "agent not recorded" : agent;
}

// A remote key as owner/name; a path key as repoName shows it.
function repoDisplay(identity: string): string {
  const name = repoName(identity);
  return identity.startsWith(REMOTE_PREFIX) ? name.split("/").slice(-2).join("/") : name;
}

// `Oct 2`, or `Oct 2, 2026` with the year, in the reader's timezone.
function monthDay(at: Date, withYear: boolean): string {
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) };
  return at.toLocaleDateString("en-US", options);
}

// `Sep 23 – Oct 23, 2026 (30 days)`; the start keeps its year when the window crosses one.
function windowDisplay(window: TeamReport["window"]): string {
  const from = new Date(window.from);
  const to = new Date(window.to);
  const days = Math.round((to.getTime() - from.getTime()) / DAY_MS);
  return `${monthDay(from, from.getFullYear() !== to.getFullYear())} – ${monthDay(to, true)} (${days} days)`;
}

// A YYYY-MM-DD start date as `Oct 2`.
function dateDisplay(date: string): string {
  return monthDay(new Date(`${date}T12:00:00`), false);
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

// Spend over the priced sessions it covers.
function spendItem(t: TeamReport["totals"]): string {
  const priced = t.sessions - t.unpricedSessions;
  return summaryItem(`across ${priced} priced sessions`, spendDisplay(t.pricedUsd, t.unpricedSessions));
}

// Assembles summary metric cards from the totals block.
function renderMetrics(report: TeamReport): string[] {
  const t = report.totals;
  const o = t.outcomes;
  return [
    spendItem(t),
    summaryItem("unpriced", String(t.unpricedSessions)),
    summaryItem(SHIPPED_LABEL, shareOfChanged(o.shipped, o)),
    summaryItem("never merged", shareOfChanged(o.neverMerged, o)),
    summaryItem("still open", shareOfChanged(o.stillOpen, o)),
    summaryItem("no changes", String(o.noChanges)),
  ];
}

// Renders the top summary row containing overall metrics.
function renderSummary(report: TeamReport): string {
  return `<div class="summary">${renderMetrics(report).join("")}</div>`;
}

// Checks if a group has no priced dollars but has unpriced sessions.
function isUnpricedOnly(group: TeamGroup): boolean {
  return group.pricedUsd === 0 && group.unpricedSessions > 0;
}

// Sorts groups by spend descending, putting unpriced-only groups last.
function compareGroups(a: TeamGroup, b: TeamGroup): number {
  const aUnpriced = isUnpricedOnly(a);
  const bUnpriced = isUnpricedOnly(b);
  if (aUnpriced !== bUnpriced) return aUnpriced ? 1 : -1;
  return b.pricedUsd - a.pricedUsd;
}

// Renders a single row in the group breakdown table.
function renderGroupRow(g: TeamGroup): string {
  const spend = spendDisplay(g.pricedUsd, g.unpricedSessions);
  const share = shareOfChanged(g.outcomes.shipped, g.outcomes);
  const cells = [agentDisplay(g.agent), g.sessions, spend, g.unpricedSessions, share, g.outcomes.noChanges];
  const rendered = cells.map((c) => `<td>${escapeHtml(String(c))}</td>`).join("");
  return `<tr>${rendered}</tr>`;
}

// Renders the group breakdown table sorted by spend.
function renderGroupTable(groups: TeamGroup[]): string {
  if (groups.length === 0) return "";
  const sorted = [...groups].sort(compareGroups);
  const head = `<tr><th>Agent</th><th>Sessions</th><th>Spend</th><th>Unpriced</th><th>${SHIPPED_LABEL}</th><th>No changes</th></tr>`;
  const rows = sorted.map(renderGroupRow).join("");
  return `<section class="groups"><h2>Groups</h2><table><thead>${head}</thead><tbody>${rows}</tbody></table></section>`;
}

// Renders a single list item for an unshipped session.
function renderCostlyItem(item: CostlyUnshipped): string {
  const cost = item.usd !== null ? formatUsd(item.usd) : "unpriced";
  const agent = escapeHtml(agentDisplay(item.agent));
  const outcome = escapeHtml(item.outcome);
  const date = escapeHtml(dateDisplay(item.date));
  return `<li><span class="date">${date}</span> · <span class="agent">${agent}</span> · <span class="outcome">${outcome}</span> · <span class="cost">${cost}</span></li>`;
}

// Renders up to 5 costliest unshipped sessions in an ordered list.
function renderCostliestList(items: CostlyUnshipped[]): string {
  if (items.length === 0) return "";
  const rendered = items.slice(0, 5).map(renderCostlyItem).join("");
  return `<section class="costliest"><h2>Costliest Unshipped</h2><ol>${rendered}</ol></section>`;
}

// Renders main content with summary, group table, and unshipped list.
function renderBody(report: TeamReport): string {
  if (report.totals.sessions === 0) {
    return `<p class="empty">No sessions in this window</p>`;
  }
  const summary = renderSummary(report);
  const table = renderGroupTable(report.groups);
  const costliest = renderCostliestList(report.costliestUnshipped);
  return `${summary}${table}${costliest}`;
}

// Builds the document head with meta tags, title, and inline styles.
function renderHead(title: string): string {
  const meta = '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">';
  return `<head>${meta}<title>${escapeHtml(title)}</title><style>${TEAM_STYLE}</style></head>`;
}

// Renders the optional note line, escaped, or nothing.
function renderNote(note: string | undefined): string {
  return note === undefined ? "" : `<p class="note">${escapeHtml(note)}</p>`;
}

// `Team report · <repo> · <window>`, the repo part dropped when no session names one.
function heading(report: TeamReport): string {
  const identity = report.groups[0]?.repo;
  const parts = ["Team report", ...(identity === undefined ? [] : [repoDisplay(identity)]), windowDisplay(report.window)];
  return parts.join(" · ");
}

// Renders a complete self-contained HTML page for the team report.
export function renderTeamHtml(report: TeamReport, note?: string): string {
  const title = heading(report);
  const head = renderHead(title);
  const h1 = escapeHtml(title);
  const body = `<body><main><h1>${h1}</h1>${renderNote(note)}${renderBody(report)}</main></body>`;
  return `<!doctype html>\n<html lang="en">\n${head}\n${body}\n</html>\n`;
}
