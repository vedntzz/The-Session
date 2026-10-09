import { plainUiTheme, type UiTheme } from "../palette.js";
import { paintUiLine, sessionHeader, type UiLine } from "./chrome.js";
import type { UiScreen } from "./navigation.js";
import { fold } from "./text.js";

interface MenuItem { screen: UiScreen; label: string; hint: string; group: string }
export const UI_MENU: readonly MenuItem[] = [
  { screen: "home", label: "Overview", hint: "See the current session and your next steps.", group: "WORK" },
  { screen: "start", label: "Start session", hint: "Record your goal before the work begins.", group: "WORK" },
  { screen: "sessions", label: "Session history", hint: "Browse goals, changed files and recorded evidence.", group: "WORK" },
  { screen: "week", label: "Week report", hint: "Review what landed and what went outside the plan.", group: "WORK" },
  { screen: "pr", label: "Pull request", hint: "Prepare a description from a session's record.", group: "WORK" },
  { screen: "agreement", label: "Agreements", hint: "Review file boundaries, actions and accepted terms.", group: "WORK" },
  { screen: "scan", label: "Tool activity", hint: "Review local activity captured from coding tools.", group: "INSIGHTS" },
  { screen: "agents", label: "Coding tool activity", hint: "See which tools contributed to recorded sessions.", group: "INSIGHTS" },
  { screen: "debt", label: "Recurring misses", hint: "Find files repeatedly changed outside the plan.", group: "INSIGHTS" },
  { screen: "outcomes", label: "Work outcomes", hint: "Review Git evidence and record outcomes for finished work.", group: "INSIGHTS" },
  { screen: "survival", label: "Follow-up checks", hint: "Check whether recorded changes are still present.", group: "INSIGHTS" },
  { screen: "knowledge", label: "Project knowledge", hint: "Explore links between recorded sessions and files.", group: "INSIGHTS" },
  { screen: "hooks", label: "Capture setup", hint: "Review capture status and supported tool hooks.", group: "SETUP" },
  { screen: "peers", label: "Team records", hint: "Browse records shared through your Git remote.", group: "SETUP" },
  { screen: "sync", label: "Sync records", hint: "Choose when to push or pull recorded metadata.", group: "SETUP" },
  { screen: "verify", label: "Verify records", hint: "Check record signatures and the local chain.", group: "SETUP" },
  { screen: "key", label: "Signing key", hint: "View and copy your public signing key.", group: "SETUP" },
  { screen: "attribution", label: "Attribution", hint: "Set supported identity fields for future sessions.", group: "SETUP" },
  { screen: "help", label: "Help", hint: "Find controls and available Session commands.", group: "SETUP" },
];
export interface MenuView { repo: string; branch: string; selected: UiScreen }

export function moveMenuSelection(selected: UiScreen, delta: number): UiScreen {
  const index = UI_MENU.findIndex(item => item.screen === selected);
  return UI_MENU[Math.max(0, Math.min(UI_MENU.length - 1, index + delta))]!.screen;
}

/** Selection follows into view on every render, including after a terminal resize. */
export function renderUiMenu(view: MenuView, columns: number, rows: number,
  theme: UiTheme = plainUiTheme): { lines: string[] } {
  const terminalWidth = Math.max(1, columns - 1);
  if (columns < 60 || rows < 20) return {
    lines: fold("Resize to at least 60 columns and 20 rows. Esc goes back; q exits.", terminalWidth)
      .slice(0, Math.max(1, rows - 1)),
  };
  const width = Math.min(82, terminalWidth - 8);
  const left = Math.max(2, Math.floor((terminalWidth - width) / 2));
  const header = [...sessionHeader(view.repo, view.branch, "SECTIONS", width), { text: "Choose your next step." }, { text: "" }];
  if (rows < 26) for (let i = header.length - 1; i >= 0; i--) if (!header[i]!.text) header.splice(i, 1);
  const index = UI_MENU.findIndex(item => item.screen === view.selected);
  const selected = UI_MENU[index]!;
  const footer: UiLine[] = [{ text: "─".repeat(width), role: "meta" },
    { text: `${selected.group} · Section ${index + 1} of ${UI_MENU.length}`, role: "meta" },
    ...fold(selected.hint, width).map(text => ({ text, role: "meta" as const })),
    ...fold("↑↓ Select · Enter Open · Esc Back · q Exit", width).map(text => ({ text, role: "focus" as const }))];
  const content: UiLine[] = [];
  let anchor = 0;
  UI_MENU.forEach((item, i) => {
    if (item.group !== UI_MENU[i - 1]?.group) content.push({ text: item.group, role: "meta" });
    if (item.screen === view.selected) anchor = content.length;
    content.push({ text: `${item === selected ? ">" : " "} ${item.label}`, role: item === selected ? "focus" : "text", selected: item === selected });
  });
  const height = rows - 1 - header.length - footer.length;
  const start = Math.max(0, Math.min(anchor - Math.floor(height / 2), content.length - height));
  const body = content.slice(start, start + height);
  while (body.length < height) body.push({ text: "" });
  return { lines: [...header, ...body, ...footer].map(line => paintUiLine(line, { width, left, terminalWidth }, theme)) };
}
