import type { Session } from "../../store.js";
import { plainPalette, type Palette } from "../palette.js";
import { startDeclarationRows, startDetails, startRecordRows, startRows } from "./start-rows.js";
import { startFrame, startFrameWidth } from "./start-frame.js";

/** A confirmation of the declaration the backend has already recorded. */
export function formatStartConfirmation(
  session: Pick<Session, "intent" | "scope" | "id" | "startCommit">,
  palette: Palette = plainPalette, details: string[] = [], width?: number,
): string[] {
  const columns = startFrameWidth(width);
  const inset = columns === undefined ? 0 : 4;
  const declaration = startDeclarationRows(session, palette, columns, inset);
  const record = startRecordRows(session, palette, columns, inset);
  return [
    ...startFrame(declaration, palette, columns, record),
    ...startDetails(details, width),
    "",
    ...startRows("next", "Work in your editor, then run session stop.", palette.meta, palette, width),
  ];
}
