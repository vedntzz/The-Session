import { hasDeclaredScope, type Session } from "../../store.js";
import { plainUiTheme, type UiRole, type UiTheme } from "../palette.js";
import { intentOf, INTENT_NOTE } from "../terminal/intent.js";
import { WHERE_IT_WENT } from "../terminal/brief-sentences.js";
import { intentSourceOf } from "../../store.js";
import { shortId } from "../terminal/text.js";
import { characters, type StartState } from "./start-state.js";
import { cellWidth, fit, fold } from "./text.js";
import { paintUiLine, sessionHeader } from "./chrome.js";

export { SESSION_MARK } from "./chrome.js";
export interface StartView {
  repo: string;
  branch: string;
  draft: StartState;
  session?: Session;
  notice?: string;
  busy?: boolean;
  capturedOpen?: boolean;
  outcomeKnown?: boolean;
  returnToHome?: boolean;
}
interface Line { text: string; role?: UiRole; selected?: boolean; anchor?: boolean }

/** Every record-supplied word passes through fold/fit before it is painted. */
export function renderStartUi(view: StartView, columns: number, rows: number,
  theme: UiTheme = plainUiTheme): { lines: string[]; maxScroll: number } {
  const terminalWidth = Math.max(1, columns - 1);
  const destination = view.returnToHome ? "Home" : "the terminal";
  if (columns < 60 || rows < 20) return {
    lines: fold(`Resize to at least 60 columns and 20 rows. Esc returns to ${destination}; an open session stays open.`, terminalWidth)
      .slice(0, Math.max(1, rows - 1)), maxScroll: 0,
  };
  const width = Math.min(82, terminalWidth - 8);
  const left = Math.max(2, Math.floor((terminalWidth - width) / 2));
  const phase = !view.session ? "NEW SESSION" : view.session.endedAt === null ? "SESSION OPEN" : "SESSION FINISHED";
  const header: Line[] = sessionHeader(view.repo, view.branch, phase, width);
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
    const session = view.session;
    if (session.endedAt === null) {
      add("Your plan is on the record.", "intent");
      add("Keep building in your coding tool. Finish here when you are ready.", "meta");
    } else {
      add(view.outcomeKnown === false ? "Session finished. Where the work landed could not be checked." : WHERE_IT_WENT[session.outcome]);
      if (session.reality.length === 0) add("This session changed no files.", "meta");
    }
    add("");
    add("ORIGINAL GOAL  /  FIXED AT START", "meta");
    add(intentOf(session), "intent");
    const sourceNote = INTENT_NOTE[intentSourceOf(session)];
    if (sourceNote) add(sourceNote, "meta");
    add("");
    add("EXPECTED FILES", "meta");
    if (session.scope.length) session.scope.forEach(path => add(JSON.stringify(path), "meta"));
    else add("None declared. Outside-plan changes are not measured.", "meta");
    if (session.endedAt !== null) {
      add("");
      add("CHANGED FILES", "meta");
      if (!session.reality.length) add("No files changed.", "meta");
      for (const path of session.reality) {
        const outside = hasDeclaredScope(session) && session.drift.includes(path);
        add(`${outside ? "! " : "  "}${JSON.stringify(path)}${outside ? "  /  outside plan" : ""}`, outside ? "drift" : "text");
      }
      if (hasDeclaredScope(session)) add(session.drift.length
        ? `${session.drift.length} ${session.drift.length === 1 ? "file changed" : "files changed"} outside the original plan.`
        : "No files changed outside the original plan.", session.drift.length ? "drift" : "meta");
      add("");
      add(`session week ${shortId(session.id)} --full shows usage and evidence.`, "meta");
    } else {
      add("");
      add("Changes are recorded when the session finishes.", "meta");
      add("Your coding tool still handles permissions.", "meta");
      if (session.agreement) add(`Accepted agreement policy: ${session.agreement.policy}.`, "meta");
      add("");
      add(`[f] Finish & review   [r] Refresh session   [q] Return to ${view.returnToHome ? "Home" : "terminal"}`, "focus");
    }
  }
  const footer: Line[] = [{ text: "─".repeat(width), role: "meta" },
    ...fold(view.notice || (view.busy ? "Saving the record…" : view.session
      ? `PgUp/PgDn scroll · q or Esc returns to ${destination}.`
      : `Tab next · Ctrl-S start · Esc ${view.returnToHome ? "Home" : "cancel"} · PgUp/PgDn scroll`), width).map(text => ({ text, role: "focus" as const })),
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
  return { lines: [...header, ...visible, ...footer].map(line => paintUiLine(line, { width, left, terminalWidth }, theme)), maxScroll };
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
