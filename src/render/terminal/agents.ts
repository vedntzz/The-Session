// `session agents`: a block per agent, a row per intent source, money last on each.
import type { AgentBlock, AgentRow } from "../../agents-report.js";
import { AGENT_WINDOW } from "../../agents-report.js";
import { MIN_SESSIONS } from "../../survival.js";
import type { Palette } from "../palette.js";
import { NO_CALLS } from "./cost.js";
import { figure, INDENT, label, note, percent, plural } from "./text.js";
import { spentFigure } from "./week.js";

/** What the heading says for sessions no adapter captured anything for. */
export const NO_AGENT = "no agent captured";

/** Why the blocks do not add up, said under the heading. */
export const AGENTS_NOTE =
  `never pooled: one row per agent and intent source. A session more than one agent worked in ` +
  `is listed under each, whole, so rows do not add up. Merges are counts, never a rate: abandoned is only what somebody marked. ` +
  `The survival rate needs ${MIN_SESSIONS} checked sessions; pending never counts against.`;

/** The window in words: all history unless `--days` narrowed it. */
export function windowOf(days: number | undefined): string {
  return days === undefined ? "all recorded history" : `the last ${plural(days, "day", "days")}`;
}

/** The heading, the note, then every agent's block; `width` wraps the note and nothing else. */
export function formatAgents(blocks: readonly AgentBlock[], sessions: number, days: number | undefined, palette: Palette, width?: number): string[] {
  const lines = [`${plural(sessions, "session", "sessions")} over ${windowOf(days)}`, ...note(AGENTS_NOTE, palette.meta, width)];
  for (const block of blocks) {
    lines.push("", block.agent ?? NO_AGENT, ...block.rows.flatMap((row) => rowLines(row, block.agent !== null, palette)));
  }
  return lines;
}

function rowLines(row: AgentRow, captured: boolean, palette: Palette): string[] {
  if (row.sessions === 0) return [`${INDENT}${row.source} · no sessions`];
  const mixed = row.mixed > 0 ? `, ${figure(row.mixed)} also under another agent` : "";
  const body = [["landed", landed(row)], [`${AGENT_WINDOW} days`, survived(row)],
    ...(captured ? [["writes", writes(row)]] : [])];
  return [`${INDENT}${row.source} · ${plural(row.sessions, "session", "sessions")}${mixed}`,
    ...body.map(([name, text]) => `${INDENT}${INDENT}${palette.meta(label(name!))}${text}`),
    `${INDENT}${INDENT}${palette.meta(label("cost"))}${palette.meta(spent(row, captured))}`];
}

/** Where the work went, as counts: a rate over marked abandonment alone would be one nobody measured. */
export function landed(row: AgentRow): string {
  return [`${figure(row.merged)} merged`, `${figure(row.abandoned)} marked abandoned`,
    `${figure(row.open)} open`, `${figure(row.empty)} changed no files`].join(" · ");
}

/** Whether merged work stuck: the rate over closed windows only, every other state its own count. */
export function survived(row: AgentRow): string {
  const { measured, pending, due, missed, figures } = row.survival;
  if (measured + pending + due + missed + row.undated === 0) return "nothing merged to check";
  const head = figures ? `${percent(figures.rate)} of ${plural(figures.paths, "path", "paths")} survived, ${figure(measured)} checked`
    : `${figure(measured)} checked, ${measured > 0 ? "too few for a rate" : "no rate"}`;
  const rest: [number, string][] = [[pending, "pending"], [due, "due"], [missed, "missed"], [row.undated, "undated"]];
  return [head, ...rest.filter(([n]) => n > 0).map(([n, what]) => `${figure(n)} ${what}`)].join(" · ");
}

/** The agent's own asks and denials, or that it recorded no check at all. */
export function writes(row: AgentRow): string {
  return row.writes === undefined ? "no write check recorded"
    : `${figure(row.writes.asked)} asked · ${figure(row.writes.denied)} denied`;
}

/** Calls, a dash where they were never counted, then the money and what it leaves out. */
export function spent(row: AgentRow, captured: boolean): string {
  const calls = row.calls === undefined ? NO_CALLS : `${figure(row.calls)} api call${row.calls === 1 ? "" : "s"}`;
  const { unpriced, unpricedModels, uncaptured } = row.spend;
  const gaps = [...(unpriced > 0 ? [`${figure(unpriced)} unpriced: ${unpricedModels.join(", ")}`] : []),
    ...(uncaptured > 0 ? [`${figure(uncaptured)} uncaptured`] : [])];
  return [...(captured ? [calls] : []), spentFigure(row.spend), ...gaps].join(" · ");
}
