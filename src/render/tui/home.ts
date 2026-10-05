import { hasDeclaredScope, intentSourceOf } from "../../store.js";
import { plainUiTheme, type UiRole, type UiTheme } from "../palette.js";
import { wentOutside, WHERE_IT_WENT } from "../terminal/brief-sentences.js";
import type { Home } from "../terminal/home.js";
import { intentOf, INTENT_NOTE } from "../terminal/intent.js";
import { shortId } from "../terminal/text.js";
import { paintUiLine, sessionHeader, type UiLine } from "./chrome.js";
import type { UiScreen } from "./navigation.js";
import { fold } from "./text.js";

export interface HomeView {
  repo: string;
  branch: string;
  /** Read-only homeState result, with the latest finished outcome resolved against the repo. */
  home: Home;
  selected?: number;
  scroll?: number;
}
export interface HomeAction { label: string; screen: UiScreen; selectedSessionId?: string }

export function homeActions(home: Home): readonly HomeAction[] {
  if (home.running) return [
    { label: "Resume session", screen: "start", selectedSessionId: home.running.id },
    { label: "Session history", screen: "sessions" },
  ];
  if (home.last) return [
    { label: "Review last session", screen: "sessions", selectedSessionId: home.last.id },
    { label: "Start session", screen: "start" },
  ];
  return [{ label: "Start session", screen: "start" }, { label: "Capture setup", screen: "hooks" }];
}

/** Presentation only: visiting Home cannot start, settle, or patch a session. */
export function renderHomeUi(view: HomeView, columns: number, rows: number,
  theme: UiTheme = plainUiTheme): { lines: string[]; maxScroll: number } {
  const terminalWidth = Math.max(1, columns - 1);
  if (columns < 60 || rows < 20) return {
    lines: fold("Resize to at least 60 columns and 20 rows. q exits.", terminalWidth)
      .slice(0, Math.max(1, rows - 1)), maxScroll: 0,
  };
  const width = Math.min(82, terminalWidth - 8);
  const left = Math.max(2, Math.floor((terminalWidth - width) / 2));
  const header = sessionHeader(view.repo, view.branch, "OVERVIEW", width);
  if (rows < 26) for (let i = header.length - 1; i >= 0; i--) if (!header[i]!.text) header.splice(i, 1);
  const content: UiLine[] = [];
  const add = (text: string, role: UiRole = "text"): void => {
    content.push(...fold(text, width).map(part => ({ text: part, role })));
  };
  const session = view.home.running ?? view.home.last;
  add(view.home.running ? "Session is recording." : session ? WHERE_IT_WENT[session.outcome] : "No sessions recorded in this repo yet.");
  if (session) {
    add(`${view.home.running ? "Active" : "Latest finished"} session · ${shortId(session.id)}`, "meta");
    add(""); add("RECORDED GOAL", "meta"); add(intentOf(session), "intent");
    const note = INTENT_NOTE[intentSourceOf(session)];
    if (note && session.intent !== null) add(note, "meta");
    add("");
    if (view.home.running) add("Resume here to finish and review when you are ready.", "meta");
    else if (!session.reality.length) add("This session changed no files.", "meta");
    else if (!hasDeclaredScope(session)) add("No file boundaries declared. Outside-plan changes are not measured.", "meta");
    else {
      const outside = wentOutside(session);
      add(outside.before + outside.paths + outside.after, session.drift.length ? "drift" : "meta");
    }
  } else add("Start with a goal before you build. Session records what changed.", "meta");
  const actions = homeActions(view.home);
  const selected = Math.max(0, Math.min(actions.length - 1, view.selected ?? 0));
  const footer: UiLine[] = [{ text: "─".repeat(width), role: "meta" },
    ...actions.map((action, i) => ({ text: `${i === selected ? ">" : " "} ${action.label}`, role: i === selected ? "focus" as const : "text" as const, selected: i === selected })),
    ...fold("↑↓ Select · Enter Open · m Menu · q Exit", width).map(text => ({ text, role: "focus" as const })),
    { text: "PgUp/PgDn Scroll", role: "meta" }];
  const height = rows - 1 - header.length - footer.length;
  const maxScroll = Math.max(0, content.length - height);
  const start = Math.max(0, Math.min(view.scroll ?? 0, maxScroll));
  const body = content.slice(start, start + height);
  while (body.length < height) body.push({ text: "" });
  return { lines: [...header, ...body, ...footer].map(line => paintUiLine(line, { width, left, terminalWidth }, theme)), maxScroll };
}
