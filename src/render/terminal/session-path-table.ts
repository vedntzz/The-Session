import { hasDeclaredScope, type Session } from "../../store.js";
import type { Palette } from "../palette.js";
import { fieldTable, type TableField } from "./field-table.js";
import { DRIFT_MARKER } from "./intent.js";
import { stopScopeField } from "./stop-scope.js";
import { plural } from "./text.js";

/** Full detail lists every path; a continuation marker stays attached to its filename. */
function pathFields(name: string, paths: readonly string[], palette: Palette, prefix = ""): TableField[] {
  return [
    { label: name, values: [plural(paths.length, "file", "files")], ink: prefix && paths.length ? palette.drift : palette.meta },
    { label: "", values: paths, ink: prefix ? palette.drift : palette.path, prefix },
  ];
}

function comparisonFields(session: Session, palette: Palette): TableField[] {
  if (!hasDeclaredScope(session) || session.scope.length === 0) return [
    { label: "", values: session.reality, ink: palette.path },
    { label: "outside", values: ["unknown"], ink: palette.meta },
    { label: "", values: ["no scope declared to compare against"], ink: palette.meta },
  ];
  const drifted = new Set(session.drift);
  return [
    ...pathFields("inside", session.reality.filter(path => !drifted.has(path)), palette),
    ...pathFields("outside", session.drift, palette, `${DRIFT_MARKER} `),
  ];
}

/** Scope, historical proposal and the recorded diff share the same bounded table. */
export function detailPathTable(session: Session, palette: Palette, width: number): string[] {
  return fieldTable([
    stopScopeField(session, palette),
    ...(session.proposal ? [{ label: "proposed", values: session.proposal.scope.length
      ? session.proposal.scope.map(path => JSON.stringify(path)) : ["no suggestion"], ink: palette.path }] : []),
    { label: "changed", values: [plural(session.reality.length, "file", "files")], ink: palette.meta },
    ...comparisonFields(session, palette),
  ], palette, width);
}
