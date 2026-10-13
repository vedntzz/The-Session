import type { Session } from "../../store.js";
import type { Palette } from "../palette.js";
import { cellWidth, fold, safeText } from "../tui/text.js";
import { INDENT, label, MIN_WIDTH, note, shortId } from "./text.js";

/** Measure plain values before applying the terminal's ink. */
export function startRows(
  name: string, value: string, ink: (text: string) => string,
  palette: Palette, width?: number, continuation = 0, inset = 0,
): string[] {
  const clean = safeText(value);
  const available = width === undefined ? undefined : Math.max(MIN_WIDTH, width) - (INDENT + label("")).length - continuation - inset;
  const parts = available === undefined ? [clean] : fold(clean, available);
  return parts.map((part, index) =>
    `${INDENT}${palette.meta(label(index === 0 ? name : ""))}${index > 0 ? " ".repeat(continuation) : ""}${ink(part)}`);
}

/** Keep the complete declared scope in the existing labelled layout. */
export function startScopeRows(scope: readonly string[], palette: Palette, width?: number, inset = 0): string[] {
  return scope.length > 0
    ? scope.flatMap((path, index) => startRows(index === 0 ? "scope" : "", path, palette.path, palette, width, 2, inset))
    : startRows("scope", "none declared", palette.meta, palette, width, 0, inset);
}

/** Separate the wordmark and state across the available frame width. */
function startHeader(palette: Palette, width?: number, inset = 0): string {
  const title = "◔ session"; const status = "RECORDING";
  const gap = width === undefined ? 2 : Math.max(2, width - inset - INDENT.length - cellWidth(title) - cellWidth(status));
  return INDENT + palette.recording(title + " ".repeat(gap) + status);
}

/** Reuse safe declaration rows, reserving the space the frame adds. */
export function startDeclarationRows(
  session: Pick<Session, "intent" | "scope">, palette: Palette, width?: number, inset = 0,
): string[] {
  return [
    startHeader(palette, width, inset), "",
    ...startRows("intent", session.intent ?? "unknown", palette.intent, palette, width, 0, inset),
    ...startScopeRows(session.scope, palette, width, inset),
  ];
}

/** Identify the already-saved record without reading the current checkout. */
export function startRecordRows(
  session: Pick<Session, "id" | "startCommit">, palette: Palette, width?: number, inset = 0,
): string[] {
  return [
    ...startRows("id", shortId(session.id), palette.meta, palette, width, 0, inset),
    ...startRows("head", session.startCommit.slice(0, 7), palette.meta, palette, width, 0, inset),
  ];
}

/** Explain the saved declaration and the next explicit command. */
export function startNextSteps(intent: string | null, palette: Palette, width?: number): string[] {
  const plain = (text: string): string => text;
  const message = intent === null ? "Intent is unknown on this record." : "Your intent is recorded and stays fixed.";
  return [
    "", ...note(message, palette.meta, width), "",
    ...startRows("next", "Work in your coding tool.", plain, palette, width),
    ...startRows("finish", "session stop", plain, palette, width),
  ];
}

/** Legacy metadata keeps its own indentation and all of its text. */
export function startDetails(details: readonly string[], width?: number): string[] {
  if (width === undefined) return details.map(safeText);
  return details.flatMap(detail => {
    const indent = detail.startsWith(INDENT) ? INDENT : "";
    const clean = safeText(detail).slice(indent.length);
    return fold(clean, Math.max(MIN_WIDTH, width) - indent.length).map(line => indent + line);
  });
}
