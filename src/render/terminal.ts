import pc from "picocolors";
import { totalTokens, type Session } from "../store.js";

const INDENT = "  ";
/** Width of the label column, sized to the longest label the layout uses. */
const LABEL_WIDTH = 12;
/** Column the right-hand gutter starts in. */
const GUTTER = 56;
/** What the gutter narrows to rather than closing up on an over-long line. */
const MIN_GAP = 2;
/**
 * Marks drift where colour cannot: piped output, a log file, a screenshot,
 * a terminal someone has turned colour off in.
 */
const DRIFT_MARKER = "!";

/**
 * The two treatments the renderer uses. Injected rather than reached for, so
 * tests can assert where colour lands without depending on whether the
 * terminal running them has any.
 */
export interface Palette {
  /** Chrome and paths that went where they were declared to go. */
  dim(text: string): string;
  /** Drift — the one thing on the page the eye should catch. */
  bright(text: string): string;
}

/** No colour at all: what a pipe sees. */
export const plainPalette: Palette = {
  dim: (text) => text,
  bright: (text) => text,
};

/** What a terminal sees. picocolors decides for itself whether to emit codes. */
export const terminalPalette: Palette = {
  dim: (text) => pc.dim(text),
  bright: (text) => pc.bold(text),
};

/** Visible width. Code points, not UTF-16 units, so an emoji-free intent lines up. */
function width(text: string): number {
  return [...text].length;
}

function label(name: string): string {
  return name.padEnd(LABEL_WIDTH);
}

/** Spaces enough to start the gutter at `GUTTER`, given the visible left side. */
function gap(left: string): string {
  return " ".repeat(Math.max(GUTTER - width(left), MIN_GAP));
}

/** Local wall-clock time, which is how the developer remembers the session. */
function clock(iso: string): string {
  const at = new Date(iso);
  const hours = String(at.getHours()).padStart(2, "0");
  const minutes = String(at.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The session as `session show` prints it.
 *
 * `changed` and `outside` partition what actually changed: the paths that
 * landed inside the declared scope, then the ones that did not. Reading both
 * gives back `reality` exactly, with no path listed twice.
 */
export function formatSession(session: Session, palette: Palette = terminalPalette): string[] {
  const lines: string[] = [""];

  const heading = `${INDENT}${session.intent}`;
  const ended = session.endedAt === null ? "still running" : clock(session.endedAt);
  const times = `${clock(session.startedAt)} → ${ended}`;
  lines.push(`${heading}${gap(heading)}${palette.dim(times)}`);
  lines.push("");

  const declared = session.scope.length > 0 ? session.scope.join("  ") : "none declared";
  lines.push(`${INDENT}${palette.dim(label("declared"))}${palette.dim(declared)}`);

  const drifted = new Set(session.drift);
  const inScope = session.reality.filter((path) => !drifted.has(path));
  if (inScope.length > 0) {
    lines.push(`${INDENT}${palette.dim(label("changed"))}${palette.dim(inScope.join("  "))}`);
  } else if (session.reality.length === 0) {
    lines.push(`${INDENT}${palette.dim(label("changed"))}${palette.dim("nothing")}`);
  }
  // Otherwise every changed path drifted, and the `outside` line below already
  // accounts for all of them.

  if (session.drift.length > 0) {
    const marked = session.drift.map((path) => `${DRIFT_MARKER} ${path}`).join("  ");
    const bare = `${INDENT}${label("outside")}${marked}`;
    const note = `← you did not declare ${session.drift.length === 1 ? "this" : "these"}`;
    lines.push(
      `${INDENT}${palette.dim(label("outside"))}${palette.bright(marked)}` +
        `${gap(bare)}${palette.dim(note)}`,
    );
  }

  lines.push("");

  const { turns, emptyTurns, apiCalls, callsWithoutEdits } = session.cost;
  if (turns > 0 || apiCalls > 0) {
    const spent = `${INDENT}${plural(turns, "turn", "turns")}, ${emptyTurns} without edits`;
    const tokens = `${totalTokens(session.cost).toLocaleString("en-US")} tokens`;
    lines.push(`${spent}${gap(spent)}${tokens}`);
    lines.push(
      `${INDENT}${plural(apiCalls, "api call", "api calls")}, ` +
        `${callsWithoutEdits} without edits`,
    );
  }
  lines.push(`${INDENT}${palette.dim(label("outcome"))}${session.outcome}`);

  return lines;
}
