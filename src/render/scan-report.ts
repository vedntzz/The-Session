import { priceSession, unpricedThroughout, wasMeasured, type RateTable } from "../pricing.js";
import { summarizeScan, type ScannedSession } from "../scan.js";
import type { SessionCost } from "../store.js";
import { documentHead } from "./html/style.js";
import { escapeHtml } from "./html/text.js";
import { plainPalette } from "./palette.js";
import { costCell, pricesChecked } from "./terminal/cost.js";
import { formatScan, scanLandedLines, scanTotalLines } from "./terminal/scan.js";
import { figure, plural } from "./terminal/text.js";
import { safeText } from "./tui/text.js";

/** Raw counters remain separate. A pricing gap does not erase measured tokens. */
export function scanUsageLines(cost: SessionCost, rates: RateTable, checked?: string): string[] {
  if (!wasMeasured(cost)) return ["Usage not captured: no counted turns; token counts and cost are unknown."];
  const known = tokensKnown(cost);
  const price = priceSession(cost, rates);
  const counters = [
    ["Input tokens", cost.inputTokens], ["Cache read tokens", cost.cacheReadTokens],
    ["Cache creation tokens", cost.cacheCreationTokens], ["Output tokens", cost.outputTokens],
  ] as const;
  return [
    `Model: ${cost.model || "not recorded"}`,
    `${plural(cost.turns, "turn", "turns")} · ${plural(cost.apiCalls, "API call", "API calls")} (Claude Code)`,
    ...counters.map(([label, value]) => `${label}: ${known ? figure(value) : "not fully captured"}`),
    "Turns that changed no files: not measured; no diff recorded.",
    `Cost: ${known ? costCell(cost, price) : "unknown: token counts not fully captured"}`,
    ...(known && price.priced && checked ? [pricesChecked(checked)] : []),
  ];
}

export const scanLandingLine = (landed?: boolean): string => landed === undefined
  ? "Commit overlap unknown: Git could not be asked" : landed
    ? "Ran while a commit landed on the default branch" : "No commit landed during the counted calls";

function details(sessions: readonly ScannedSession[], rates: RateTable, usage: boolean, checked?: string): string[] {
  return sessions.flatMap(session => [
    `Transcript ${session.id}`, `Directory: ${session.repo || "not recorded"}`,
    `First counted call: ${session.startedAt}`, `Last counted call: ${session.endedAt}`,
    scanLandingLine(session.landed),
    "First prompt:", ...session.label.split("\n"),
    ...(usage ? scanUsageLines(session.cost, rates, checked) : []), "",
  ]);
}
const clean = (lines: readonly string[]): string[] => lines.map(safeText);
const tokensKnown = (cost: SessionCost): boolean => (cost.untokenedTurns ?? 0) === 0 && (cost.turnTokens?.every(tokens => tokens !== null) ?? true);
function coverageProblem(sessions: readonly ScannedSession[], rates: RateTable): string | undefined {
  const gaps = sessions.flatMap(({ id, cost }) => {
    const price = priceSession(cost, rates);
    const reason = !wasMeasured(cost) ? "no counted turns" : !tokensKnown(cost) ? "token counts not fully captured" : price.priced ? undefined : price.reason;
    return reason ? [`${id}: ${reason}`] : [];
  });
  return gaps.length ? `Money total unavailable — ${gaps.join("; ")}.` : undefined;
}
function totals(sessions: readonly ScannedSession[], days: number, rates: RateTable, checked?: string): string[] {
  const problem = coverageProblem(sessions, rates);
  if (problem) return [problem];
  const report = summarizeScan(sessions, rates, days);
  return [...scanTotalLines(report, plainPalette), ...(report.sessions && !unpricedThroughout(report.spend) && checked ? [pricesChecked(checked)] : [])];
}

/** The native aggregate is shared with the CLI; incomplete supplied rows cannot become free. */
export function scanReportLines(sessions: readonly ScannedSession[], days: number, rates: RateTable,
  detail: readonly string[] = [], width?: number, checked?: string): string[] {
  const problem = coverageProblem(sessions, rates);
  const report = summarizeScan(sessions, rates, days);
  return clean(problem ? [...scanLandedLines(report, plainPalette, width), `Last ${days} days`, ...detail, problem]
    : [...formatScan(report, plainPalette, width, detail), ...(report.sessions && !unpricedThroughout(report.spend) && checked ? [pricesChecked(checked)] : [])]);
}

function fenced(text: string): string {
  const fence = "`".repeat([...text.matchAll(/`+/gu)].reduce((size, run) => Math.max(size, run[0].length + 1), 3));
  return `${fence}text\n${text}\n${fence}`;
}

/** A document with full transcript text, rather than a clipped terminal table. */
export function renderScanMarkdown(sessions: readonly ScannedSession[], days: number, rates: RateTable,
  selection: string, usage: boolean, checked?: string): string {
  const report = summarizeScan(sessions, rates, days);
  const activity = clean(scanLandedLines(report, plainPalette)).map(line => line.trim()).join("\n\n");
  const total = totals(sessions, days, rates, checked);
  return [`# Tool activity — last ${days} days`, "Selection", fenced(safeText(selection)), activity,
    "No diff recorded. Changed files, drift and turns that changed no files are not measured.",
    ...sessions.map(session => `## Transcript\n\n${fenced(clean(details([session], rates, usage, checked)).join("\n").trimEnd())}`),
    ...(total.length ? [fenced(clean(total).join("\n"))] : [])].join("\n\n");
}

/** A self-contained local file: transcript content is escaped text, never markup. */
export function renderScanHtml(sessions: readonly ScannedSession[], days: number, rates: RateTable,
  selection: string, usage: boolean, checked?: string): string {
  const title = `Tool activity — last ${days} days`;
  const body = scanReportLines(sessions, days, rates, details(sessions, rates, usage, checked), undefined, checked).join("\n");
  return [...documentHead(title, false), "<body><main>", `<h1>${escapeHtml(title)}</h1>`,
    `<p class="nopool">${escapeHtml(safeText(selection))}</p>`,
    '<p class="basis">No diff recorded. Changed files, drift and turns that changed no files are not measured.</p>',
    `<pre class="detail" style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(body)}</pre>`,
    "</main></body></html>", ""].join("\n");
}
