import { plainPalette, plainUiTheme, type Palette, type UiRole, type UiTheme } from "../palette.js";
import { fillTemplate, placeholderList, prParts, renderPr } from "../pr.js";
import { intentOf } from "../terminal/intent.js";
import { day, shortId } from "../terminal/text.js";
import { intentSourceOf, type Session } from "../../store.js";
import type { RateTable } from "../../pricing.js";
import { paintUiLine, sessionHeader, type UiLine } from "./chrome.js";
import type { UiData } from "./screen.js";
import { canReturnHome, HISTORY_FILTERS, initialState, navigate, parseQuery, visibleSessions, type UiState } from "./state.js";
import { fit, fold } from "./text.js";

export interface PrUiTemplate { path: string; source: string }

/** Preview and exports use the same native document, without terminal wrapping. */
export function prUiDocument(session: Session, rates: RateTable, template?: PrUiTemplate): string {
  return template ? fillTemplate(template.source, prParts(session, rates), template.path) : renderPr(session, rates);
}

const HELP = [
  "KEYBOARD",
  "↑↓ / j k Select a session; Home/End selects first/last",
  "Enter opens or closes its Markdown preview",
  "/ Search text or session ID; Enter finishes typing",
  "o / s / d Cycle recorded result, goal source, outside plan",
  "Search supports outcome:, source: and outside: filters",
  "Results are recorded; r reloads the record without resolving outcomes",
  "t Choose a local Markdown template; blank restores the default",
  "c Copy the selected Markdown description; f save it to a new file",
  "Saving keeps existing files; choose another name if one already exists",
  "Relative paths start in the directory you launched session from",
  `Supported placeholders: ${placeholderList()}`,
  "PgUp/PgDn or Ctrl-U/Ctrl-D scroll through the full preview",
  "Esc closes help, search, preview or filters before returning Home",
  "q returns Home; Ctrl-C exits",
];

export const canReturnPrHome: typeof canReturnHome = state => !state.expanded && canReturnHome(state);
export const navigatePr: typeof navigate = (state, key, count, maxScroll) => {
  if (!state.searching && !state.help && (key.name === "e" || (count === 0 && key.name === "return"))) return state;
  if (!state.searching && !state.help && key.name === "escape") {
    return state.expanded ? { ...state, expanded: false, scroll: 0 } : { ...initialState(), expanded: false };
  }
  const next = navigate(state, key, count, maxScroll);
  return state.searching || key.sequence === "/" ? { ...next, expanded: false } : next;
};

/** The native Markdown, wrapped safely for a terminal; every line remains reachable. */
export function renderPrUi(data: UiData & { template?: PrUiTemplate }, state: UiState, columns: number, rows: number,
  _palette: Palette = plainPalette, notice = "", theme: UiTheme = plainUiTheme): { lines: string[]; maxScroll: number } {
  const template = data.template;
  const width = Math.max(1, columns - 5);
  if (columns < 60 || rows < 20) return {
    lines: fold("Resize to at least 60 columns and 20 rows, or q to return Home.", Math.max(1, columns - 1)).slice(0, Math.max(1, rows - 1)), maxScroll: 0,
  };
  const sessions = visibleSessions(data.sessions, state);
  const selected = sessions[state.selected];
  const preview = state.expanded && !state.searching && selected !== undefined;
  const branding = sessionHeader(data.repo, data.branch ?? "Branch unavailable", "PULL REQUEST", width);
  const header = [...branding];
  const add = (lines: UiLine[], text: string, role: UiRole = "text", selected = false): void => {
    lines.push(...fold(text, width).map(text => ({ text, role, selected })));
  };
  if (preview) {
    add(header, `${shortId(selected.id)} · ${intentSourceOf(selected)} · ${selected.endedAt === null ? "Running; stop to record changed files" : "Finished session"}`, "meta");
    add(header, `Format: ${template ? "custom template snapshot" : "default"}`, "meta");
    add(header, "MARKDOWN PREVIEW", "focus");
  } else {
    const search = state.searching ? state.query + "▌" : state.query || "/ Search recorded sessions";
    header.push({ text: `> ${fit(state.searching ? fold(search, width - 2).at(-1)! : search, width - 2)}`, role: "focus" });
    add(header, HISTORY_FILTERS.map(filter => `[${filter.shortcut}] ${filter.key === "outcome" ? "Recorded result" : filter.label}: ${filter.values[state[filter.key]] ?? "invalid"}`).join(" · "), "focus");
    const query = parseQuery(state.query);
    if (query.error || query.filters.length) add(header, query.error ?? `Search filters: ${[...new Set(query.filters.map(([key, value]) => `[${key}:${value}]`))].join(" ")}`, "focus");
    add(header, `${sessions.length} matching sessions · all recorded history`, "meta");
  }
  const details = fold(notice, width);
  const footer: UiLine[] = [{ text: "─".repeat(width), role: "meta" }];
  add(footer, preview ? "↑↓ Select · Enter / Esc Sessions · PgUp/PgDn Scroll" : "/ Search · ↑↓ Select · Enter Preview · Esc Back/Clear", "focus");
  add(footer, "[c] Copy Markdown · [f] Save file · [t] Template", "focus");
  add(footer, "r Refresh · ? Help · q Home · Ctrl-C Exit", "focus");
  add(footer, details.length > 1 ? "Status details above · PgUp/PgDn scroll" : notice || `Session ${selected ? state.selected + 1 : 0}/${sessions.length}`, "meta");
  if (rows < 28) for (let i = header.length - 1; i >= 0; i--) if (!header[i]!.text) header.splice(i, 1);
  if (header.length + footer.length > rows - 2) header.splice(0, branding.filter(line => rows >= 28 || line.text).length, { text: `PULL REQUEST / ${data.repo}`, role: "meta" });
  const content: UiLine[] = [];
  if (details.length > 1) add(content, notice, "focus");
  let anchor = 0;
  if (state.help) HELP.forEach(text => add(content, text));
  else if (preview) {
    const cost = `_${prParts(selected, data.rates).cost}_`;
    if (template) add(content, `Template file: ${template.path}`, "meta");
    const document = prUiDocument(selected, data.rates, template);
    document.split("\n").forEach((line, index) => {
      add(content, line, template ? "text" : line === cost ? "meta" : index === 0 ? "intent" : "text");
    });
  } else sessions.forEach((session, index) => {
    if (session === selected && details.length <= 1) anchor = content.length;
    add(content, `${index === state.selected ? ">" : " "} ${shortId(session.id)} · ${day(session.startedAt)} · ${intentSourceOf(session)} · ${session.endedAt === null ? "running" : `recorded ${session.outcome}`}`, "meta", session === selected);
    content.push({ text: fit(intentOf(session), width), role: "intent", selected: session === selected }, { text: "" });
  });
  if (!sessions.length && !state.help) add(content, data.sessions.length ? "No matches. Esc clears filters." : "No sessions yet. Start a session, then stop it to record changes.");
  const height = Math.max(1, rows - 1 - header.length - footer.length);
  const maxScroll = Math.max(0, content.length - anchor - height);
  const start = Math.min(anchor + Math.min(state.scroll, maxScroll), Math.max(0, content.length - height));
  const body = content.slice(start, start + height);
  while (body.length < height) body.push({ text: "" });
  return { lines: [...header, ...body, ...footer].map(line => paintUiLine(line, { width, left: 2, terminalWidth: columns - 1 }, theme)), maxScroll };
}
