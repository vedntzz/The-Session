import type { Session } from "../../store.js";
import { plainPalette, type Palette } from "../palette.js";
import { stopDeclarationRows } from "./stop-declaration.js";
import { NO_SCOPE } from "./intent.js";
import { startDetails, startRows } from "./start-rows.js";
import { stopEvidenceRows, type StopView } from "./stop-evidence.js";
import { stopPathRows } from "./stop-paths.js";
import { INDENT } from "./text.js";

/** Confirms the completed record with the outcome the caller has resolved. */
export function formatStopConfirmation(
  session: Session, palette: Palette = plainPalette, details: string[] = [], width?: number,
  view: StopView = {},
): string[] {
  return [
    `${INDENT}${palette.meta("◔ session  stopped")}`,
    "",
    ...stopDeclarationRows(session, palette, width, view.outcome),
    ...stopPathRows(session, palette, width),
    ...stoppedDetails(details, palette, width),
    ...stopEvidenceRows(session, palette, width, view),
    "",
    ...startRows("next", "session week last --full", palette.meta, palette, width),
  ];
}

function stoppedDetails(details: string[], palette: Palette, width?: number): string[] {
  const kept = details.filter(line => !/^  (outside|cost)\s/u.test(line) && line !== INDENT + NO_SCOPE);
  const lines = startDetails(kept, width).map(line => palette.meta(line));
  return lines.length > 0 ? ["", ...lines] : [];
}
