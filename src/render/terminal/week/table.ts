// How a week's rows are laid out: the cells, the widths, and the one function
// that puts a row together.
//
// Split from `week.ts` because that file had grown to hold two things at once —
// the arithmetic of a week and the geometry of a table — and only the second is
// what a reader chasing a misaligned column is looking for.
import { classOf } from "../../../classify.js";
import { emptyTurnsOf } from "../../../empty.js";
import { sessionFigure, type RateTable } from "../../../pricing.js";
import { totalTokens, type Session } from "../../../store.js";
import { NO_PRICE } from "../cost.js";
import { markedIntent } from "../intent.js";
import {
  clock,
  figure,
  fitColumn,
  INDENT,
  padLeft,
  padRight,
  shortId,
  SHORT_ID,
  width,
} from "../text.js";

/** Space between columns. Two, so the eye reads them as separate. */
const COLUMN_GAP = "  ";

/** Width of the start-time column: `MM-DD HH:MM` is always exactly this. */
const WHEN_WIDTH = 11;

/**
 * How much of an intent survives where there is room for it. Past this the
 * table stops being a table.
 *
 * The natural width, not the width every render uses: it is the one column
 * that can give, so on a terminal too narrow for the rest of the table it
 * gives — see `measure`.
 */
const INTENT_WIDTH = 28;

/**
 * How narrow the intent column may be squeezed before the table gives up and
 * overflows instead.
 *
 * Sixteen characters is about one clause, which is enough to tell two rows of
 * the same week apart — the job this column does when it cannot do the whole
 * one. Narrower than this and every row reads `Add a…`, and a reader who
 * cannot tell the rows apart is worse off than one whose table wrapped.
 */
const MIN_INTENT = 16;

/** Stands in for the part of an intent that did not fit. */
const ELLIPSIS = "…";

/** One row's worth of already-stringified cells. */
export interface WeekCells {
  id: string;
  when: string;
  intent: string;
  class: string;
  outcome: string;
  drift: string;
  turns: string;
  tokens: string;
  empty: string;
  cost: string;
}

/** Column widths, measured from the contents rather than guessed. */
export interface Widths {
  id: number;
  when: number;
  intent: number;
  class: number;
  outcome: number;
  drift: number;
  turns: number;
  tokens: number;
  empty: number;
  cost: number;
}

/**
 * The headings, and with them the column order.
 *
 * The id comes first because it is the handle: `session pr <id>`, `session
 * show <id>` and `session mark <id>` all take one, and until this column
 * existed no view printed one — the only way to write a pull request body for
 * anything but the last session was to open the JSONL and read an id out of
 * it. Eight characters of it, the width `settle` and `mark` already print, so
 * one prefix works wherever an id is asked for.
 *
 * Outcome sits in the left block beside the intent, and cost is the last
 * column of the table rather than the first figure in it. Where the work went
 * and how far it went outside what was declared are what the table is read
 * for; what it cost is a figure the footnote under the table carries.
 *
 * `drift` used to read `drift files`, so the number beside it could not be
 * mistaken for a score. The unit cost six columns for a column of single
 * digits, and six was exactly the difference between this table fitting an
 * eighty-column terminal and overflowing it — and a table that wraps has no
 * columns left to misread. So the unit went and the risk it was guarding
 * against is real and accepted: **nothing in this view names what the number
 * counts.** `week --md` still spells it `Unplanned` for a reader who was not
 * there, and `show --full` lists the paths themselves under `outside`; a
 * reader of this table who wants to know what drifted has to open one of them.
 * If the column ever reads as a score to somebody, that is this decision
 * showing up, not a bug.
 */
