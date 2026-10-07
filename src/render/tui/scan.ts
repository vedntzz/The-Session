import { sep } from "node:path";
import type { RateTable } from "../../pricing.js";
import { UNKNOWN_REPO, type ScannedSession } from "../../scan.js";
import { plainPalette, plainUiTheme, type Palette, type UiRole, type UiTheme } from "../palette.js";
import { day, shortId } from "../terminal/text.js";
import { scanLandingLine, scanReportLines, scanUsageLines } from "../scan-report.js";
import { paintUiLine, sessionHeader, type UiLine } from "./chrome.js";
import { navigate, SCROLL_STEP, type UiState } from "./state.js";
import { fit, fold } from "./text.js";

export interface ScanUiData {
  sessions: ScannedSession[]; rates: RateTable; days: number; repo: string; root: string; present: boolean;
  currentRepos: readonly string[]; restriction?: string; checked?: string;
}
export const SCAN_WINDOWS = [7, 14, 30] as const;
const PROJECTS = ["all", "current", "unknown"];
const HELP = [
  "KEYBOARD", "w cycles 7 / 14 / 30 days; p cycles all / current / unknown project",
  "Search combines text with repo:all, repo:current or repo:unknown",
  "Enter expands the first prompt; PgUp/PgDn or Ctrl-U/Ctrl-D scroll",
  "u shows usage; the matching activity report is below the transcript list",
  "c copies matching sessions as Markdown; h opens a local HTML report",
  "Home/End selects first/last; Home also reveals the reader directory",
  "No diff: changed files, drift and turns that changed no files are not measured",
  "Commit overlap is only a coincidence in time; unknown stays unknown",
  "Esc closes help/search or clears filters before Home; q Home; Ctrl-C Exit",
];
export function scanQuery(query: string): { terms: string[]; project: string; error?: string } {
  const tokens = query.toLowerCase().trim().split(/\s+/u).filter(Boolean);
  const projects = tokens.filter(token => token.startsWith("repo:")).map(token => token.slice(5));
  const error = projects.some(project => !PROJECTS.includes(project)) ? "repo: use all / current / unknown"
    : new Set(projects).size > 1 ? "Use one repo: filter: all / current / unknown" : undefined;
  return { terms: tokens.filter(token => !token.startsWith("repo:")), project: projects[0] ?? "all", error };
}
export function visibleScanned(data: ScanUiData, state: UiState): ScannedSession[] {
  const { terms, project, error } = scanQuery(state.query);
  if (error) return [];
  return data.sessions.filter(session => terms.every(term => `${session.id} ${session.label} ${session.repo}`.toLowerCase().includes(term)) &&
    (project === "all" || (project === "unknown" ? session.repo === UNKNOWN_REPO : session.repo !== UNKNOWN_REPO &&
      data.currentRepos.some(dir => session.repo === dir || session.repo.startsWith(dir.endsWith(sep) ? dir : dir + sep)))));
}
export const navigateScan: typeof navigate = (state, key, count, maxScroll) => {
  if (!state.searching && !state.help) {
    const name = key.name ?? key.sequence;
    if (!key.ctrl && name === "u") return { ...state, usage: !state.usage, scroll: 0 };
    if (name === "e" || (!key.ctrl && ["o", "s", "d"].includes(name ?? ""))) return state;
    if (!key.ctrl && name === "p") {
      const next = PROJECTS[(PROJECTS.indexOf(scanQuery(state.query).project) + 1) % PROJECTS.length]!;
      const text = state.query.trim().split(/\s+/u).filter(token => token && !/^repo:/iu.test(token));
      return { ...state, query: [...text, ...(next === "all" ? [] : [`repo:${next}`])].join(" "), selected: 0, scroll: 0 };
    }
  }
  return navigate(state, key, count, maxScroll);
};

