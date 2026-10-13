import type { Session } from "../../store.js";
import { plainPalette, startTextPalette, type Palette } from "../palette.js";
import { startDeclarationRows, startDetails, startNextSteps, startRecordRows } from "./start-rows.js";
import { startFrame, startFrameWidth } from "./start-frame.js";

/** A confirmation of the declaration the backend has already recorded. */
export function formatStartConfirmation(
  session: Pick<Session, "intent" | "scope" | "id" | "startCommit">,
  palette: Palette = plainPalette, details: string[] = [], width?: number,
): string[] {
  const columns = startFrameWidth(width);
  const inset = columns === undefined ? 0 : 4;
  const textPalette = columns === undefined ? palette : startTextPalette(palette);
  const declaration = startDeclarationRows(session, textPalette, columns, inset);
  const record = startRecordRows(session, textPalette, columns, inset);
  return [
    ...startFrame(declaration, palette, columns, record),
    ...startDetails(details, width),
    ...startNextSteps(session.intent, textPalette, width),
  ];
}