export const HEADINGS: WeekCells = {
  id: "id",
  when: "started",
  intent: "intent",
  class: "class",
  outcome: "outcome",
  drift: "drift",
  turns: "turns",
  tokens: "tokens",
  empty: "empty",
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

export function cellsFor(session: Session, rates: RateTable): WeekCells {
  return {
    id: shortId(session.id),
    when: stamp(session.startedAt),
    // The marker is inside the column rather than beside it: a fourth column
    // holding one character for some rows would cost more width than the fact
    // is worth, and the note under the table says what it means.
    intent: truncate(markedIntent(session), INTENT_WIDTH),
    class: classOf(session),
    outcome: session.outcome,
    drift: figure(session.drift.length),
    turns: figure(session.cost.turns),
    tokens: figure(totalTokens(session.cost)),
    // An em dash where the diff cannot say which turn wrote a file, never a
    // nought: a nought in this column is the claim that no turn was wasted.
    empty: emptyCell(emptyTurnsOf(session)),
    // Through `sessionFigure`, which is where the nought-versus-unknown call is
    // made for every surface: a session nothing was captured for cost `$0.00`,
    // and only one that ran on a model no rate covers gets the dash. The
    // Markdown table asks the same function the same question.
    cost: sessionFigure(session.cost, rates) ?? NO_PRICE,
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
 * The two cells in a row that carry ink of their own. Applied after padding,
 * so the column widths are measured off text a reader can see; the padding
 * goes inside the escape codes, where it is still just spaces.
 */
export interface RowInk {
  intent(text: string): string;
  outcome(text: string): string;
}

/** Headings, totals, and any row whose ink is carried by the row itself. */
export const NO_INK: RowInk = { intent: (text) => text, outcome: (text) => text };

/**
 * Lays out one row. Figures are right-aligned so their digits line up and a
 * column can be scanned; text is left-aligned.
 *
 * Trailing space is trimmed rather than padded out. The totals row leaves its
 * cost cell empty — the total is in the footnote — and an abandoned row is
 * struck through whole, where trailing spaces would show up as an overlong
 * rule past the end of the text.
 */
function tableRow(left: string, cells: WeekCells, widths: Widths, show: Columns): string {
  const columns = [padLeft(cells.drift, widths.drift), padLeft(cells.turns, widths.turns)];
  if (show.tokens) {
    columns.push(padLeft(cells.tokens, widths.tokens));
  }
  columns.push(padLeft(cells.empty, widths.empty), padLeft(cells.cost, widths.cost));
  return `${INDENT}${left}${COLUMN_GAP}${columns.join(COLUMN_GAP)}`.trimEnd();
}

/**
 * The left block: which session it was, when it ran, what it was for, what it
 * was working on, and where the work went.
 */
function leftColumns(cells: WeekCells, widths: Widths, show: Columns, ink: RowInk): string[] {
  const left = [
    padRight(cells.id, widths.id),
    padRight(cells.when, widths.when),
    // Truncated again here, not only in `cellsFor`: the cell was cut to the
    // width an intent gets when nothing is competing for the room, and on a
    // narrow terminal `measure` will have given the column less than that.
    ink.intent(padRight(truncate(cells.intent, widths.intent), widths.intent)),
  ];
  if (show.classes) {
    left.push(padRight(cells.class, widths.class));
  }
  left.push(ink.outcome(padRight(cells.outcome, widths.outcome)));
  return left;
}

export function sessionRow(
  cells: WeekCells,
  widths: Widths,
  show: Columns,
  ink: RowInk = NO_INK,
): string {
  return tableRow(leftColumns(cells, widths, show, ink).join(COLUMN_GAP), cells, widths, show);
}

/** The totals row, whose label runs across every column on the left. */
export function totalsRow(cells: WeekCells, widths: Widths, show: Columns): string {
  const spanned = leftColumns(HEADINGS, widths, show, NO_INK);
  const span =
    spanned.reduce((total, column) => total + width(column), 0) +
    COLUMN_GAP.length * (spanned.length - 1);
  return tableRow(padRight(cells.when, span), cells, widths, show);
}

/**
 * The width of everything in a row except the intent: the columns themselves,
 * the gaps between them, and the indent the whole table sits in.
 *
 * Counted rather than guessed, off the same `Widths` the row is laid out
 * from, so a column added to `tableRow` cannot leave this arithmetic behind
 * and silently push the table back over the edge.
 */
function fixedWidth(widths: Widths, show: Columns): number {
  const columns = [widths.id, widths.when, widths.outcome, widths.drift, widths.turns];
  if (show.classes) {
    columns.push(widths.class);
  }
  if (show.tokens) {
    columns.push(widths.tokens);
  }
  columns.push(widths.empty, widths.cost);
  // One gap between every pair of columns, and one more between the fixed
  // columns and the intent sitting among them.
  const gaps = COLUMN_GAP.length * columns.length;
  return INDENT.length + columns.reduce((total, column) => total + column, 0) + gaps;
}

/**
 * Column widths, measured from the contents rather than guessed — and then,
 * for the one column that can give, from the room the others leave.
 *
 * `limit` is how wide the terminal is, or `undefined` where there is nothing
 * to fit inside: a pipe, a file, a CI log. Unconstrained is the render this
 * tool's tests pin and the one a bug report carries, so it is exactly what it
 * was before any terminal was measured.
 *
 * Only the intent flexes. Every other column is either a fixed shape — an id,
 * a stamp — or a figure whose digits cannot be dropped without changing what
 * it says. So the intent takes what is left, down to `MIN_INTENT`,
 * and below that the table overflows rather than becoming unreadable.
 */
export function measure(
  rows: readonly WeekCells[],
  totals: WeekCells,
  show: Columns = { tokens: true, classes: true },
  limit?: number,
): Widths {
  const column = (of: keyof WeekCells): number =>
    widest([HEADINGS[of], totals[of], ...rows.map((row) => row[of])]);
  const widths: Widths = {
    // Both fixed rather than measured: an id is `SHORT_ID` characters and a
    // stamp is `MM-DD HH:MM`, whatever is in the rows.
    id: SHORT_ID,
    when: WHEN_WIDTH,
    intent: column("intent"),
    class: column("class"),
    outcome: column("outcome"),
    drift: column("drift"),
    turns: column("turns"),
    tokens: column("tokens"),
    empty: column("empty"),
    cost: column("cost"),
  };
  return {
    ...widths,
    intent: fitColumn(widths.intent, MIN_INTENT, fixedWidth(widths, show), limit),
  };
}

/** A turn count, or the dash every unknown figure in this tool is written with. */
export function emptyCell(empty: number | undefined): string {
  return empty === undefined ? NO_PRICE : figure(empty);
}
