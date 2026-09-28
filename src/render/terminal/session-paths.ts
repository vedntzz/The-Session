// `session week <id> --full`'s path rows: what was declared, what changed inside it, what went outside.
import { hasDeclaredScope, type Session } from "../../store.js";
import type { Palette } from "../palette.js";
import { DRIFT_MARKER, NO_SCOPE, SCOPE_HINT } from "./intent.js";
import { gap, INDENT, label, LABEL_WIDTH, MIN_WIDTH, width } from "./text.js";

/**
 * What was declared, or why nothing was.
 *
 * A passive session has an empty scope because nobody was asked for one, not
 * because somebody declared that nothing would change. Printing "none
 * declared" there would read as a developer who declared nothing; printing an
 * empty drift line under it would read as a session that stayed inside a
 * scope. Neither happened, so the line says what did — and says what to do
 * about it, since declaring a scope is the whole of how drift becomes visible.
 */
export function declaredLine(session: Session, palette: Palette, limit?: number): string[] {
  if (!hasDeclaredScope(session)) {
    return labelledPaths("declared", [NO_SCOPE], palette.meta, palette, limit, SCOPE_HINT);
  }
  const declared = session.scope.length > 0 ? session.scope : ["none declared"];
  return labelledPaths("declared", declared, palette.path, palette, limit);
}

/** Two spaces between paths, so a column of them reads as a list, not a sentence. */
const PATH_GAP = "  ";

/**
 * A labelled row whose value is a list of paths, wrapped into the value column.
 *
 * Nothing is dropped and nothing is summarised. `--full` is the view somebody
 * opens *because* they want every path — `summarizePaths` and its cap belong
 * to the brief views, which have one line to spend — so the list wraps rather
 * than ending in a count. What changed is that it wraps at the terminal's edge
 * instead of running off it: six paths on one line is 150 columns, and a
 * terminal folds that at whatever column it reaches, mid-path, with no indent.
 *
 * Continuation lines are blank where the label was, so the paths line up in
 * one column under each other and the label still reads as belonging to all of
 * them.
 *
 * The gutter note stays beside the first line while the row is one line. Once
 * the paths wrap there is no gutter to put it in — the paths are using it — so
 * it goes under them, at the same column, where it still points at what it is
 * about.
 */
export function labelledPaths(
  name: string,
  paths: readonly string[],
  ink: (text: string) => string,
  palette: Palette,
  limit: number | undefined,
  note?: string,
): string[] {
  const column = INDENT.length + LABEL_WIDTH;
  const room = limit === undefined ? Infinity : Math.max(MIN_WIDTH, limit) - column;

  const filled: string[] = [];
  for (const path of paths) {
    const last = filled[filled.length - 1];
    // A path longer than the room still goes on a line of its own and runs
    // past the edge: a path cut in half is one the reader cannot copy.
    if (last === undefined || width(last) + PATH_GAP.length + width(path) > room) {
      filled.push(path);
      continue;
    }
    filled[filled.length - 1] = `${last}${PATH_GAP}${path}`;
  }

  const pad = " ".repeat(LABEL_WIDTH);
  const rows = filled.map((line, index) =>
    index === 0
      ? `${INDENT}${palette.meta(label(name))}${ink(line)}`
      : `${INDENT}${pad}${ink(line)}`,
  );
  if (note === undefined) {
    return rows;
  }
  if (rows.length === 1) {
    const bare = `${INDENT}${label(name)}${filled[0] ?? ""}`;
    // Only where the whole line — value, gutter and note — fits. A note that
    // does not fit is what put this row 32 columns past the edge of an
    // eighty-column terminal while every other row in the view fitted.
    const inline = `${bare}${gap(bare)}${note}`;
    if (limit === undefined || width(inline) <= Math.max(MIN_WIDTH, limit)) {
      return [`${rows[0] as string}${gap(bare)}${palette.meta(note)}`];
    }
  }
  return [...rows, `${INDENT}${pad}${palette.meta(note)}`];
}

/**
 * The paths that landed inside the declared scope.
 *
 * With `outsideLines` below this partitions what actually changed, so reading
 * both gives back `reality` exactly, with no path listed twice. Where every
 * changed path drifted there is no line: the `outside` line accounts for all
 * of them.
 */
export function changedLines(session: Session, palette: Palette, limit?: number): string[] {
  const drifted = new Set(session.drift);
  const inScope = session.reality.filter((path) => !drifted.has(path));
  if (inScope.length > 0) {
    return labelledPaths("changed", inScope, palette.path, palette, limit);
  }
  if (session.reality.length === 0) {
    return labelledPaths("changed", ["nothing"], palette.path, palette, limit);
  }
  return [];
}

/** The paths that went outside what was declared, marked and counted. */
export function outsideLines(session: Session, palette: Palette, limit?: number): string[] {
  if (session.drift.length === 0) {
    return [];
  }
  const marked = session.drift.map((path) => `${DRIFT_MARKER} ${path}`);
  const note = `← you did not declare ${session.drift.length === 1 ? "this" : "these"}`;
  return labelledPaths("outside", marked, palette.drift, palette, limit, note);
}
