import { callsOf, type AgentInfo } from "../../agents.js";
import { emptyTurnsOf } from "../../empty.js";
import { sessionFigure, spendOf, unpricedThroughout, wasMeasured, type RateTable } from "../../pricing.js";
import { hasDeclaredScope, INTENT_SOURCES, intentSourceOf, type Session } from "../../store.js";
import { plainPalette, plainUiTheme, type Palette, type UiRole, type UiTheme } from "../palette.js";
import { intentOf, INTENT_NOTE } from "../terminal/intent.js";
import { clock, day } from "../terminal/text.js";
import { pricesChecked } from "../terminal/cost.js";
import { outcomeHeadline, spentFigure, weekSourceHeadline } from "../terminal/week.js";
import { sessionHeader } from "./chrome.js";
import { canReturnHome, HISTORY_FILTERS, parseQuery, visibleSessions, type UiState } from "./state.js";
import { cellWidth, fit, fold } from "./text.js";
import { weekCoverage, weekSummary } from "./week-summary.js";

interface Line { text: string; role?: UiRole; prefix?: string; selected?: boolean }
/** `agents` lets a call count no agent made read as unknown; absent, calls print as recorded. */
export interface UiData { sessions: Session[]; rates: RateTable; repo: string; branch?: string; checked?: string; days?: number; agents?: readonly AgentInfo[] }

function drift(session: Session): string {
  if (!hasDeclaredScope(session)) return "No scope declared · drift is not measured";
  if (session.endedAt === null) return "Running · drift is measured at stop";
  const count = session.drift.length;
  return count ? `! ${count} ${count === 1 ? "file" : "files"} outside declared scope` : "No files outside declared scope";
}

interface Tree { children: Map<string, Tree>; path?: string }
function fileTree(session: Session): Line[] {
  const root: Tree = { children: new Map() };
  for (const path of session.reality) {
    let parent = root;
    for (const part of path.split("/")) {
      if (!parent.children.has(part)) parent.children.set(part, { children: new Map() });
      parent = parent.children.get(part)!;
    }
    parent.path = path;
  }
  const lines: Line[] = [];
  const walk = (node: Tree, prefix: string): void => {
    const entries = [...node.children].sort(([a], [b]) => a.localeCompare(b));
    entries.forEach(([name, child], index) => {
      const last = index === entries.length - 1;
      const outside = child.path !== undefined && hasDeclaredScope(session) && session.drift.includes(child.path);
      lines.push({ text: `${prefix}${last ? "└─" : "├─"} ${outside ? "! " : ""}${name}${child.children.size ? "/" : ""}`, role: outside ? "drift" : "text" });
      walk(child, prefix + (last ? "   " : "│  "));
    });
  };
  walk(root, "");
  return lines;
}

function costLine(session: Session, rates: RateTable): string {
  return wasMeasured(session.cost)
    ? `${sessionFigure(session.cost, rates) ?? `unpriced (${session.cost.model})`} · ${session.cost.turns} turns`
    : "Not captured; cost and turns are unknown.";
}
function evidence(session: Session, agents: readonly AgentInfo[]): Line[] {
  const lines: Line[] = [
    { text: "USAGE & EVIDENCE", role: "focus" },
    { text: `ID ${session.id}` },
    { text: `Started ${session.startedAt}` },
    { text: `Ended ${session.endedAt ?? "still running"}` },
    { text: `Start commit ${session.startCommit}` },
    { text: INTENT_NOTE[intentSourceOf(session)] ?? "Intent declared before the run; immutable." },
  ];
  if (session.proposal) {
    lines.push({ text: "Prime proposed (immutable):" });
    lines.push(...session.proposal.scope.map((path) => ({ text: path })));
    if (!session.proposal.scope.length) lines.push({ text: "No paths proposed." });
  }
  if (wasMeasured(session.cost)) {
    const empty = emptyTurnsOf(session);
    lines.push(
      { text: `${callsOf(session.cost, agents) ?? "—"} API calls · ${session.cost.model}` },
      { text: empty === undefined ? "Turns that changed no files: not measured" : `${empty} turns changed no files` },
      { text: `Input: ${session.cost.inputTokens} · Cache read: ${session.cost.cacheReadTokens}` },
      { text: `Cache creation: ${session.cost.cacheCreationTokens} · Output: ${session.cost.outputTokens}` },
    );
  }
  for (const seen of session.observations ?? []) lines.push({ text: `${seen.observedAt} · ${seen.outcome} · ${seen.source} · ${seen.commit}` });
  return lines;
}

