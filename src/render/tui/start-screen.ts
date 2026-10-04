import type { Session } from "../../store.js";
import { plainUiTheme, type UiRole, type UiTheme } from "../palette.js";
import { characters, type StartState } from "./start-state.js";
import { cellWidth, fit, fold } from "./text.js";
/** Text rendition of the supplied open-ring mark; no terminal image protocol needed. */
export const SESSION_MARK = ["⠀⠀⢀⣠⣄⠀⠀⠀", "⠀⣰⠋⠀⠀⠀⣆⠀", "⠀⠹⣄⠀⠀⣠⠏⠀", "⠀⠀⠈⠙⠋⠁⠀⠀"] as const;
export interface StartView {
  repo: string;
  branch: string;
  draft: StartState;
  session?: Session;
  notice?: string;
  busy?: boolean;
  capturedOpen?: boolean;
  outcomeKnown?: boolean;
}
interface Line { text: string; role?: UiRole; selected?: boolean; anchor?: boolean }

/** Every record-supplied word passes through fold/fit before it is painted. */
export function renderStartUi(view: StartView, columns: number, rows: number,
  theme: UiTheme = plainUiTheme): { lines: string[]; maxScroll: number } {
  const terminalWidth = Math.max(1, columns - 1);
  if (columns < 60 || rows < 20) return {
    lines: fold("Resize to at least 60 columns and 20 rows. Esc exits; an open session stays open.", terminalWidth)
      .slice(0, Math.max(1, rows - 1)), maxScroll: 0,
  };
  const width = Math.min(82, terminalWidth - 8);
  const left = Math.max(2, Math.floor((terminalWidth - width) / 2));
  const phase = !view.session ? "NEW SESSION" : view.session.endedAt === null ? "SESSION OPEN" : "SESSION FINISHED";
  const captions = ["SESSION", view.repo, view.branch, phase];
  const header: Line[] = [
    ...SESSION_MARK.map((mark, i) => ({ text: mark + "   " + fit(captions[i]!, width - 11), role: i === 0 ? "intent" as const : "meta" as const })),
    { text: "" }, { text: "─".repeat(width), role: "meta" }, { text: "" },
  ];
  const body: Line[] = [];
  const add = (text: string, role: UiRole = "text"): void => {
    body.push(...fold(text, width).map(part => ({ text: part, role })));
  };
  if (!view.session) {
    add("What are you building?", "intent");
    add("A clear goal before the work begins.", "meta");
    add("");
    add("YOUR GOAL", "meta");
    field(view.draft.goal, view.draft.goalCursor, view.draft.field === "goal", "Describe the change in your own words.", width, body);
    add("");
    if (view.draft.scopeOpen) {
      add("EXPECTED FILES  /  OPTIONAL", "meta");
      field(view.draft.scope, view.draft.scopeCursor, view.draft.field === "scope", "One file or folder per line.", width, body);
      add("Blank means no file boundaries. Spaces in a path stay intact.", "meta");
    } else add("Tab adds expected files, if you know them.", "meta");
    add("");
    body.push({ text: `${view.draft.field === "start" ? ">" : " "} Start session`, role: "focus", selected: view.draft.field === "start", anchor: view.draft.field === "start" });
    add("Your goal and file boundaries stay fixed once you start.", "meta");
    if (view.capturedOpen) add("Starting will close the session the editor hook opened.", "meta");

  } else {
    add("Your plan is on the record.", "intent");
    add("q returns to the terminal; your session stays open.", "meta");
  }
  const footer: Line[] = [{ text: "─".repeat(width), role: "meta" },
    ...fold(view.notice || (view.busy ? "Saving the record…" : view.session
      ? "PgUp/PgDn scroll · q or Esc returns to the terminal."
      : "Tab next · Ctrl-S start · Esc cancel · PgUp/PgDn scroll"), width).map(text => ({ text, role: "focus" as const })),
    { text: "Stored on your machine.", role: "meta" }];
  if (rows < 26) for (let i = header.length - 1; i >= 0; i--) if (!header[i]!.text) header.splice(i, 1);
  const height = Math.max(1, rows - 1 - header.length - footer.length);
  const maxScroll = Math.max(0, body.length - height);
  let start = Math.min(view.draft.scroll, maxScroll);
  const anchor = body.findIndex(line => line.anchor);
  if (!view.session && view.draft.followCursor && anchor >= 0) {
    if (anchor < start) start = anchor;
    if (anchor >= start + height) start = anchor - height + 1;
  }
  const visible = body.slice(start, start + height);
  while (visible.length < height) visible.push({ text: "" });
  const paint = (line: Line): string => theme.paint(" ".repeat(left)) +
    theme.paint(fit(line.text, width), line.role, line.selected) + theme.paint(" ".repeat(terminalWidth - left - width));
  return { lines: [...header, ...visible, ...footer].map(paint), maxScroll };
}

function field(value: string, position: number, focused: boolean, placeholder: string, width: number, lines: Line[]): void {
  const parts = characters(value);
  if (focused) parts.splice(position, 0, "▌");
  const role = focused ? "focus" : "text";
  lines.push({ text: `┌${"─".repeat(width - 2)}┐`, role });
  const paragraphs = (value || focused ? parts.join("") : placeholder).split("\n");
  for (const paragraph of paragraphs) for (const part of fold(paragraph, width - 6)) {
    lines.push({ text: `│ > ${part}${" ".repeat(Math.max(0, width - 6 - cellWidth(part)))} │`,
      role: value || focused ? role : "meta", anchor: focused && part.includes("▌") });
  }
  lines.push({ text: `└${"─".repeat(width - 2)}┘`, role });
}