/** Transcript text is safely wrapped; no outcome, diff or empty-turn evidence is invented. */
export function renderScanUi(data: ScanUiData, state: UiState, columns: number, rows: number,
  _palette: Palette = plainPalette, notice = "", theme: UiTheme = plainUiTheme): { lines: string[]; maxScroll: number } {
  const width = Math.max(1, columns - 5);
  if (columns < 60 || rows < 20) return { lines: fold("Resize to at least 60 columns and 20 rows, or q to return Home.", Math.max(1, columns - 1)).slice(0, Math.max(1, rows - 1)), maxScroll: 0 };
  const sessions = visibleScanned(data, state); const query = scanQuery(state.query);
  const selected = sessions[state.selected];
  const add = (lines: UiLine[], text: string, role: UiRole = "text", chosen = false): void => {
    lines.push(...fold(text, width).map(text => ({ text, role, selected: chosen })));
  };
  const branding = sessionHeader(data.repo, "Local Claude Code transcripts", "TOOL ACTIVITY", width)
    .filter(line => rows >= 28 || line.text);
  const header = [...branding];
  add(header, `${sessions.length} matching tool sessions · last ${data.days} days`, "meta");
  const search = state.searching ? fold(state.query + "▌", width - 2).at(-1)! : state.query || "/ Search prompts, IDs or directories";
  header.push({ text: `> ${fit(search, width - 2)}`, role: "focus" });
  add(header, `[w] Range: ${data.days} days · [p] Project: ${query.error ? "invalid" : query.project}`, "focus");
  add(header, `[u] Usage: ${state.usage ? "hide" : "show"} · [c] Copy Markdown · [h] Open HTML`, "focus");
  add(header, query.error ?? `First prompts · no diff recorded${data.restriction ? " · restricted reader" : ""}`, query.error ? "focus" : "meta");
  const footer: UiLine[] = [{ text: "─".repeat(width), role: "meta" }];
  add(footer, "/ Search · ↑↓ Select · Enter Details · PgUp/PgDn Scroll", "focus");
  add(footer, "r Refresh · ? Help · Esc Clear/Back · q Home · Ctrl-C Exit", "focus");
  const detailed = fold(notice, width).length > 1;
  add(footer, detailed ? "Status details above · PgUp/PgDn scroll" : notice || `Session ${selected ? state.selected + 1 : 0}/${sessions.length}`, "meta");
  // Keep a full paging step visible; a shorter body would skip transcript rows.
  if (header.length + footer.length > rows - 1 - SCROLL_STEP) header.splice(0, branding.length, { text: `TOOL ACTIVITY / ${data.repo}`, role: "meta" });
  const content: UiLine[] = []; let anchor = 0;
  if (detailed) add(content, notice, "focus");
  if (data.restriction) add(content, `Reader limited to directory: ${data.restriction}`, "meta");
  if (state.help) HELP.forEach(text => add(content, text));
  else sessions.forEach((session, index) => {
    const chosen = session === selected;
    if (chosen && !detailed) anchor = index === 0 ? 0 : content.length;
    add(content, `${chosen ? ">" : " "} ${shortId(session.id)} · ${day(session.startedAt)}`, "meta", chosen);
    if (chosen && state.expanded && !state.searching) {
      session.label.split("\n").forEach(line => add(content, line, "intent", true));
      add(content, `ID ${session.id}`, "meta"); add(content, `Directory ${session.repo || "not recorded"}`, "meta");
      add(content, `First counted call ${session.startedAt} · Last counted call ${session.endedAt}`, "meta");
      add(content, scanLandingLine(session.landed), "meta");
      if (state.usage) scanUsageLines(session.cost, data.rates, data.checked).forEach(line => add(content, line, "meta"));
    } else content.push({ text: fit(session.label, width), role: "intent", selected: chosen });
    content.push({ text: "" });
  });
  if (state.usage && sessions.length && !state.help) {
    add(content, "ACTIVITY REPORT · MATCHING TOOL SESSIONS", "focus");
    scanReportLines(sessions, data.days, data.rates, [], width, data.checked).forEach(line => add(content, line, "meta"));
  }
  if (!sessions.length && !state.help) add(content, !data.present ? `No Claude Code transcripts to scan. Looked in ${data.root}` : query.error ?? (data.sessions.length ? "No matches. Esc clears filters." : `No tool sessions in the last ${data.days} days.`));
  const height = Math.max(1, rows - 1 - header.length - footer.length);
  const maxScroll = Math.max(0, content.length - anchor - height);
  const start = Math.min(anchor + Math.min(state.scroll, maxScroll), Math.max(0, content.length - height));
  const body = content.slice(start, start + height); while (body.length < height) body.push({ text: "" });
  return { lines: [...header, ...body, ...footer].map(line => paintUiLine(line, { width, left: 2, terminalWidth: columns - 1 }, theme)), maxScroll };
}
