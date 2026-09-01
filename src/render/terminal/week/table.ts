// How a week's rows are laid out: the cells, the widths, and the one function
// that puts a row together.
//
// Split from `week.ts` because that file had grown to hold two things at once —
// the arithmetic of a week and the geometry of a table — and only the second is
// what a reader chasing a misaligned column is looking for.
import { classOf } from "../../../classify.js";
import { emptyTurnsOf } from "../../../empty.js";
import { formatUsd, priceSession, type RateTable } from "../../../pricing.js";
import { isCaptured, totalTokens, type Session } from "../../../store.js";
import { NO_PRICE } from "../cost.js";
import { CAPTURED_MARKER, intentOf } from "../intent.js";
import { clock, figure, INDENT, padLeft, padRight, width } from "../text.js";

/** Space between columns. Two, so the eye reads them as separate. */
const COLUMN_GAP = "  ";

/** Width of the start-time column: `MM-DD HH:MM` is always exactly this. */
const WHEN_WIDTH = 11;

/** How much of an intent survives. Past this the table stops being a table. */
const INTENT_WIDTH = 28;

/** Stands in for the part of an intent that did not fit. */
const ELLIPSIS = "…";

/** One row's worth of already-stringified cells. */
export interface WeekCells {
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
 * Outcome sits in the left block beside the intent, and cost is the last
 * column of the table rather than the first figure in it. Where the work went
 * and how far it went outside what was declared are what the table is read
 * for; what it cost is a figure the footnote under the table carries.
 *
 * `drift files` says its unit because the number beside it is a count of
 * files, and a bare `drift` over a column of small integers reads as a score.
 */
export const HEADINGS: WeekCells = {
  when: "started",
  intent: "intent",
  class: "class",
  outcome: "outcome",
  drift: "drift files",
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
  const price = priceSession(session.cost, rates);
  return {
    when: stamp(session.startedAt),
    // The marker is inside the column rather than beside it: a fourth column
    // holding one character for some rows would cost more width than the fact
    // is worth, and the note under the table says what it means.
    intent: truncate(
      isCaptured(session) ? `${CAPTURED_MARKER} ${intentOf(session)}` : intentOf(session),
      INTENT_WIDTH,
    ),
    class: classOf(session),
    outcome: session.outcome,
    drift: figure(session.drift.length),
    turns: figure(session.cost.turns),
    tokens: figure(totalTokens(session.cost)),
    // An em dash where the diff cannot say which turn wrote a file, never a
    // nought: a nought in this column is the claim that no turn was wasted.
    empty: emptyCell(emptyTurnsOf(session)),
    cost: price.priced ? formatUsd(price.usd) : NO_PRICE,
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
 * The left block: when it ran, what it was for, what it was working on, and
 * where the work went.
 */
function leftColumns(cells: WeekCells, widths: Widths, show: Columns, ink: RowInk): string[] {
  const left = [
    padRight(cells.when, widths.when),
    ink.intent(padRight(cells.intent, widths.intent)),
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

export function measure(rows: readonly WeekCells[], totals: WeekCells): Widths {
  const column = (of: keyof WeekCells): number =>
    widest([HEADINGS[of], totals[of], ...rows.map((row) => row[of])]);
  return {
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
}

/** A turn count, or the dash every unknown figure in this tool is written with. */
export function emptyCell(empty: number | undefined): string {
  return empty === undefined ? NO_PRICE : figure(empty);
}
