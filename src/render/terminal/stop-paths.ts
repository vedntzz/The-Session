import type { Session } from "../../store.js";
import type { Palette } from "../palette.js";
import { foldLiteral } from "../tui/text.js";
import { fieldTable, type TableField } from "./field-table.js";
import { summarizePaths } from "./paths.js";
import { startRows } from "./start-rows.js";
import { stopOutsideFields, stopOutsideRows, stopScopeField, stopScopeRows } from "./stop-scope.js";
import { plural, shortId } from "./text.js";

function changedFields(session: Session, palette: Palette): TableField[] {
  const summary = summarizePaths(session.reality);
  return [
    { label: "changed", values: [plural(summary.count, "file", "files")], ink: palette.meta },
    { label: "", values: [...summary.named, ...(summary.where ? [summary.where] : [])], ink: palette.path },
  ];
}

/** Preserve the existing unconstrained path rows for pipes. */
function changedRows(session: Session, palette: Palette): string[] {
  const summary = summarizePaths(session.reality);
  return [
    ...startRows("changed", plural(summary.count, "file", "files"), palette.meta, palette),
    ...summary.named.flatMap(path => startRows("", path, palette.path, palette, undefined, 2, 0, foldLiteral)),
    ...(summary.where ? startRows("", summary.where, palette.meta, palette) : []),
  ];
}

export function stopPathRows(session: Session, palette: Palette, width?: number): string[] {
  if (width === undefined) return [...stopScopeRows(session, palette), ...changedRows(session, palette),
    ...stopOutsideRows(session, palette), ...startRows("id", shortId(session.id), palette.meta, palette)];
  return fieldTable([stopScopeField(session, palette), ...changedFields(session, palette),
    ...stopOutsideFields(session, palette), { label: "id", values: [shortId(session.id)], ink: palette.meta },
  ], palette, width);
}
