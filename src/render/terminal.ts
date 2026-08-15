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
  /** Work that was thrown away. It still happened, and it still cost money. */
  struck(text: string): string;
}

/** No colour at all: what a pipe sees. */
export const plainPalette: Palette = {
  dim: (text) => text,
  bright: (text) => text,
  struck: (text) => text,
};

/** What a terminal sees. picocolors decides for itself whether to emit codes. */
export const terminalPalette: Palette = {
  dim: (text) => pc.dim(text),
  bright: (text) => pc.bold(text),
  struck: (text) => pc.strikethrough(text),
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

/** A figure with thousands separators, so six digits can be read at a glance. */
function figure(value: number): string {
  return value.toLocaleString("en-US");
}

function padRight(text: string, to: number): string {
  return text + " ".repeat(Math.max(to - width(text), 0));
}

function padLeft(text: string, to: number): string {
  return " ".repeat(Math.max(to - width(text), 0)) + text;
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
    const tokens = `${figure(totalTokens(session.cost))} tokens`;
    lines.push(`${spent}${gap(spent)}${tokens}`);
    lines.push(
      `${INDENT}${plural(apiCalls, "api call", "api calls")}, ` +
        `${callsWithoutEdits} without edits`,
    );
  }
  lines.push(`${INDENT}${palette.dim(label("outcome"))}${session.outcome}`);

  return lines;
}

// --- the week table ------------------------------------------------------

/** Space between columns. Two, so the eye reads them as separate. */
const COLUMN_GAP = "  ";
/** Width of the start-time column: `MM-DD HH:MM` is always exactly this. */
const WHEN_WIDTH = 11;
/** How much of an intent survives. Past this the table stops being a table. */
const INTENT_WIDTH = 28;
/** Stands in for the part of an intent that did not fit. */
const ELLIPSIS = "…";

/** One row's worth of already-stringified cells. */
interface WeekCells {
  when: string;
  intent: string;
  turns: string;
  tokens: string;
  empty: string;
  outcome: string;
}

/** Column widths, measured from the contents rather than guessed. */
interface Widths {
  when: number;
  intent: number;
  turns: number;
  tokens: number;
  empty: number;
}

const HEADINGS: WeekCells = {
  when: "started",
  intent: "intent",
  turns: "turns",
  tokens: "tokens",
  empty: "empty",
  outcome: "outcome",
};

/** Date and local time, so a row is placeable in the week without a header. */
function stamp(iso: string): string {
  const at = new Date(iso);
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${month}-${day} ${clock(iso)}`;
}

/** Cuts `text` to `limit` including the ellipsis, so the column cannot widen. */
function truncate(text: string, limit: number): string {
  const chars = [...text];
  if (chars.length <= limit) {
    return text;
  }
  return `${chars.slice(0, limit - 1).join("")}${ELLIPSIS}`;
}

function widest(values: readonly string[]): number {
  return values.reduce((soFar, value) => Math.max(soFar, width(value)), 0);
}

function cellsFor(session: Session): WeekCells {
  return {
    when: stamp(session.startedAt),
    intent: truncate(session.intent, INTENT_WIDTH),
    turns: figure(session.cost.turns),
    tokens: figure(totalTokens(session.cost)),
    empty: figure(session.cost.emptyTurns),
    outcome: session.outcome,
  };
}

/**
 * Lays out one row. Figures are right-aligned so their digits line up and a
 * column can be scanned for the expensive one; text is left-aligned.
 */
function tableRow(left: string, cells: WeekCells, widths: Widths): string {
  const figures = [
    padLeft(cells.turns, widths.turns),
    padLeft(cells.tokens, widths.tokens),
    padLeft(cells.empty, widths.empty),
  ].join(COLUMN_GAP);
  // The outcome column is last and never padded: trailing spaces would show up
  // as an overlong rule on a struck-through row.
  const tail = cells.outcome === "" ? "" : `${COLUMN_GAP}${cells.outcome}`;
  return `${INDENT}${left}${COLUMN_GAP}${figures}${tail}`;
}

function sessionRow(cells: WeekCells, widths: Widths): string {
  const left = `${padRight(cells.when, widths.when)}${COLUMN_GAP}${padRight(cells.intent, widths.intent)}`;
  return tableRow(left, cells, widths);
}

/** The totals row, whose label runs across the time and intent columns. */
function totalsRow(cells: WeekCells, widths: Widths): string {
  const span = widths.when + COLUMN_GAP.length + widths.intent;
  return tableRow(padRight(cells.when, span), cells, widths);
}

function measure(rows: readonly WeekCells[], totals: WeekCells): Widths {
  return {
    when: WHEN_WIDTH,
    intent: widest([HEADINGS.intent, ...rows.map((row) => row.intent)]),
    turns: widest([HEADINGS.turns, totals.turns, ...rows.map((row) => row.turns)]),
    tokens: widest([HEADINGS.tokens, totals.tokens, ...rows.map((row) => row.tokens)]),
    empty: widest([HEADINGS.empty, totals.empty, ...rows.map((row) => row.empty)]),
  };
}

function sum(sessions: readonly Session[], of: (session: Session) => number): number {
  return sessions.reduce((running, session) => running + of(session), 0);
}

/**
 * The week as `session week` prints it: one row per session, whatever it came
 * to. Abandoned sessions are struck through rather than dropped — they are
 * part of what the week cost, and hiding them would flatter the total.
 *
 * `sessions` is expected to be the window already; `days` only says what to
 * call it when the window is empty.
 */
export function formatWeek(
  sessions: readonly Session[],
  days: number,
  palette: Palette = terminalPalette,
): string[] {
  if (sessions.length === 0) {
    return ["", `${INDENT}No sessions in the last ${plural(days, "day", "days")}`];
  }

  const rows = sessions.map(cellsFor);
  const turns = sum(sessions, (session) => session.cost.turns);
  const empty = sum(sessions, (session) => session.cost.emptyTurns);
  const totals: WeekCells = {
    when: plural(sessions.length, "session", "sessions"),
    intent: "",
    turns: figure(turns),
    tokens: figure(sum(sessions, (session) => totalTokens(session.cost))),
    empty: figure(empty),
    outcome: "",
  };

  const widths = measure(rows, totals);
  const lines = ["", palette.dim(sessionRow(HEADINGS, widths))];

  for (const [index, session] of sessions.entries()) {
    const row = sessionRow(rows[index] as WeekCells, widths);
    lines.push(session.outcome === "abandoned" ? palette.struck(row) : row);
  }

  lines.push("", totalsRow(totals, widths));
  if (turns > 0) {
    lines.push(
      palette.dim(`${INDENT}${figure(empty)} of ${plural(turns, "turn", "turns")} changed no files`),
    );
  }
  return lines;
}
