import { renderWeek } from "../render/html.js";
import { renderMarkdownWeek } from "../render/markdown.js";
import type { UiData } from "../render/tui/screen.js";
import { parseQuery, selectedFilters, visibleSessions, type UiState } from "../render/tui/state.js";
import type { UiBrowserAction } from "./ui.js";
import { copyToClipboard, openInBrowser, writeWeekPage, type WeekOptions } from "./week.js";

/** Export the loaded view, without another read or an outcome sweep. */
function report(data: UiData, state: UiState) {
  const filters = selectedFilters(state);
  if (parseQuery(state.query).error || filters.some(([, value]) => value === "invalid")) {
    throw new Error("Fix the search or clear filters with Esc before exporting.");
  }
  if (data.days === undefined) throw new Error("Choose a Week range before exporting.");
  const selection = [...filters.map(([key, value]) => `${key}:${value}`),
    ...(state.query.trim() ? [`search: ${state.query.trim()}`] : [])].join(" · ") || "all sessions";
  return { sessions: visibleSessions(data.sessions, state), days: data.days,
    view: { rates: data.rates, checked: data.checked, agents: data.agents, tokens: state.usage, selection } };
}

export function weekExportActions(options: WeekOptions = {}): readonly UiBrowserAction[] {
  return [
    { key: "c", label: "Copy Markdown", run: async (data, state) => {
      const { sessions, days, view } = report(data, state);
      await copyToClipboard(renderMarkdownWeek(sessions, days, view), options);
      return `Copied Markdown · ${sessions.length} matching sessions · last ${days} days.`;
    } },
    { key: "h", label: "Open HTML", run: async (data, state) => {
      const { sessions, days, view } = report(data, state);
      const file = await writeWeekPage(renderWeek(sessions, days, {}, view), options);
      try { await openInBrowser(file, options); }
      catch { throw new Error(`HTML saved. Open ${file} yourself.`); }
      return `Opened HTML · ${sessions.length} matching sessions · last ${days} days.`;
    } },
  ];
}
