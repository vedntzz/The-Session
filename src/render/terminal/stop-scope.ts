import { hasDeclaredScope, type Session } from "../../store.js";
import type { Palette } from "../palette.js";
import type { TableField } from "./field-table.js";
import { DRIFT_MARKER } from "./intent.js";
import { summarizePaths } from "./paths.js";
import { foldLiteral } from "../tui/text.js";
import { startRows, startScopeRows } from "./start-rows.js";
import { plural } from "./text.js";

/** Scope is a comparison only when the record has a nonempty declaration. */
function hasComparison(session: Session): boolean {
  return hasDeclaredScope(session) && session.scope.length > 0;
}

export function stopScopeRows(session: Session, palette: Palette, width?: number): string[] {
  if (!hasComparison(session)) return startRows("scope", "none declared", palette.meta, palette, width);
  return startScopeRows(session.scope, palette, width);
}

/** Share comparison and summary facts between terminal tables and plain output. */
export function stopScopeField(session: Session, palette: Palette): TableField {
  const declared = hasComparison(session);
  return { label: "scope", values: declared ? session.scope : ["none declared"], ink: declared ? palette.path : palette.meta };
}

export function stopOutsideFields(session: Session, palette: Palette): TableField[] {
  if (!hasComparison(session)) return [
    { label: "outside", values: ["unknown"], ink: palette.meta },
    { label: "", values: ["no scope declared to compare against"], ink: palette.meta },
  ];
  const summary = summarizePaths(session.drift);
  return [
    { label: "outside", values: [plural(summary.count, "file", "files")], ink: summary.count ? palette.drift : palette.meta },
    { label: "", values: [...summary.named, ...(summary.where ? [summary.where] : [])], ink: palette.drift, prefix: `${DRIFT_MARKER} ` },
  ];
}

export function stopOutsideRows(session: Session, palette: Palette, width?: number): string[] {
  return stopOutsideFields(session, palette).flatMap(field => field.values.flatMap(value => field.prefix
    ? markedPath(value, palette, width) : startRows(field.label, value, field.ink ?? palette.meta, palette, width)));
}

function markedPath(path: string, palette: Palette, width?: number): string[] {
  let first = true;
  return startRows("", path, text => {
    const marked = first ? `${DRIFT_MARKER} ${text}` : text;
    first = false;
    return palette.drift(marked);
  }, palette, width, 2, 0, foldLiteral);
}
