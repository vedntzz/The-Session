// `session week`: one row per session, and what the rows do not say.
import { classOf } from "../../classify.js";
import type { SessionFilter } from "../../commands/week.js";
import {
  formatUsd,
  priceSession,
  spendOf,
  unpricedThroughout,
  type Price,
  type RateTable,
  type Spend,
} from "../../pricing.js";
import { isCaptured, totalTokens, type Session } from "../../store.js";
import { plainPalette, type Palette } from "../palette.js";
import {
  costCell,
  NO_PRICE,
  NO_RATES,
  outcomeInk,
  RATES_HINT,
  stubLines,
  wasteCell,
  type View,
} from "./cost.js";
import { CAPTURED_MARKER, intentOf } from "./intent.js";
import { clock, figure, INDENT, padLeft, padRight, plural, width } from "./text.js";

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
  class: string;
  cost: string;
  turns: string;
  tokens: string;
  empty: string;
  outcome: string;
}

/** Column widths, measured from the contents rather than guessed. */
interface Widths {
  when: number;
  intent: number;
  class: number;
  cost: number;
  turns: number;
  tokens: number;
  empty: number;
}

const HEADINGS: WeekCells = {
  when: "started",
  intent: "intent",
  class: "class",
  cost: "cost",
  turns: "turns",
  tokens: "tokens",
  empty: "empty",
  outcome: "outcome",
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

function cellsFor(session: Session, rates: RateTable): WeekCells {
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
    cost: price.priced ? formatUsd(price.usd) : NO_PRICE,
    turns: figure(session.cost.turns),
    tokens: figure(totalTokens(session.cost)),
    empty: figure(session.cost.emptyTurns),
    outcome: session.outcome,
  };
}

/**
 * The columns that are only there when something asked for them. Both default
 * to off: the table is read at a glance, and every column that is not being
 * looked at makes the ones that are harder to find.
 */
