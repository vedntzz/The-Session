import type { Session } from "../../store.js";
import { plainPalette, type Palette } from "../palette.js";
import { INDENT, shortId } from "./text.js";
import { startDetails, startRows, startScopeRows } from "./start-rows.js";
import { startFrame } from "./start-frame.js";

/** A confirmation of the declaration the backend has already recorded. */
export function formatStartConfirmation(
  session: Pick<Session, "intent" | "scope" | "id" | "startCommit">,
  palette: Palette = plainPalette, details: string[] = [], width?: number,
): string[] {
  const row = (name: string, value: string, ink: (text: string) => string): string[] =>
    startRows(name, value, ink, palette, width);
  return [
    ...startFrame([`${INDENT}${palette.recording("◔ session  RECORDING")}`], palette, width),
    "",
    ...row("intent", session.intent ?? "unknown", palette.intent),
    ...startScopeRows(session.scope, palette, width),
    ...row("id", shortId(session.id), palette.meta),
    ...row("head", session.startCommit.slice(0, 7), palette.meta),
    ...startDetails(details, width),
    "",
    ...row("next", "Work in your editor, then run session stop.", palette.meta),
  ];
}
