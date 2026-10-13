import { hasDeclaredScope, type Session } from "../../store.js";
import type { Palette } from "../palette.js";
import { DRIFT_MARKER } from "./intent.js";
import { summarizePaths } from "./paths.js";
import { startRows } from "./start-rows.js";
import { plural } from "./text.js";

/** Scope is a comparison only when the record has a nonempty declaration. */
function hasComparison(session: Session): boolean {
  return hasDeclaredScope(session) && session.scope.length > 0;
}

export function stopScopeRows(session: Session, palette: Palette, width?: number): string[] {
  if (!hasComparison(session)) return startRows("scope", "none declared", palette.meta, palette, width);
  return session.scope.flatMap((path, index) =>
    startRows(index === 0 ? "scope" : "", path, palette.path, palette, width, 2));
}

export function stopOutsideRows(session: Session, palette: Palette, width?: number): string[] {
  if (!hasComparison(session)) return [
    ...startRows("outside", "unknown", palette.meta, palette, width),
    ...startRows("", "no scope declared to compare against", palette.meta, palette, width),
  ];
  const summary = summarizePaths(session.drift);
  const ink = summary.count > 0 ? palette.drift : palette.meta;
  return [
    ...startRows("outside", plural(summary.count, "file", "files"), ink, palette, width),
    ...summary.named.flatMap(path => markedPath(path, palette, width)),
    ...(summary.where ? startRows("", `${DRIFT_MARKER} ${summary.where}`, palette.drift, palette, width) : []),
  ];
}

function markedPath(path: string, palette: Palette, width?: number): string[] {
  let first = true;
  return startRows("", path, text => {
    const marked = first ? `${DRIFT_MARKER} ${text}` : text;
    first = false;
    return palette.drift(marked);
  }, palette, width, 2);
}
