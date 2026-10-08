import { agentsOf, type AgentInfo } from "../../agents.js";
import { intentSourceOf, type Session } from "../../store.js";
import type { WriteCheckEvent } from "../../write-check-event.js";
import { plainPalette, plainUiTheme, type Palette, type UiTheme } from "../palette.js";
import { NO_AGENT, windowOf } from "../terminal/agents.js";
import { intentOf } from "../terminal/intent.js";
import { plural } from "../terminal/text.js";
import { agentEvidenceLines } from "./agent-evidence.js";
import { paintUiLine, sessionHeader, type UiLine } from "./chrome.js";
import { navigate, SCROLL_STEP, type UiState } from "./state.js";
import { fit, fold } from "./text.js";

export interface AgentSessionsSource {
  sessions: Session[]; checks: ReadonlyMap<string, readonly WriteCheckEvent[]>;
  known: readonly AgentInfo[]; repo: string; days?: number;
}
export interface AgentSessionsUiData extends AgentSessionsSource { agent: string | null }

/** Native capture membership, including legacy counters; check events never invent membership. */
export function selectAgentSessions(data: AgentSessionsSource, agent: string | null): AgentSessionsUiData {
  return { ...data, agent, sessions: data.sessions.filter(session => {
    const names = agentsOf(session.cost, data.known);
    return agent === null ? !names.length : names.includes(agent);
  }).reverse() };
}
export function visibleAgentSessions(data: AgentSessionsUiData, state: UiState): Session[] {
  const terms = state.query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  return data.sessions.filter(session => terms.every(term => [session.id, intentOf(session),
    ...agentEvidenceLines(session, data.checks.get(session.id) ?? [], data.known)].join(" ").toLowerCase().includes(term)));
}
export const navigateAgentSessions: typeof navigate = (state, key, count, maxScroll) => {
  if (!state.searching && !state.help && (key.name === "e" || (!key.ctrl && ["o", "s", "d"].includes(key.name ?? "")))) return state;
  return navigate(state, key, count, maxScroll);
};

/** Full local records in a bounded viewport; selected rows retain all bindings and checks. */
export function renderAgentSessionsUi(data: AgentSessionsUiData, state: UiState, columns: number, rows: number,
  _palette: Palette = plainPalette, notice = "", theme: UiTheme = plainUiTheme): { lines: string[]; maxScroll: number } {
  const width = Math.max(1, columns - 5);
  if (columns < 60 || rows < 20) return { lines: fold("Resize to at least 60 columns and 20 rows, or q to return to coding tools.", Math.max(1, columns - 1)).slice(0, Math.max(1, rows - 1)), maxScroll: 0 };
  const sessions = visibleAgentSessions(data, state); const selected = sessions[state.selected];
  const add = (lines: UiLine[], text: string, role: UiLine["role"] = "text", chosen = false): void => {
    lines.push(...fold(text, width).map(text => ({ text, role, selected: chosen })));
  };
  const branding = sessionHeader(data.repo, data.agent ?? NO_AGENT, "TOOL SESSIONS", width).filter(line => rows >= 28 || line.text);
  const header = [...branding, { text: fit(`${plural(sessions.length, "matching session", "matching sessions")} · ${windowOf(data.days)}`, width), role: "meta" as const }];
  const search = state.searching ? fold(state.query + "▌", width - 2).at(-1)! : state.query || "/ Search goals, IDs or write checks";
  header.push({ text: `> ${fit(search, width - 2)}`, role: "focus" });
  add(header, "Checks record decisions, not completed writes", "meta");
  const detailed = fold(notice, width).length > 1;
  const footer: UiLine[] = [{ text: "─".repeat(width), role: "meta" }];
  add(footer, "/ Search · ↑↓ Select · Enter Details · PgUp/PgDn Scroll", "focus");
  add(footer, "r Refresh · ? Help · Esc Clear/Back · q Tools · Ctrl-C Exit", "focus");
  add(footer, detailed ? "Status details above · PgUp/PgDn scroll" : notice || `Session ${selected ? state.selected + 1 : 0}/${sessions.length}`, "meta");
  if (header.length + footer.length > rows - 1 - SCROLL_STEP) header.splice(0, branding.length, { text: "TOOL SESSIONS", role: "meta" });
  const content: UiLine[] = []; let anchor = 0;
  if (detailed) add(content, notice, "focus");
  if (state.help) ["KEYBOARD", "/ searches goals, session IDs, tool names, check paths and reason codes",
    "↑↓ or j/k selects; Home/End selects first/last; Enter expands or collapses",
    "PgUp/PgDn or Ctrl-U/Ctrl-D scroll; r rereads the current range",
    "All tools in a mixed session stay visible; usage is for the whole session",
    "silent leaves editor permissions in charge; not-checked means the check did not finish",
    "No recorded check is unknown, not zero asks or denials",
    "? closes help; Esc clears search before Tools; q Tools; Ctrl-C exits the workspace"].forEach(text => add(content, text));
  else sessions.forEach((session, index) => {
    if (session === selected && !detailed) anchor = index === 0 ? 0 : content.length;
    add(content, `${session === selected ? ">" : " "} ${session.id}`, "focus");
    add(content, intentOf(session), "intent", session === selected);
    add(content, `${session.outcome} · ${intentSourceOf(session)}`, "meta");
    if (session === selected && state.expanded && !state.searching) {
      add(content, `Started: ${session.startedAt} · Ended: ${session.endedAt ?? "still running"}`, "meta");
      agentEvidenceLines(session, data.checks.get(session.id) ?? [], data.known).forEach(text => add(content, text));
    }
    content.push({ text: "" });
  });
  if (!sessions.length && !state.help) add(content, data.sessions.length ? "No matches. Esc clears search." : "No recorded sessions for this tool in the selected range.");
  const height = Math.max(1, rows - 1 - header.length - footer.length);
  const maxScroll = Math.max(0, content.length - anchor - height);
  const start = Math.min(anchor + Math.min(state.scroll, maxScroll), Math.max(0, content.length - height));
  const body = content.slice(start, start + height); while (body.length < height) body.push({ text: "" });
  return { lines: [...header, ...body, ...footer].map(line => paintUiLine(line, { width, left: 2, terminalWidth: columns - 1 }, theme)), maxScroll };
}