function entry(session: Session, selected: boolean, state: UiState, data: UiData, width: number): Line[] {
  const expanded = selected && state.expanded;
  const rail = "         │   ";
  const first = `${clock(session.startedAt)}    ${selected ? "■" : "□"}   `;
  const lines: Line[] = [{ text: day(session.startedAt), role: "meta", selected }, { text: "", selected }];
  const add = (text: string, role: UiRole = "meta", prefix = rail): void => {
    fold(text, width - cellWidth(prefix)).forEach((part, index) => lines.push({ text: part, role, prefix: index ? rail : prefix, selected }));
  };
  add(`${selected ? "> " : ""}${intentOf(session)}`, "intent", first);
  add(`${session.outcome} · ${intentSourceOf(session)}`);
  add(drift(session), hasDeclaredScope(session) && session.endedAt !== null && session.drift.length ? "drift" : "meta");
  if (expanded) {
    add(""); add("CHANGED FILES");
    if (!session.reality.length) add(session.endedAt === null ? "Changes are recorded at stop." : "No files changed.");
    for (const line of fileTree(session)) add(line.text, line.role);
    add("");
    if (hasDeclaredScope(session)) {
      add(session.proposal ? "Accepted scope:" : "Declared:");
      for (const path of session.scope) add(path);
      if (!session.scope.length) add("No paths named.");
    }
    add(""); add(costLine(session, data.rates));
    add(`[e] ${state.evidence ? "Hide" : "Usage &"} evidence`, "focus");
    if (state.evidence) {
      add("");
      for (const line of evidence(session, data.agents ?? [])) add(line.text, line.role);
    }
  } else if (selected) add("Enter to expand", "focus");
  lines.push({ text: "", selected }, { text: "─".repeat(width), role: "meta" }, { text: "" });
  return lines;
}

const helpLines = (returnToHome: boolean, grouped: boolean): string[] => [
  "KEYBOARD", "↑↓ / j k   Select a session", "Enter      Expand or collapse selected session",
  "e          Show or hide usage and evidence", "PgUp/PgDn  Scroll through long entries (also Ctrl-U / Ctrl-D)",
  "Home/End   First or last session", "/          Search; Enter finishes typing", `Esc        ${returnToHome ? "Back; " : ""}clear filters; close help`,
  ...HISTORY_FILTERS.map(filter => `${filter.shortcut}          Cycle ${filter.label.toLowerCase()} filter`),
  ...(grouped ? ["w          Cycle day range: 7 / 14 / 30", "u          Show or hide usage totals for each source"] : []),
  "r          Refresh records and Git outcomes", returnToHome ? "q          Home; Ctrl-C exits" : "q / Ctrl-C Quit",
  "", "FILTERS", "outside:yes   Recorded drift only", "outside:no    Measured zero drift; excludes running and captured sessions",
  "outcome:merged   Also open, abandoned, empty", "source:declared  Also primed, captured", "",
  "Combine filters and text: outside:yes source:declared rate limiting",
  "Text searches intent, session id, scope and changed paths.", "? or Esc closes help",
];