interface Columns {
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
interface RowInk {
  intent(text: string): string;
  outcome(text: string): string;
}

/** Headings, totals, and any row whose ink is carried by the row itself. */
const NO_INK: RowInk = { intent: (text) => text, outcome: (text) => text };

/**
 * Lays out one row. Figures are right-aligned so their digits line up and a
 * column can be scanned for the expensive one; text is left-aligned. Cost
 * leads them, because it is the column the eye should land on first.
 */
function tableRow(
  left: string,
  cells: WeekCells,
  widths: Widths,
  show: Columns,
  ink: RowInk = NO_INK,
): string {
  const columns = [padLeft(cells.cost, widths.cost), padLeft(cells.turns, widths.turns)];
  if (show.tokens) {
    columns.push(padLeft(cells.tokens, widths.tokens));
  }
  columns.push(padLeft(cells.empty, widths.empty));

  // The outcome column is last and never padded: trailing spaces would show up
  // as an overlong rule on a struck-through row.
  const tail = cells.outcome === "" ? "" : `${COLUMN_GAP}${ink.outcome(cells.outcome)}`;
  return `${INDENT}${left}${COLUMN_GAP}${columns.join(COLUMN_GAP)}${tail}`;
}

/** The left block: when it ran, what it was for, and what it was working on. */
function leftColumns(cells: WeekCells, widths: Widths, show: Columns, ink: RowInk): string[] {
  const left = [
    padRight(cells.when, widths.when),
    ink.intent(padRight(cells.intent, widths.intent)),
  ];
  if (show.classes) {
    left.push(padRight(cells.class, widths.class));
  }
  return left;
}

function sessionRow(cells: WeekCells, widths: Widths, show: Columns, ink: RowInk = NO_INK): string {
  return tableRow(leftColumns(cells, widths, show, ink).join(COLUMN_GAP), cells, widths, show, ink);
}

/** The totals row, whose label runs across every column on the left. */
function totalsRow(cells: WeekCells, widths: Widths, show: Columns): string {
  const spanned = leftColumns(HEADINGS, widths, show, NO_INK);
  const span = spanned.reduce((total, column) => total + width(column), 0) +
    COLUMN_GAP.length * (spanned.length - 1);
  return tableRow(padRight(cells.when, span), cells, widths, show);
}

function measure(rows: readonly WeekCells[], totals: WeekCells): Widths {
  return {
    when: WHEN_WIDTH,
    intent: widest([HEADINGS.intent, ...rows.map((row) => row.intent)]),
    class: widest([HEADINGS.class, ...rows.map((row) => row.class)]),
    cost: widest([HEADINGS.cost, totals.cost, ...rows.map((row) => row.cost)]),
    turns: widest([HEADINGS.turns, totals.turns, ...rows.map((row) => row.turns)]),
    tokens: widest([HEADINGS.tokens, totals.tokens, ...rows.map((row) => row.tokens)]),
    empty: widest([HEADINGS.empty, totals.empty, ...rows.map((row) => row.empty)]),
  };
}

function sum(sessions: readonly Session[], of: (session: Session) => number): number {
  return sessions.reduce((running, session) => running + of(session), 0);
}

/** The filter in words, or undefined when the week was not narrowed at all. */
export function describeFilter(filter: SessionFilter): string | undefined {
  const parts: string[] = [];
  if (filter.client !== undefined) {
    parts.push(`client ${filter.client}`);
  }
  if (filter.project !== undefined) {
    parts.push(`project ${filter.project}`);
  }
  if (filter.class !== undefined) {
    parts.push(`${filter.class} sessions`);
  }
  // Named because nothing else in the table would say so: the marker beside a
  // row marks a captured intent, and a table of nothing but declared ones
  // carries no mark at all — which reads exactly like an unfiltered week.
  if (filter.intent !== undefined) {
    parts.push(`${filter.intent} intents`);
  }
  return parts.length > 0 ? parts.join(", ") : undefined;
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
  palette: Palette = plainPalette,
  filter: SessionFilter = {},
  view: View = {},
): string[] {
  // A filtered table with nothing saying so is a table that lies by omission:
  // the totals are a subset, and nothing on the page admits it.
  const narrowed = describeFilter(filter);
  if (sessions.length === 0) {
    const window = `No sessions in the last ${plural(days, "day", "days")}`;
    return ["", `${INDENT}${window}${narrowed ? ` for ${narrowed}` : ""}`];
  }

  const rates = view.rates ?? NO_RATES;
  const show: Columns = { tokens: view.tokens === true, classes: view.classes === true };
  const rows = sessions.map((session) => cellsFor(session, rates));
  const spend = spendOf(sessions, rates);
  const totals = weekTotals(sessions, spend);
  const widths = measure(rows, totals);
  return weekTable({ sessions, rows, totals, widths, show, spend, narrowed, palette });
}

/** What a week is once the figures are in: a heading, the rows, and the notes. */
interface WeekTable {
  sessions: readonly Session[];
  rows: readonly WeekCells[];
  totals: WeekCells;
  widths: Widths;
  show: Columns;
  spend: Spend;
  narrowed: string | undefined;
  palette: Palette;
}

function weekTable({
  sessions,
  rows,
  totals,
  widths,
  show,
  spend,
  narrowed,
  palette,
}: WeekTable): string[] {
  return [
    "",
    ...(narrowed ? [palette.meta(`${INDENT}only ${narrowed}`)] : []),
    palette.meta(sessionRow(HEADINGS, widths, show)),
    ...sessionRows(sessions, rows, widths, show, palette),
    "",
    totalsRow(totals, widths, show),
    ...spendNotes(spend, palette),
    ...turnNotes(sessions, palette),
  ];
}

/** The bottom row: a total of every column that has one. */
function weekTotals(sessions: readonly Session[], spend: Spend): WeekCells {
  return {
    when: plural(sessions.length, "session", "sessions"),
    intent: "",
    class: "",
    // A dash only where there is no total to give. A week that genuinely cost
    // nothing reads `$0.00` like the rows above it — dashing that out would
    // put an absence over a column of noughts, and the reader can see the
    // column.
    cost: unpricedThroughout(spend) ? NO_PRICE : formatUsd(spend.usd),
    turns: figure(sum(sessions, (session) => session.cost.turns)),
    tokens: figure(sum(sessions, (session) => totalTokens(session.cost))),
    empty: figure(sum(sessions, (session) => session.cost.emptyTurns)),
    outcome: "",
  };
}

/** One row per session, inked by what the session came to. */
function sessionRows(
  sessions: readonly Session[],
  rows: readonly WeekCells[],
  widths: Widths,
  show: Columns,
  palette: Palette,
): string[] {
  return sessions.map((session, index) => {
    const cells = rows[index] as WeekCells;
    // An abandoned row takes one ink and no other: the whole row is written
    // off, and brightening its intent inside the strike would argue with it.
    if (session.outcome === "abandoned") {
      return palette.abandoned(sessionRow(cells, widths, show));
    }
    return sessionRow(cells, widths, show, {
      intent: (text) => palette.intent(text),
      outcome: outcomeInk(palette, session.outcome),
    });
  });
}

/**
 * The sentence the table is for, and what the total leaves out.
 *
 * Everything that did not merge is money still owed an outcome, which is a
 * different question from the turn counts below it — a productive session that
 * nobody shipped wasted all of itself.
 *
 * The sentence is omitted where nothing could be priced: it would read "$0.00
 * spent" about a week nobody can put a figure on, and the unpriced line says
 * why instead. Omitted too where the week genuinely cost nothing, which the
 * total row has already said in full.
 */
function spendNotes(spend: Spend, palette: Palette): string[] {
  const lines: string[] = [];
  if (spend.usd > 0) {
    lines.push(
      `${INDENT}${formatUsd(spend.usd)} spent, ${formatUsd(spend.unmerged)} of it on ` +
        "changes that never merged",
    );
  }
  if (spend.unpriced > 0) {
    // Said out loud, because the total above is a total of the rest.
    lines.push(
      palette.meta(
        `${INDENT}${plural(spend.unpriced, "session", "sessions")} unpriced: ` +
          `${spend.unpricedModels.join(", ")} — save this as ${RATES_HINT}`,
      ),
      ...stubLines(spend.unpricedModels, palette),
    );
  }
  return lines;
}

/** How much of the week produced nothing, and what the marker in it means. */
function turnNotes(sessions: readonly Session[], palette: Palette): string[] {
  const lines: string[] = [];
  const turns = sum(sessions, (session) => session.cost.turns);
  if (turns > 0) {
    const empty = figure(sum(sessions, (session) => session.cost.emptyTurns));
    lines.push(
      palette.meta(`${INDENT}${empty} of ${plural(turns, "turn", "turns")} changed no files`),
    );
  }
  // Only when a row carries one. A legend for a marker nobody used is a line
  // the reader has to check the table against to find out it says nothing.
  const captured = sessions.filter(isCaptured).length;
  if (captured > 0) {
    lines.push(
      palette.meta(
        `${INDENT}${CAPTURED_MARKER} ${plural(captured, "session", "sessions")} recorded by the ` +
          "hook: intent captured from the first prompt, no scope declared",
      ),
    );
  }
  return lines;
}
