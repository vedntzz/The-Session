// `session week`: where the week's work went, one row per session, and what
// the rows do not say. The geometry of the table is in `week/table.ts`.
import type { SessionFilter } from "../../commands/week.js";
import { emptyTurnsTotal, unmeasuredEmpty } from "../../empty.js";
import {
  formatUsd,
  shippedNote,
  spendOf,
  unpricedThroughout,
  type RateTable,
  type Spend,
} from "../../pricing.js";
import { isCaptured, totalTokens, type Session, type SessionOutcome } from "../../store.js";
import { plainPalette, type Palette } from "../palette.js";
import {
  NO_PRICE,
  NO_RATES,
  outcomeInk,
  pricesChecked,
  RATES_HINT,
  stubLines,
  type View,
} from "./cost.js";
import { CAPTURED_MARKER } from "./intent.js";
import { figure, INDENT, plural } from "./text.js";
import {
  cellsFor,
  emptyCell,
  HEADINGS,
  measure,
  sessionRow,
  totalsRow,
  type Columns,
  type WeekCells,
  type Widths,
} from "./week/table.js";

export { stamp } from "./week/table.js";

function sum(sessions: readonly Session[], of: (session: Session) => number): number {
  return sessions.reduce((running, session) => running + of(session), 0);
}

function count(sessions: readonly Session[], outcome: SessionOutcome): number {
  return sessions.filter((session) => session.outcome === outcome).length;
}

/**
 * The first line: how many sessions, and where their work went.
 *
 * Read off `outcome`, which by the time a view runs holds what the repository
 * says now rather than what the record happened to be written with — see
 * `withOutcomes`. Nothing here is a new measurement: it is a count of the
 * column the rows below already show.
 *
 * Four ends, and each is its own clause. A session still open has not landed
 * and has not failed to; a session that changed no files never had anything to
 * land. Folding either into "did not land" would put work in a bucket it never
 * belonged to, and this line is the one most readers will stop at. The two
 * that describe the repo rather than the developer are named only when there
 * are any — a nought here is a category with nothing in it, which is the same
 * defect as a money figure over an empty category.
 */
function outcomeHeadline(sessions: readonly Session[]): string {
  const open = count(sessions, "open");
  const empty = count(sessions, "empty");
  return [
    plural(sessions.length, "session", "sessions"),
    `${figure(count(sessions, "merged"))} landed on the default branch`,
    `${figure(count(sessions, "abandoned"))} did not`,
    ...(open > 0 ? [`${figure(open)} still open`] : []),
    ...(empty > 0 ? [`${figure(empty)} changed no files`] : []),
  ].join(" · ");
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
 * The week as `session week` prints it: where the work went, then one row per
 * session. Abandoned sessions are struck through rather than dropped — they
 * are part of what the week was, and hiding them would flatter it.
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
  // the counts and the totals are a subset, and nothing on the page admits it.
  const narrowed = describeFilter(filter);
  if (sessions.length === 0) {
    const window = `No sessions in the last ${plural(days, "day", "days")}`;
    return ["", `${INDENT}${window}${narrowed ? ` for ${narrowed}` : ""}`];
  }

  const rates = view.rates ?? NO_RATES;
  const show: Columns = { tokens: view.tokens === true, classes: view.classes === true };
  const rows = sessions.map((session) => cellsFor(session, rates));
  const spend = spendOf(sessions, rates);
  const totals = weekTotals(sessions);
  const widths = measure(rows, totals);
  const checked = view.checked;
  return weekTable({ sessions, rows, totals, widths, show, spend, narrowed, checked, palette });
}

/** What a week is once the figures are in: the headline, the rows, the notes. */
interface WeekTable {
  sessions: readonly Session[];
  rows: readonly WeekCells[];
  totals: WeekCells;
  widths: Widths;
  show: Columns;
  spend: Spend;
  narrowed: string | undefined;
  /** The date the prices under the table were checked, where the file gives one. */
  checked: string | undefined;
  palette: Palette;
}

/**
 * The order a week is read in: where the work went, the rows, what the rows do
 * not say, and — last and dim — what the week cost.
 *
 * The narrowing note sits under the headline rather than above it, so the
 * first line is the outcome either way; it is still the line before the table,
 * where a reader meets it before any figure it qualifies.
 */
function weekTable({
  sessions,
  rows,
  totals,
  widths,
  show,
  spend,
  narrowed,
  checked,
  palette,
}: WeekTable): string[] {
  return [
    "",
    `${INDENT}${outcomeHeadline(sessions)}`,
    ...(narrowed ? [palette.meta(`${INDENT}only ${narrowed}`)] : []),
    "",
    palette.meta(sessionRow(HEADINGS, widths, show)),
    ...sessionRows(sessions, rows, widths, show, palette),
    "",
    totalsRow(totals, widths, show),
    ...turnNotes(sessions, palette),
    ...spendNotes(spend, checked, palette),
  ];
}

/**
 * The bottom row: a total of every column that has one.
 *
 * The cost cell is left empty on purpose. What the week cost is one dim line
 * under the table and nowhere else, and a second copy of it here would put the
 * figure back in the middle of the columns the table is read for. The row is
 * trimmed, so the empty cell costs no trailing space.
 */
