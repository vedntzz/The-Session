// `session week`: where the week's work went, one block per intent source, and
// what the blocks do not say. The geometry of the rows is in `week/table.ts`.
import type { SessionFilter } from "../../commands/week.js";
import { emptyTurnsTotal, unmeasuredEmpty } from "../../empty.js";
import { reportedOutcome } from "../../outcome.js";
import {
  formatUsd,
  shippedNote,
  spendOf,
  unpricedThroughout,
  type RateTable,
  type Spend,
} from "../../pricing.js";
import {
  hasDeclaredScope,
  INTENT_SOURCES,
  intentSourceOf,
  type IntentSource,
  type Session,
  type SessionOutcome,
} from "../../store.js";
import { plainPalette, type Palette } from "../palette.js";
import {
  NO_PRICE,
  NO_RATES,
  outcomeInk,
  pricesChecked,
  type View,
} from "./cost.js";
import { intentLegends } from "./intent.js";
import { unpricedNotes } from "./unpriced.js";
import { figure, INDENT, note, plural } from "./text.js";
import {
  cellsFor,
  figureRow,
  headingRow,
  intentLines,
  measure,
  type Columns,
  type WeekCells,
  type Widths,
} from "./week/table.js";

export { stamp } from "./week/table.js";

function sum(sessions: readonly Session[], of: (session: Session) => number): number {
  return sessions.reduce((running, session) => running + of(session), 0);
}

/**
 * How many of these ended that way, read through `reportedOutcome`.
 *
 * Never off the field: `abandoned` is a person's word, and the computation
 * arrives at it from evidence an unpushed branch produces just as readily. A
 * count taken off the raw field would report somebody's unfinished work as
 * thrown away.
 */
function count(sessions: readonly Session[], outcome: SessionOutcome): number {
  return sessions.filter((session) => reportedOutcome(session) === outcome).length;
}

/**
 * How many sessions, and where their work went — for a caller that wants one
 * line over a window rather than the blocks below.
 *
 * Kept for `render/tui`, which has one header line and no room to split it
 * three ways. `week` itself no longer prints this: pooling declared, primed
 * and captured into one count is the reading the blocks exist to prevent.
 */
export function outcomeHeadline(sessions: readonly Session[]): string {
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
  // Named because nothing else in the view would say so: the marker beside a
  // row marks a captured intent, and a week of nothing but declared ones
  // carries no mark at all — which reads exactly like an unfiltered week.
  if (filter.intent !== undefined) {
    parts.push(`${filter.intent} intents`);
  }
  return parts.length > 0 ? parts.join(", ") : undefined;
}

/**
 * Why there is no total, said where a reader looks for one.
 *
 * Declared, primed and captured are different evidence. Prime can lower drift
 * mechanically by putting historical misses into the accepted scope, so a
 * figure over all three would move whenever the mix moved and would describe
 * none of them.
 */
export const NO_POOL =
  "one block per intent source, never pooled and never totalled: declared, " +
  "primed and captured are different evidence, and one figure over all three " +
  "would move whenever their mix moved";

/** What a block says instead of a drift figure when nothing was declared. */
export const NOTHING_DECLARED =
  "nothing was declared, so there is nothing to measure drift against";

/** Everything a row needs beyond the session itself. */
interface Layout {
  cells: ReadonlyMap<Session, WeekCells>;
  widths: Widths;
  show: Columns;
  palette: Palette;
  /** Columns the lines may wrap at. Absent is no limit — see `terminalWidth`. */
  limit: number | undefined;
}

/**
 * The week as `session week` prints it: the window, then one block per intent
 * source, then what the blocks do not say and what the week cost.
 *
 * `sessions` is expected to be the window already; `days` only says what to
 * call it.
 */
export function formatWeek(
  sessions: readonly Session[],
  days: number,
  palette: Palette = plainPalette,
  filter: SessionFilter = {},
  view: View = {},
): string[] {
  const narrowed = describeFilter(filter);
  if (sessions.length === 0) {
    const window = `No sessions in the last ${plural(days, "day", "days")}`;
    return ["", `${INDENT}${window}${narrowed ? ` for ${narrowed}` : ""}`];
  }
  const rates = view.rates ?? NO_RATES;
  const spend = spendOf(sessions, rates);
  return [
    "",
    ...note(windowLine(days, narrowed), (text) => text, view.width),
    ...note(NO_POOL, palette.meta, view.width),
    ...blocks(sessions, layoutFor(sessions, rates, palette, view)),
    "",
    ...footnotes(
      turnNotes(sessions, palette, view.width),
      spendNotes(spend, view.checked, palette, view.width),
    ),
  ];
}

