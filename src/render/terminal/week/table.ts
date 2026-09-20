// How a week's rows are laid out: the cells, the widths, and the two lines a
// session takes.
//
// Split from `week.ts` because that file had grown to hold two things at once —
// the arithmetic of a week and the geometry of a table — and only the second is
// what a reader chasing a misaligned column is looking for.
import { classOf } from "../../../classify.js";
import { emptyTurnsOf } from "../../../empty.js";
import { reportedOutcome } from "../../../outcome.js";
import { sessionFigure, wasMeasured, type RateTable } from "../../../pricing.js";
import {
  hasDeclaredScope,
  inOwnWords,
  intentSourceOf,
  totalTokens,
  type Session,
} from "../../../store.js";
import { headOf, intentOf, INTENT_MARKER, markedIntent } from "../intent.js";
import {
  clock,
  figure,
  flatten,
  INDENT,
  padLeft,
  padRight,
  shortId,
  SHORT_ID,
  width,
  wrap,
} from "../text.js";

/** Space between columns. Two, so the eye reads them as separate. */
const COLUMN_GAP = "  ";

/** Width of the start-time column: `MM-DD HH:MM` is always exactly this. */
const WHEN_WIDTH = 11;

/**
 * Where a session's figures sit, one level in from its intent.
 *
 * The indent is the whole of what tells the two lines apart once colour is
 * stripped, which is the render that goes into a pipe and a bug report.
 */
const ROW_INDENT = "    ";

/** Stands in for the part of a prompt that did not fit on one line. */
const ELLIPSIS = "…";

/**
 * What a figure reads where the record cannot supply it — never a nought.
 *
 * A nought here is a measurement: it says a turn count was taken and came to
 * none. These cells are the other thing, and the word says so rather than
 * leaving a reader to decode a punctuation mark into "nobody knows".
 */
export const UNKNOWN = "unknown";

/**
 * What a cell reads where the question cannot be asked at all.
 *
 * Distinct from `UNKNOWN`, and the difference is worth a character: a session
 * that declared no scope has no distance to measure, which is not the same as
 * a distance nobody recorded. The block's own line says which sessions those
 * are, so the cell only has to avoid claiming a nought.
 */
export const NOT_ASKED = "—";

/** One row's worth of already-stringified cells. */
export interface WeekCells {
  id: string;
  when: string;
  class: string;
  outcome: string;
  outside: string;
  turns: string;
  tokens: string;
  edits: string;
  cost: string;
}

/** Column widths, measured from the contents rather than guessed. */
export interface Widths {
  id: number;
  when: number;
  class: number;
  outcome: number;
  outside: number;
  turns: number;
  tokens: number;
  edits: number;
  cost: number;
}

/**
 * The headings, and with them the column order.
 *
 * `outside` rather than `drift`: the intent no longer competes for room on
 * this line, so the six columns the unit used to cost are there to spend, and
 * a heading that names what the number counts is worth them. `no edits` rather
 * than `empty`, because `empty` is also an outcome and the two used to sit in
 * one row saying different things.
 *
 * There is nothing over the left block. An id, a stamp and an outcome are not
 * figures to be scanned down a column, and three more headings above them
 * would make the reader find the four that are.
 */
export const HEADINGS: WeekCells = {
  id: "",
  when: "",
  class: "",
  outcome: "",
  outside: "outside",
  turns: "turns",
  tokens: "tokens",
  edits: "no edits",
  cost: "cost",
};

/**
 * Date and local time, so a row is placeable in the week without a header.
 * Exported because the HTML view writes the same stamp: one definition means
 * the two views cannot come to disagree about when a session ran.
 */
