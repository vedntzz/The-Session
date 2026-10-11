import type { Session } from "../../store.js";
import { plainPalette, type Palette } from "../palette.js";
import { safeText } from "../tui/text.js";
import { INDENT, label, shortId } from "./text.js";

/** A confirmation of the declaration the backend has already recorded. */
export function formatStartConfirmation(
  session: Pick<Session, "intent" | "scope" | "id" | "startCommit">,
  palette: Palette = plainPalette, details: string[] = [],
): string[] {
  const row = (name: string, value: string, ink: (text: string) => string): string =>
    `${INDENT}${palette.meta(label(name))}${ink(safeText(value))}`;
  return [
    `${INDENT}${palette.recording("◔ session  recording")}`,
    "",
    row("intent", session.intent ?? "unknown", palette.intent),
    ...(session.scope.length > 0
      ? session.scope.map((path, index) => row(index === 0 ? "scope" : "", path, palette.path))
      : [row("scope", "none declared", palette.meta)]),
    row("id", shortId(session.id), palette.meta),
    row("head", session.startCommit.slice(0, 7), palette.meta),
    ...details.map(safeText),
    "",
    row("next", "Work in your editor, then run session stop.", palette.meta),
  ];
}
