import type { Session } from "../../store.js";
import { plainPalette, type Palette } from "../palette.js";
import { foldLiteral } from "../tui/text.js";
import { stopDeclarationRows } from "./stop-declaration.js";
import { NO_SCOPE } from "./intent.js";
import { summarizePaths } from "./paths.js";
import { startDetails, startRows } from "./start-rows.js";
import { stopEvidenceRows, type StopView } from "./stop-evidence.js";
import { stopOutsideRows, stopScopeRows } from "./stop-scope.js";
import { INDENT, plural, shortId } from "./text.js";

/** Confirms the completed record with the outcome the caller has resolved. */
export function formatStopConfirmation(
  session: Session, palette: Palette = plainPalette, details: string[] = [], width?: number,
  view: StopView = {},
): string[] {
  return [
    `${INDENT}${palette.meta("◔ session  stopped")}`,
    "",
    ...stopDeclarationRows(session, palette, width, view.outcome),
    ...stopScopeRows(session, palette, width),
    ...stoppedPaths(session, palette, width),
    ...stopOutsideRows(session, palette, width),
    ...startRows("id", shortId(session.id), palette.meta, palette, width),
    ...stoppedDetails(details, palette, width),
    ...stopEvidenceRows(session, palette, width, view),
    "",
    ...startRows("next", "session week last --full", palette.meta, palette, width),
  ];
}

function stoppedPaths(session: Session, palette: Palette, width?: number): string[] {
  const summary = summarizePaths(session.reality);
  return [
    ...startRows("changed", plural(summary.count, "file", "files"), palette.meta, palette, width),
    ...summary.named.flatMap(path => startRows("", path, palette.path, palette, width, 2, 0, foldLiteral)),
    ...(summary.where ? startRows("", summary.where, palette.meta, palette, width) : []),
  ];
}

function stoppedDetails(details: string[], palette: Palette, width?: number): string[] {
  const kept = details.filter(line => !/^  (outside|cost)\s/u.test(line) && line !== INDENT + NO_SCOPE);
  const lines = startDetails(kept, width).map(line => palette.meta(line));
  return lines.length > 0 ? ["", ...lines] : [];
}
