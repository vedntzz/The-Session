import { wasMeasured } from "../../pricing.js";
import type { Session } from "../../store.js";
import { plainPalette, type Palette } from "../palette.js";
import { sessionIntentRows } from "./home-recording.js";
import { NO_SCOPE } from "./intent.js";
import { summarizePaths } from "./paths.js";
import { startDetails, startRows } from "./start-rows.js";
import { stopOutsideRows, stopScopeRows } from "./stop-scope.js";
import { INDENT, plural, shortId } from "./text.js";

/** Confirms the completed record, without assigning an outcome to the work. */
export function formatStopConfirmation(
  session: Session, palette: Palette = plainPalette, details: string[] = [], width?: number,
): string[] {
  return [
    `${INDENT}${palette.meta("◔ session  stopped")}`,
    "",
    ...sessionIntentRows(session, palette, width),
    ...stopScopeRows(session, palette, width),
    ...stoppedPaths(session, palette, width),
    ...stopOutsideRows(session, palette, width),
    ...startRows("id", shortId(session.id), palette.meta, palette, width),
    ...stoppedDetails(session, details, palette, width),
    "",
    ...startRows("next", "session week last", palette.meta, palette, width),
  ];
}

function stoppedPaths(session: Session, palette: Palette, width?: number): string[] {
  const summary = summarizePaths(session.reality);
  return [
    ...startRows("changed", plural(summary.count, "file", "files"), palette.meta, palette, width),
    ...summary.named.flatMap(path => startRows("", path, palette.path, palette, width, 2)),
    ...(summary.where ? startRows("", summary.where, palette.meta, palette, width) : []),
  ];
}

function stoppedDetails(session: Session, details: string[], palette: Palette, width?: number): string[] {
  const measured = wasMeasured(session.cost);
  const relevant = details.filter(line => !/^  outside\s/u.test(line) && line !== INDENT + NO_SCOPE);
  const kept = measured ? relevant : relevant.filter(line => !/^  cost\s/u.test(line));
  const lines = startDetails(kept, width).map(line => palette.meta(line));
  if (!measured) lines.push(...startRows("cost", "unknown", palette.meta, palette, width));
  return lines.length > 0 ? ["", ...lines] : [];
}