/** The window the rows were taken from, and any narrowing applied to it. */
function windowLine(days: number, narrowed: string | undefined): string {
  const window = `The last ${plural(days, "day", "days")}`;
  return narrowed === undefined ? window : `${window}, only ${narrowed}`;
}

/**
 * The cells, measured once.
 *
 * Every column is measured across the whole window rather than per block, so
 * the three blocks share one set of columns and a figure keeps its place as
 * the eye moves down the page. That is the only thing they share.
 */
function layoutFor(
  sessions: readonly Session[],
  rates: RateTable,
  palette: Palette,
  view: View,
): Layout {
  const cells = new Map(sessions.map((session) => [session, cellsFor(session, rates)] as const));
  return {
    cells,
    widths: measure([...cells.values()]),
    show: { tokens: view.tokens === true, classes: view.classes === true },
    palette,
    limit: view.width,
  };
}

/**
 * Every source, in `INTENT_SOURCES` order, whether or not it holds anything.
 *
 * A source with nothing in it still prints its line. Dropping the empty arm
 * would leave the others reading as the whole answer, which is the pooled
 * reading the split exists to prevent.
 */
function blocks(sessions: readonly Session[], layout: Layout): string[] {
  return INTENT_SOURCES.flatMap((source) => ["", ...sourceBlock(source, sessions, layout)]);
}

/** One source's own sessions: its counts, its drift, and its rows. */
function sourceBlock(source: IntentSource, all: readonly Session[], layout: Layout): string[] {
  const mine = all.filter((session) => intentSourceOf(session) === source);
  const { palette, limit } = layout;
  if (mine.length === 0) {
    return [`${INDENT}${source} · no sessions`];
  }
  return [
    ...note(blockHeadline(source, mine), (text) => text, limit),
    ...note(driftLine(mine), palette.meta, limit),
    palette.meta(headingRow(layout.widths, layout.show)),
    ...mine.flatMap((session) => sessionLines(session, layout)),
  ];
}

/**
 * Where one source's work went.
 *
 * `marked abandoned` says on its face that a person wrote the word — only
 * `session mark` does, and a computed one reads `open`, which is what it is.
 * The buckets with nothing in them are left unnamed: a nought here is a
 * category with no members rather than a measurement of one.
 */
function blockHeadline(source: IntentSource, mine: readonly Session[]): string {
  const marked = count(mine, "abandoned");
  const open = count(mine, "open");
  const empty = count(mine, "empty");
  return [
    `${source} · ${plural(mine.length, "session", "sessions")}`,
    `${figure(count(mine, "merged"))} landed on the default branch`,
    ...(marked > 0 ? [`${figure(marked)} marked abandoned`] : []),
    ...(open > 0 ? [`${figure(open)} still open`] : []),
    ...(empty > 0 ? [`${figure(empty)} changed no files`] : []),
  ].join(" · ");
}

/**
 * What this source changed outside what it declared.
 *
 * A source whose sessions declared no scope says so rather than reporting
 * none: `0 outside` would be a claim that they stayed inside one. The
 * denominator is the sessions that declared a scope, never the block.
 */
function driftLine(mine: readonly Session[]): string {
  const scoped = mine.filter(hasDeclaredScope);
  if (scoped.length === 0) {
    return NOTHING_DECLARED;
  }
  const declared = `${plural(scoped.length, "session", "sessions")} that declared one`;
  const paths = sum(scoped, (session) => session.drift.length);
  if (paths === 0) {
    return `nothing outside what was declared, in ${declared}`;
  }
  const drifted = scoped.filter((session) => session.drift.length > 0).length;
  return `${plural(paths, "path", "paths")} outside what was declared, in ${drifted} of ${declared}`;
}

/**
 * A session, in two lines: its intent at the left margin, its figures under it.
 *
 * The intent takes the width of the view and the `intent` ink, because it is
 * what the row is about; everything else is what became of it. A row written
 * off by a mark takes one ink and no other — nothing inside it gets to argue
 * with the strike.
 */
