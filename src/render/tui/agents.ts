import { AGENT_WINDOW, type AgentBlock } from "../../agents-report.js";
import { MIN_SESSIONS } from "../../survival.js";
import { plainPalette, plainUiTheme, type Palette, type UiRole, type UiTheme } from "../palette.js";
import { AGENTS_NOTE, NO_AGENT, landed, spent, survived, windowOf, writes } from "../terminal/agents.js";
import { plural } from "../terminal/text.js";
import { paintUiLine, sessionHeader, type UiLine } from "./chrome.js";
import { navigate, SCROLL_STEP, type UiState } from "./state.js";
import { fit, fold } from "./text.js";

export interface AgentsUiData {
  blocks: AgentBlock[]; sessionCount: number; repo: string; days?: number;
}
export const AGENTS_WINDOWS = [undefined, 7, 14, 30] as const;
const HELP = [
  "KEYBOARD", "w cycles all history / 7 / 14 / 30 days; r rereads records and Git outcomes",
  "/ searches coding tool names; ↑↓ or j/k selects; Home/End selects first/last",
  "Enter expands all goal sources for the selected tool; no source is pooled",
  "s opens this tool's sessions, editor IDs and recorded write checks",
  "Goal source: declared = typed; primed = scope reviewed; captured = first prompt",
  "PgUp/PgDn or Ctrl-U/Ctrl-D scroll; ? opens or closes help",
  "Mixed sessions appear under each tool, whole; tool rows cannot be added",
  "No counted calls or no recorded checks stays unknown; missing prices name the model",
  `Survival uses recorded ${AGENT_WINDOW}-day checks, needs ${MIN_SESSIONS} sessions and excludes pending work`,
  "Browsing writes nothing. Esc closes help/search or clears search before Home",
  "q Home · Ctrl-C Exit", AGENTS_NOTE,
];

/** Keys identify view rows, not signed sessions; null cannot collide with a tool name. */
export function visibleAgentBlocks(data: AgentsUiData, state: UiState): (AgentBlock & { id: string })[] {
  const terms = state.query.toLowerCase().trim().split(/\s+/u).filter(Boolean);
  return data.blocks.filter(block => terms.every(term => (block.agent ?? NO_AGENT).toLowerCase().includes(term)))
    .map(block => ({ ...block, id: JSON.stringify(block.agent) }));
}

/** Keep search/help and paging; history-only filters have no meaning for aggregate rows. */
export const navigateAgents: typeof navigate = (state, key, count, maxScroll) => {
  const name = key.name ?? key.sequence;
  if (!state.searching && !state.help && (name === "e" || (!key.ctrl && ["o", "s", "d"].includes(name ?? "")))) return state;
  return navigate(state, key, count, maxScroll);
};

/** Native measurements and wording, with three source rows even for an unused tool. */
export function renderAgentsUi(data: AgentsUiData, state: UiState, columns: number, rows: number,
  _palette: Palette = plainPalette, notice = "", theme: UiTheme = plainUiTheme): { lines: string[]; maxScroll: number } {
  const width = Math.max(1, columns - 5);
  if (columns < 60 || rows < 20) return { lines: fold("Resize to at least 60 columns and 20 rows, or q to return Home.", Math.max(1, columns - 1)).slice(0, Math.max(1, rows - 1)), maxScroll: 0 };
  const blocks = visibleAgentBlocks(data, state);
  const selected = blocks[state.selected];
  const add = (lines: UiLine[], text: string, role: UiRole = "text", chosen = false): void => {
    lines.push(...fold(text, width).map(text => ({ text, role, selected: chosen })));
  };
  const branding = sessionHeader(data.repo, "Recorded coding tools", "CODING TOOL ACTIVITY", width)
    .filter(line => rows >= 28 || line.text);
  const header = [...branding];
  add(header, `${plural(data.sessionCount, "recorded session", "recorded sessions")} · ${windowOf(data.days)}`, "meta");
  const search = state.searching ? fold(state.query + "▌", width - 2).at(-1)! : state.query || "/ Search coding tools";
  header.push({ text: `> ${fit(search, width - 2)}`, role: "focus" });
  add(header, `[w] Range: ${data.days === undefined ? "all history" : `${data.days} days`}`, "focus");
  add(header, "Separate tools and goal sources · mixed sessions repeat", "meta");
  const footer: UiLine[] = [{ text: "─".repeat(width), role: "meta" }];
  add(footer, "/ Search · ↑↓ Select · Enter Details · [s] Sessions", "focus");
  add(footer, "r Refresh · ? Help · Esc Clear/Back · q Home · Ctrl-C Exit", "focus");
  const detailed = fold(notice, width).length > 1;
  add(footer, detailed ? "Status details above · PgUp/PgDn scroll" : notice || `Tool ${selected ? state.selected + 1 : 0}/${blocks.length}`, "meta");
  // A whole paging step must fit, even with branding or a long repository name.
  if (header.length + footer.length > rows - 1 - SCROLL_STEP) {
    header.splice(0, branding.length, { text: fit(`CODING TOOL ACTIVITY / ${data.repo}`, width), role: "meta" });
  }
  const content: UiLine[] = []; let anchor = 0;
  if (detailed) add(content, notice, "focus");
  if (state.help) HELP.forEach(text => add(content, text));
  else {
    if (!blocks.length) add(content, "No matching coding tools. Esc clears search.");
    if (!data.sessionCount) add(content, `No recorded sessions over ${windowOf(data.days)}. Start a session from Home.`);
    blocks.forEach((block, index) => {
      const chosen = block.id === selected?.id;
      if (chosen && !detailed) anchor = index === 0 ? 0 : content.length;
      add(content, `${chosen ? ">" : " "} ${block.agent ?? NO_AGENT}`, "intent", chosen);
      for (const row of block.rows) {
        const summary = `${row.source} · ${row.sessions ? plural(row.sessions, "session", "sessions") : "no sessions"}`;
        add(content, `  ${summary}${row.mixed ? `, ${row.mixed} also under another tool` : ""}`, "text", chosen);
        if (row.sessions && chosen && state.expanded && !state.searching) {
          add(content, `    Landed: ${landed(row)}`, "meta");
          add(content, `    ${AGENT_WINDOW} days: ${survived(row)}`, "meta");
          if (block.agent !== null) add(content, `    Writes: ${writes(row)}`, "meta");
          add(content, `    Cost: ${spent(row, block.agent !== null)}`, "meta");
        }
      }
      content.push({ text: "" });
    });
    add(content, AGENTS_NOTE, "meta");
  }
  const height = Math.max(1, rows - 1 - header.length - footer.length);
  const maxScroll = Math.max(0, content.length - anchor - height);
  const start = Math.min(anchor + Math.min(state.scroll, maxScroll), Math.max(0, content.length - height));
  const body = content.slice(start, start + height); while (body.length < height) body.push({ text: "" });
  return { lines: [...header, ...body, ...footer].map(line => paintUiLine(line,
    { width, left: 2, terminalWidth: columns - 1 }, theme)), maxScroll };
}
