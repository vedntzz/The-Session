import type { Session } from "../../store.js";
import { plainPalette, type Palette } from "../palette.js";
import { shortId } from "./text.js";
import { startDeclarationRows, startDetails, startRows } from "./start-rows.js";
import { startFrame, startFrameWidth } from "./start-frame.js";

/** A confirmation of the declaration the backend has already recorded. */
export function formatStartConfirmation(
  session: Pick<Session, "intent" | "scope" | "id" | "startCommit">,
  palette: Palette = plainPalette, details: string[] = [], width?: number,
): string[] {
  const columns = startFrameWidth(width);
  const declaration = startDeclarationRows(session, palette, columns, columns === undefined ? 0 : 4);
  const row = (name: string, value: string, ink: (text: string) => string): string[] =>
    startRows(name, value, ink, palette, width);
  return [
    ...startFrame(declaration, palette, columns),
    ...row("id", shortId(session.id), palette.meta),
    ...row("head", session.startCommit.slice(0, 7), palette.meta),
    ...startDetails(details, width),
    "",
    ...row("next", "Work in your editor, then run session stop.", palette.meta),
  ];
}