export function stamp(iso: string): string {
  const at = new Date(iso);
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${month}-${day} ${clock(iso)}`;
}

function widest(values: readonly string[]): number {
  return values.reduce((soFar, value) => Math.max(soFar, width(value)), 0);
}

/** A measured count, or the word that says the record cannot supply one. */
export function knownFigure(value: number | undefined): string {
  return value === undefined ? UNKNOWN : figure(value);
}

/**
 * One session's cells, every one of them read through the rule that owns it.
 *
 * Nothing here decides anything: `reportedOutcome` says whether `abandoned` is
 * a word anybody recorded, `hasDeclaredScope` whether there is a yardstick to
 * measure drift against, `emptyTurnsOf` whether the diff can say which turns
 * wrote nothing, and `sessionFigure` — `priceSession` behind the rule that a
 * session with no turns has no figure — what it cost.
 */
export function cellsFor(session: Session, rates: RateTable): WeekCells {
  const measured = wasMeasured(session.cost);
  return {
    id: shortId(session.id),
    when: stamp(session.startedAt),
    class: classOf(session),
    outcome: reportedOutcome(session),
    outside: hasDeclaredScope(session) ? figure(session.drift.length) : NOT_ASKED,
    turns: measured ? figure(session.cost.turns) : UNKNOWN,
    tokens: measured ? figure(totalTokens(session.cost)) : UNKNOWN,
    edits: knownFigure(emptyTurnsOf(session)),
    cost: sessionFigure(session.cost, rates) ?? UNKNOWN,
  };
}

/**
 * The columns that are only there when something asked for them. Both default
 * to off: the table is read at a glance, and every column that is not being
 * looked at makes the ones that are harder to find.
 */
export interface Columns {
  /** `--tokens`: the raw counts beside the money. */
  tokens: boolean;
  /** `--class`: what each session was working on. */
  classes: boolean;
}

/**
 * The one cell on the figure line that carries ink of its own. Applied after
 * padding, so the column widths are measured off text a reader can see; the
 * padding goes inside the escape codes, where it is still just spaces.
 */
export interface RowInk {
  outcome(text: string): string;
}

/** Headings, and any row whose ink is carried by the whole line. */
export const NO_INK: RowInk = { outcome: (text) => text };

/** The figures themselves, right-aligned so their digits line up. */
function figures(cells: WeekCells, widths: Widths, show: Columns): string {
  const columns = [padLeft(cells.outside, widths.outside), padLeft(cells.turns, widths.turns)];
  if (show.tokens) {
    columns.push(padLeft(cells.tokens, widths.tokens));
  }
  columns.push(padLeft(cells.edits, widths.edits), padLeft(cells.cost, widths.cost));
  return columns.join(COLUMN_GAP);
}

/** Which session it was, when it ran, what it was working on, where it went. */
function leftBlock(cells: WeekCells, widths: Widths, show: Columns, ink: RowInk): string[] {
  const left = [padRight(cells.id, widths.id), padRight(cells.when, widths.when)];
  if (show.classes) {
    left.push(padRight(cells.class, widths.class));
  }
  left.push(ink.outcome(padRight(cells.outcome, widths.outcome)));
  return left;
}

/** How wide the left block is, counted off the same widths it is laid out from. */
function leftWidth(widths: Widths, show: Columns): number {
  const columns = [widths.id, widths.when, widths.outcome];
  if (show.classes) {
    columns.push(widths.class);
  }
  const total = columns.reduce((running, column) => running + column, 0);
  return total + COLUMN_GAP.length * (columns.length - 1);
}

/**
 * A session's second line: which session it was, and its figures.
 *
 * Trailing space is trimmed rather than padded out, so a row written off by a
 * mark is struck through to its last figure and no further.
 */
export function figureRow(
  cells: WeekCells,
  widths: Widths,
  show: Columns,
  ink: RowInk = NO_INK,
): string {
  const left = leftBlock(cells, widths, show, ink).join(COLUMN_GAP);
  return `${ROW_INDENT}${left}${COLUMN_GAP}${figures(cells, widths, show)}`.trimEnd();
}

/** The labels over the figures, with the left block left blank under them. */
export function headingRow(widths: Widths, show: Columns): string {
  const blank = " ".repeat(ROW_INDENT.length + leftWidth(widths, show));
  return `${blank}${COLUMN_GAP}${figures(HEADINGS, widths, show)}`;
}

/**
 * The intent as this view prints it, which is the whole of it for anybody who
 * composed their own.
 *
 * A declaration is the promise the diff is held to and a primed intent is the
 * developer's words as well, so both print in full and wrap. Only a captured
 * prompt is shortened, by `headOf` — the one rule for where somebody's first
 * sentence ends, shared with `show` and the pull request body.
 */
export function intentText(session: Session): string {
  if (inOwnWords(session)) {
    return markedIntent(session);
  }
  const { head, cut } = headOf(intentOf(session));
  return `${INTENT_MARKER[intentSourceOf(session)]} ${cut ? `${head}${ELLIPSIS}` : head}`;
}

/**
 * A session's first line: the intent, at the left margin, wrapped to the room
 * there is.
 *
 * Plain, because ink goes on after the wrap — an escape code inside a width
 * would make a line end in the middle of one.
 */
export function intentLines(session: Session, limit: number | undefined): string[] {
  const room = limit === undefined ? undefined : limit - INDENT.length;
  return wrap(flatten(intentText(session)), room).map((line) => `${INDENT}${line}`);
}

/**
 * Column widths, measured from the contents rather than guessed.
 *
 * Nothing flexes any more. The intent was the one column that could give, and
 * it is no longer a column — it has the width of the terminal to itself and
 * wraps into it, so every column left is a fixed shape or a figure whose
 * digits cannot be dropped without changing what it says.
 */
export function measure(rows: readonly WeekCells[]): Widths {
  const column = (of: keyof WeekCells): number =>
    widest([HEADINGS[of], ...rows.map((row) => row[of])]);
  return {
    // Both fixed rather than measured: an id is `SHORT_ID` characters and a
    // stamp is `MM-DD HH:MM`, whatever is in the rows.
    id: SHORT_ID,
    when: WHEN_WIDTH,
    class: column("class"),
    outcome: column("outcome"),
    outside: column("outside"),
    turns: column("turns"),
    tokens: column("tokens"),
    edits: column("edits"),
    cost: column("cost"),
  };
}
