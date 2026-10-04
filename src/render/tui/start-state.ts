import type { UiKey } from "./state.js";
import { safeText } from "./text.js";

export type StartField = "goal" | "scope" | "start";
export interface StartKey extends UiKey { shift?: boolean; meta?: boolean }
export interface StartState {
  goal: string;
  scope: string;
  field: StartField;
  goalCursor: number;
  scopeCursor: number;
  scopeOpen: boolean;
  scroll: number;
  followCursor: boolean;
}
export const startFields: readonly StartField[] = ["goal", "scope", "start"];
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export const characters = (value: string): string[] => [...segmenter.segment(value)].map(part => part.segment);

export function initialStartState(scope: readonly string[] = []): StartState {
  const text = scope.join("\n");
  return { goal: "", scope: text, field: "goal", goalCursor: 0,
    scopeCursor: characters(text).length, scopeOpen: scope.length > 0, scroll: 0, followCursor: true };
}

/** Paths are one per line, so spaces and commas inside a filename remain data. */
export function draftScope(state: StartState): string[] {
  return [...new Set(state.scope.split("\n").map(value => value.trim()).filter(Boolean))];
}

/** Pasted controls cannot navigate, accept a declaration, or repaint the terminal. */
export function pasteStartText(state: StartState, value: string): StartState {
  if (state.field === "start") return state;
  const text = state.field === "scope"
    ? value.replace(/\r\n?/gu, "\n").split("\n").map(safeText).join("\n") : safeText(value);
  return insert(state, text);
}

function insert(state: StartState, text: string): StartState {
  if (state.field === "start") return state;
  const field = state.field;
  const cursor = field === "goal" ? "goalCursor" : "scopeCursor";
  const parts = characters(state[field]);
  parts.splice(state[cursor], 0, ...characters(text));
  return { ...state, [field]: parts.join(""), [cursor]: state[cursor] + characters(text).length, followCursor: true };
}

/** Editing stays in memory. Only the command controller can start a session. */
export function editStart(state: StartState, key: StartKey): StartState {
  state = { ...state, followCursor: true };
  if (key.name === "tab" || key.name === "return" && state.field === "goal") {
    const index = (startFields.indexOf(state.field) + (key.shift ? 2 : 1)) % startFields.length;
    const field = startFields[index]!;
    return { ...state, field, scopeOpen: state.scopeOpen || field === "scope", scroll: 0 };
  }
  if (state.field === "start") return state;
  const field = state.field;
  const cursor = field === "goal" ? "goalCursor" : "scopeCursor";
  const parts = characters(state[field]);
  let position = state[cursor];
  if (key.name === "left") position = Math.max(0, position - 1);
  else if (key.name === "right") position = Math.min(parts.length, position + 1);
  else if (key.name === "home" || key.ctrl && key.name === "a") position = 0;
  else if (key.name === "end" || key.ctrl && key.name === "e") position = parts.length;
  else if (key.ctrl && key.name === "u") return { ...state, [field]: "", [cursor]: 0 };
  else if (key.name === "backspace") { if (position > 0) parts.splice(--position, 1); }
  else if (key.name === "delete") parts.splice(position, 1);
  else if (key.ctrl && key.name === "w") {
    let beginning = position;
    while (beginning > 0 && /\s/u.test(parts[beginning - 1]!)) beginning--;
    while (beginning > 0 && !/\s/u.test(parts[beginning - 1]!)) beginning--;
    parts.splice(beginning, position - beginning); position = beginning;
  } else if (key.name === "return" && field === "scope") return insert(state, "\n");
  else if (!key.ctrl && !key.meta && key.sequence && !/[\u0000-\u001f\u007f-\u009f]/u.test(key.sequence)) {
    return insert(state, safeText(key.sequence));
  }
  return { ...state, [field]: parts.join(""), [cursor]: position };
}