function sessionLines(session: Session, layout: Layout): string[] {
  const { palette, widths, show } = layout;
  const cells = layout.cells.get(session) as WeekCells;
  const intent = intentLines(session, layout.limit);
  const outcome = reportedOutcome(session);
  if (outcome === "abandoned") {
    return [...intent, figureRow(cells, widths, show)].map((line) => palette.abandoned(line));
  }
  const ink = { outcome: outcomeInk(palette, outcome) };
  return [...intent.map((line) => palette.intent(line)), figureRow(cells, widths, show, ink)];
}

/**
 * The notes under the blocks, in two blocks with a line between them.
 *
 * Above it: what the rows do not say. Below it: the money, and the two things
 * that qualify it. Which also leaves the total where the ordering rules want
 * it — one dim line at the bottom, with nothing between it and the end.
 */
function footnotes(turns: readonly string[], spend: readonly string[]): string[] {
  if (turns.length === 0 || spend.length === 0) {
    return [...turns, ...spend];
  }
  return [...turns, "", ...spend];
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

/**
 * What the week cost, as a footnote and nothing more.
 *
 * Dim, one line, and last. Cost is measured natively by the agents themselves
 * now; what this tool knows that they do not is where the work went, and a
 * money figure at the top of the view would be answering the question somebody
 * else already answered. It is still printed, because a week nobody can put a
 * figure on is a week nobody can bill.
 *
 * It is the one figure here over the whole window rather than per source —
 * money is what a week is billed at, not a rate that moves with the mix — and
 * the blocks above carry no money at all.
 *
 * Under it, the date the prices behind it were checked, so the figure is not
 * quoted at prices of no stated age; then what the figure does not cover,
 * because it is a total over the rest.
 */
function spendNotes(
  spend: Spend,
  checked: string | undefined,
  palette: Palette,
  limit?: number,
): string[] {
  const lines = note(moneyLine(spend), palette.meta, limit);
  // Directly under the figure it dates, and only where there is a figure: a
  // week nothing could be priced in has no money for a date to qualify.
  if (checked !== undefined && !unpricedThroughout(spend)) {
    lines.push(...note(pricesChecked(checked), palette.meta, limit));
  }
  return [...lines, ...coverageNotes(spend, palette, limit)];
}

/**
 * What the figure above does not cover.
 *
 * Both said out loud, because the figure is a total over the rest and the two
 * are different absences: a rate would fix the first and nothing would fix the
 * second. A cell reading `unknown` that no note underneath accounts for is a
 * hole the reader can see and the view will not admit to.
 */
function coverageNotes(spend: Spend, palette: Palette, limit?: number): string[] {
  return [
    ...uncapturedNote(spend, palette, limit),
    ...unpricedNotes(spend, palette, limit),
  ];
}

/** Sessions with no turns on the record: nothing was found to price them with. */
function uncapturedNote(spend: Spend, palette: Palette, limit?: number): string[] {
  if (spend.uncaptured === 0) {
    return [];
  }
  const sessions = plural(spend.uncaptured, "session", "sessions");
  const what = "no turns on the record, so nothing to price";
  return note(`${sessions} uncaptured: ${what}`, palette.meta, limit);
}

/**
 * What a window cost, as the figure alone.
 *
 * Nought is not the same as unknown, and since no block above carries money
 * this is the only place either gets said. A window nothing could be priced in
 * gets the dash; one that genuinely cost nothing gets `$0.00`, because nothing
 * was captured for it and so no rate is missing.
 *
 * Exported because `week --md` closes on the same figure, and two copies of a
 * two-clause test are two chances for the terminal and the document somebody
 * pastes into Notion to disagree about what a week cost.
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

/** How much of the week produced nothing, and what the markers in it mean. */
function turnNotes(sessions: readonly Session[], palette: Palette, limit?: number): string[] {
  const lines: string[] = [];
  const turns = sum(sessions, (session) => session.cost.turns);
  if (turns > 0) {
    lines.push(...note(emptyNote(sessions, turns), palette.meta, limit));
  }
  // Only the markers rows actually carry. A legend for a marker nobody used is
  // a line the reader has to check the blocks against to find out it says
  // nothing — and the same list feeds the Markdown and the HTML page, so all
  // three explain a marker the same way.
  for (const legend of intentLegends(sessions)) {
    const what = `${legend.marker} ${plural(legend.count, "session", "sessions")} ${legend.text}`;
    lines.push(...note(what, palette.meta, limit));
  }
  return lines;
}