function weekTotals(sessions: readonly Session[]): WeekCells {
  return {
    // The label of the totals row runs across the whole left block, starting
    // in the id column, so the id cell has nothing of its own to hold.
    id: "",
    when: plural(sessions.length, "session", "sessions"),
    intent: "",
    class: "",
    outcome: "",
    drift: figure(sum(sessions, (session) => session.drift.length)),
    turns: figure(sum(sessions, (session) => session.cost.turns)),
    tokens: figure(sum(sessions, (session) => totalTokens(session.cost))),
    empty: emptyCell(emptyTurnsTotal(sessions)),
    cost: "",
  };
}

/**
 * How many turns changed no files, or why the week cannot put a number on it.
 *
 * Never dropped, whichever it is. A week that says nothing here reads as a
 * week where nothing was wasted, and turns that produced nothing are the one
 * thing this tool measures that the agents do not report themselves. What the
 * diff settles is whether a *session* wrote files; which of its turns did is
 * not on the record, so a week holding any session that changed files says so
 * and names how many.
 */
function emptyNote(sessions: readonly Session[], turns: number): string {
  const empty = emptyTurnsTotal(sessions);
  if (empty !== undefined) {
    return `${figure(empty)} of ${plural(turns, "turn", "turns")} changed no files`;
  }
  const unmeasured = unmeasuredEmpty(sessions);
  return (
    `${plural(unmeasured, "session", "sessions")} cannot say which turns changed no files — ` +
    "the diff answers for the session, not for the turn"
  );
}

/** One row per session, inked by what became of the session. */
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
 * What the week cost, as a footnote and nothing more.
 *
 * Dim, one line, and last. Cost is measured natively by the agents themselves
 * now; what this tool knows that they do not is where the work went, and a
 * money figure at the top of the view would be answering the question somebody
 * else already answered. It is still printed, because a week nobody can put a
 * figure on is a week nobody can bill.
 *
 * The waste share is left dim with the rest of the line rather than taking the
 * `waste` ink: red inside a footnote would make the footnote the loudest thing
 * on the page, which is the arrangement this ordering exists to undo. `show
 * --full` still raises its voice about it, per session, where the reader has
 * asked for the detail.
 *
 * Always one line, whatever the week came to — see `moneyLine` for the three
 * things it can say. Under it, the date the prices behind it were checked, so
 * the figure is not quoted at prices of no stated age; then what the figure
 * does not cover, because it is a total over the rest — the sessions nothing
 * was captured for, and the ones whose model no rate covers.
 */
function spendNotes(spend: Spend, checked: string | undefined, palette: Palette): string[] {
  const lines = [palette.meta(`${INDENT}${moneyLine(spend)}`)];
  // Directly under the figure it dates, and only where there is a figure: a
  // week nothing could be priced in has no money for a date to qualify.
  if (checked !== undefined && !unpricedThroughout(spend)) {
    lines.push(palette.meta(`${INDENT}${pricesChecked(checked)}`));
  }
  // Both said out loud, because the figure above is a total over the rest, and
  // the two are different absences: a rate would fix the first and nothing
  // would fix the second. A row reading `—` that no note underneath accounts
  // for is a hole the reader can see and the table will not admit to.
  if (spend.uncaptured > 0) {
    lines.push(
      palette.meta(
        `${INDENT}${plural(spend.uncaptured, "session", "sessions")} uncaptured: ` +
          "no turns on the record, so nothing to price",
      ),
    );
  }
  if (spend.unpriced > 0) {
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

/**
 * What a window cost, as the figure alone.
 *
 * Nought is not the same as unknown, and since the totals row above leaves its
 * cost cell empty this is the only place either gets said. A window nothing
 * could be priced in gets the dash; one that genuinely cost nothing gets
 * `$0.00`, because nothing was captured for it and so no rate is missing. The
 * second case used to be carried by the total row, which is why it is spelled
 * out rather than left to an omission nobody would read.
 *
 * Exported because `week --md` closes on the same figure, and two copies of a
 * two-clause test are two chances for the terminal and the document somebody
 * pastes into Notion to disagree about what a week cost — the same reason
 * `shippedNote` lives in `pricing.ts` rather than in either caller. Takes the
 * three fields it reads, so a caller with no `unmerged` to report is held to
 * the same rule.
 */
export function spentFigure(spend: Pick<Spend, "usd" | "unpriced" | "unpricedModels">): string {
  if (unpricedThroughout(spend)) {
    return `${NO_PRICE} spent: nothing here could be priced`;
  }
  return `${formatUsd(spend.usd)} spent`;
}

/**
 * The figure, and what became of it.
 *
 * No `shippedNote` on a week that cost nothing or one nobody can price: "all
 * of it shipped" over $0.00 is a claim about no money at all, and a share of a
 * total that does not exist is not a figure either.
 */
function moneyLine(spend: Spend): string {
  const spent = spentFigure(spend);
  if (spend.usd === 0) {
    return spent;
  }
  return `${spent}, ${shippedNote(spend)}`;
}

/** How much of the week produced nothing, and what the marker in it means. */
function turnNotes(sessions: readonly Session[], palette: Palette): string[] {
  const lines: string[] = [];
  const turns = sum(sessions, (session) => session.cost.turns);
  if (turns > 0) {
    lines.push(palette.meta(`${INDENT}${emptyNote(sessions, turns)}`));
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