/** A bounded timeline viewport; records remain read-only and colours are applied last. */
export function renderUi(data: UiData, state: UiState, columns: number, rows: number,
  _palette: Palette = plainPalette, notice = "", theme: UiTheme = plainUiTheme, returnToHome = false,
  grouped = false): { lines: string[]; maxScroll: number } {
  const width = Math.max(1, columns - 1);
  if (columns < 60 || rows < 20) return {
    lines: fold(`Resize to at least 60 columns and 20 rows, or q to ${returnToHome ? "return Home" : "quit"}.`, width).slice(0, Math.max(1, rows - 1)), maxScroll: 0,
  };
  const sessions = visibleSessions(data.sessions, state);
  const query = parseQuery(state.query);
  const inset = width - 4;
  const branding: Line[] = grouped ? sessionHeader(data.repo, data.branch ?? "Branch unavailable", "WEEK REPORT", inset)
    : [...fold(outcomeHeadline(sessions), inset).map(text => ({ text })), { text: `THE SESSION  /  ${data.repo}`, role: "meta" }, { text: "" }];
  const header = [...branding];
  header.push({ text: `┌${"─".repeat(inset - 2)}┐`, role: "focus" });
  const search = state.searching ? state.query || "" : state.query || "/ Search sessions or add a filter";
  // Keep the editing end visible for long queries.
  const searchParts = fold(search, inset - 7);
  header.push({ text: `│ > ${fit(state.searching ? searchParts.at(-1)! + "▌" : search, inset - 6)} │`, role: "focus" });
  header.push({ text: `└${"─".repeat(inset - 2)}┘`, role: "focus" });
  const controls = HISTORY_FILTERS.map(filter => `[${filter.shortcut}] ${filter.label}: ${filter.values[state[filter.key]] ?? "invalid"}`);
  if (grouped) controls.unshift(`[w] Range: ${data.days} days`, `[u] Usage: ${state.usage ? "hide" : "show"}`);
  header.push(...fold(`FILTERS  ${controls.join(" · ")}`, inset).map(text => ({ text, role: "focus" as const })));
  if (query.error || query.filters.length) {
    const filters = [...new Set(query.filters.map(([key, value]) => `[${key}:${value}]`))];
    header.push(...fold(query.error ?? `Search filters: ${filters.join("  ")}`, inset).map(text => ({ text, role: "focus" as const })));
  }
  header.push({ text: `${sessions.length} matching sessions / ${data.days === undefined ? "all recorded history" : `last ${data.days} days`}`, role: "meta" }, { text: "" });
  const spend = spendOf(sessions, data.rates);
  const money = sessions.length ? `${spentFigure(spend)} · ${spend.unpriced} unpriced · ${spend.uncaptured} uncaptured` : "No spend to report.";
  const footer: Line[] = [
    { text: "─".repeat(inset), role: "meta" },
    { text: `/ Search   ↑↓ Select   Enter Expand   Esc ${returnToHome && canReturnHome(state) ? "Back" : "Clear"}   ? Help`, role: "focus" },
    { text: notice || `Session ${sessions.length ? state.selected + 1 : 0}/${sessions.length} · PgUp/PgDn scroll · q ${returnToHome ? "Home" : "quit"}`, role: "meta" },
    ...fold(money, inset).map((text) => ({ text, role: "meta" as const })),
    ...(grouped && sessions.length && data.checked && !unpricedThroughout(spend)
      ? fold(pricesChecked(data.checked), inset).map(text => ({ text, role: "meta" as const })) : []),
  ];
  // On short terminals remove decorative whitespace, never measurements or controls.
  if (rows < 28) for (let index = header.length - 1; index >= 0; index--) if (!header[index]!.text) header.splice(index, 1);
  if (grouped && header.length + footer.length > rows - 2) {
    const brandingRows = branding.filter(line => rows >= 28 || line.text).length;
    header.splice(0, brandingRows, { text: `WEEK REPORT  /  ${data.repo}`, role: "meta" });
  }
  if (grouped && header.length + footer.length > rows - 2) {
    for (let index = header.length - 1; index >= 0; index--) {
      if (/^[┌└]/u.test(header[index]!.text)) header.splice(index, 1);
    }
  }
  const height = Math.max(1, rows - 1 - header.length - footer.length);
  const content: Line[] = [];
  const selectedSession = sessions[state.selected];
  let anchor = 0;
  if (state.help) content.push(...helpLines(returnToHome, grouped).flatMap((text) => fold(text, inset).map((part) => ({ text: part }))));
  else (grouped ? INTENT_SOURCES.map(source => ({ source, sessions: sessions.filter(session => intentSourceOf(session) === source) }))
    : [{ source: undefined, sessions }]).forEach(group => {
    const heading = content.length;
    if (group.source) content.push(...fold(weekSourceHeadline(group.source, group.sessions), inset).map(text => ({ text, role: "focus" as const })));
    if (group.source) for (const line of weekSummary(group.sessions, state.usage)) {
      content.push(...fold(line.text, inset).map(text => ({ ...line, text })));
    }
    group.sessions.forEach((session, index) => {
      const selected = session === selectedSession;
      // Opening totals starts at the source heading, even for a later selected record.
      if (selected) anchor = grouped && state.selected === 0 ? 0
        : index === 0 || (grouped && state.usage) ? heading : content.length;
      content.push(...entry(session, selected, state, data, inset));
    });
  });
  if (grouped && !state.help) for (const line of weekCoverage(spend, sessions)) {
    content.push(...fold(line.text, inset).map(text => ({ ...line, text })));
  }
  if (!sessions.length && !state.help) content.push(...fold(data.sessions.length ? "No matches. Esc clears filters." : 'No sessions. Run session start "your intent" --scope <paths>.', inset).map((text) => ({ text })));
  const maxScroll = Math.max(0, content.length - anchor - height);
  const start = Math.min(anchor + Math.min(state.scroll, maxScroll), Math.max(0, content.length - height));
  const body = content.slice(start, start + height);
  while (body.length < height) body.push({ text: "" });
  const paint = (line: Line): string => {
    const prefix = line.prefix ?? "";
    const padding = theme.paint("  ", "text", line.selected);
    return padding + theme.paint(prefix, line.selected ? "focus" : "meta", line.selected) +
      theme.paint(fit(line.text, inset - cellWidth(prefix)), line.role, line.selected) + padding;
  };
  return { lines: [...header, ...body, ...footer].map(paint), maxScroll };
}
