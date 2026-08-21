import {
  formatUsd,
  priceSession,
  spendOf,
  unpricedThroughout,
  type RateTable,
  type Spend,
} from "../pricing.js";
import { isCaptured, type Session } from "../store.js";
import { CAPTURED_MARKER, intentOf, type View } from "./terminal.js";

/**
 * The week as Markdown, for pasting somewhere other people read it — meeting
 * notes, a Slack post, a Notion or Confluence page.
 *
 * A different document from the terminal table, not the same one with the
 * escape codes taken out. The terminal view is read by the person who ran the
 * sessions, beside the repo they ran in; this one is read by somebody who was
 * not there. So it leads with the two figures that survive being read cold —
 * what the week cost and what shipped — and the table comes after them rather
 * than instead of them.
 *
 * Plain Markdown throughout: no colour, no escape codes, no box drawing. The
 * one deliberate exception to the house style is the tick in the outcome
 * column. `CLAUDE.md` bans emoji from CLI output because a terminal is a place
 * where a glyph may not render and cannot be relied on to carry meaning; a
 * Notion page is not that place, and a column of ticks is what a reader
 * skimming for "did anything ship" is actually looking for.
 *
 * Pure. It is handed sessions, rates and a clock, and returns one string with
 * no trailing newline — the caller decides whether that is a line on stdout or
 * the bytes on somebody's clipboard, and a paste should not carry a blank line
 * at the end of it.
 */

/** What the heading calls the work. */
const TITLE = "AI-assisted work";

/** Marks a session whose changes reached the default branch. */
const MERGED_MARK = "✅";

/**
 * How much of an intent survives into a table cell.
 *
 * Wider than the terminal's 28, because a Markdown table is laid out by
 * whatever renders it and is not competing with six other columns for the
 * width of somebody's terminal. Still bounded: a cell holding a pasted
 * paragraph makes every other row in the table unreadable.
 */
const WORK_WIDTH = 60;

/** Stands in for the part of an intent that did not fit. */
const ELLIPSIS = "…";

/** Stands in for a figure there is no rate to work out. */
const NO_COST = "—";

/** Where a reader who wants these sessions priced is sent. */
const RATES_HINT = "~/.session/rates.json";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DAY_MS = 24 * 60 * 60 * 1000;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** `12 Aug`, in the reader's own timezone — the day they remember working. */
function monthDay(at: Date): string {
  return `${at.getDate()} ${MONTHS[at.getMonth()]}`;
}

/**
 * The window, as a heading says it.
 *
 * Three shapes, because repeating the month in `12 Aug–18 Aug` is noise and
 * leaving the year out of a range that crosses one is a lie. A window of one
 * day is a date, not a range.
 */
export function formatRange(from: Date, to: Date): string {
  const sameYear = from.getFullYear() === to.getFullYear();
  if (!sameYear) {
    return `${monthDay(from)} ${from.getFullYear()} – ${monthDay(to)} ${to.getFullYear()}`;
  }
  if (from.getMonth() !== to.getMonth()) {
    return `${monthDay(from)} – ${monthDay(to)}`;
  }
  if (from.getDate() === to.getDate()) {
    return monthDay(to);
  }
  return `${from.getDate()}–${monthDay(to)}`;
}

/**
 * The first day the window covers.
 *
 * `days` counts calendar days ending today, so a seven-day window run on the
 * 18th is headed 12–18: seven days, both ends included. That is a day earlier
 * than the rolling cutoff `weekSessions` filters on, which is deliberate — the
 * heading names the days a reader would say the report covers, and no session
 * can fall outside it.
 */
function windowStart(to: Date, days: number): Date {
  const from = new Date(to.getTime() - (days - 1) * DAY_MS);
  from.setHours(0, 0, 0, 0);
  return from;
}

/**
 * An intent, fit for a table cell.
 *
 * Three things happen to it, in this order and for this reason:
 *
 * 1. **Flattened.** A newline inside a cell ends the row wherever it falls,
 *    and every column after it lands in the wrong place. Declared intents come
 *    off a command line and captured ones are already flattened, so this is
 *    the belt to that braces.
 * 2. **Truncated**, before escaping, so the limit counts characters a reader
 *    sees rather than the backslashes added below.
 * 3. **Escaped.** An unescaped `|` is a column separator, so one in somebody's
 *    intent — `--flag a|b`, a regex, a shell pipeline they were asking about —
 *    silently splits their row into two cells and shifts everything right of
 *    it. This is the failure the table cannot survive, and the reason nothing
 *    here interpolates an intent raw.
 *
 * The captured marker goes on before the width is measured, since it is part
 * of what has to fit.
 */
export function workCell(session: Session): string {
  const intent = intentOf(session);
  const marked = isCaptured(session) ? `${CAPTURED_MARKER} ${intent}` : intent;

  const flat = marked.replace(/\s+/gu, " ").trim();
  const chars = [...flat];
  const cut =
    chars.length <= WORK_WIDTH
      ? flat
      : `${chars.slice(0, WORK_WIDTH - 1).join("")}${ELLIPSIS}`;

  return cut.replace(/\|/gu, "\\|");
}

/** One row of the table, already stringified. */
function row(cells: readonly string[]): string {
  return `| ${cells.join(" | ")} |`;
}

/**
 * The week as Markdown.
 *
 * `now` is injected rather than read, so the heading is a function of its
 * arguments like everything else here.
 */
export function renderMarkdownWeek(
  sessions: readonly Session[],
  days: number,
  view: View = {},
  now: Date = new Date(),
): string {
  const rates: RateTable = view.rates ?? new Map();
  const heading = `### ${TITLE} · ${formatRange(windowStart(now, days), now)}`;

  // Empty sessions come out before anything is counted. They changed no files,
  // so they are not rows about work — but they were still paid for, which is
  // why the note below the table says what they cost rather than dropping
  // them silently.
  const shown = sessions.filter((session) => session.outcome !== "empty");
  const empties = sessions.filter((session) => session.outcome === "empty");

  if (shown.length === 0) {
    const nothing = "No sessions with any changes in them were recorded in this window.";
    return blocksOf([heading, nothing, emptyNote(empties, rates)]);
  }

  const spend = spendOf(shown, rates);
  const merged = shown.filter((session) => session.outcome === "merged").length;
  const unplanned = shown.reduce((soFar, session) => soFar + session.drift.length, 0);

  return blocksOf([
    heading,
    headline(spend, merged, unplanned),
    weekTable(shown, rates, spend, merged, unplanned),
    emptyNote(empties, rates),
    unpricedNote(spend, shown.length),
    capturedNote(shown),
    costPerShippedChange(spend.usd, merged),
  ]);
}

/** Joins the blocks that have anything in them, one blank line between. */
function blocksOf(blocks: readonly (string | undefined)[]): string {
  return blocks.filter((block): block is string => Boolean(block)).join("\n\n");
}

/**
 * The line the document leads with.
 *
 * Every figure in it is over the sessions the table lists, so a headline never
 * counts sessions the table does not — that would send the reader looking for
 * rows that are not there.
 *
 * The money is the one figure here that can be absent rather than zero. The
 * other two are counts of things that were observed, and nought of something
 * observed is a fact.
 */
function headline(spend: Spend, merged: number, unplanned: number): string {
  const money = unpricedThroughout(spend)
    ? `cost unavailable — no rate for ${spend.unpricedModels.join(", ")}`
    : `${formatUsd(spend.usd)} spent`;
  return (
    `**${money} · ${plural(merged, "change", "changes")} shipped · ` +
    `${plural(unplanned, "file", "files")} touched outside plan**`
  );
}

/** The table itself: headings, one row per session, then the total. */
function weekTable(
  shown: readonly Session[],
  rates: RateTable,
  spend: Spend,
  merged: number,
  unplanned: number,
): string {
  return [
    row(["Date", "Work", "Outcome", "Cost", "Unplanned"]),
    // Cost and Unplanned right-aligned: they are figures, and figures are
    // compared down a column rather than read across a row.
    "|---|---|---|---:|---:|",
    ...shown.map((session) => sessionRow(session, rates)),
    totalRow(shown.length, spend, merged, unplanned),
  ].join("\n");
}

function sessionRow(session: Session, rates: RateTable): string {
  return row([
    monthDay(new Date(session.startedAt)),
    workCell(session),
    session.outcome === "merged" ? MERGED_MARK : "",
    priced(session, rates),
    String(session.drift.length),
  ]);
}

/** The bottom row, which is a total of the column above it and nothing else. */
function totalRow(count: number, spend: Spend, merged: number, unplanned: number): string {
  return row([
    "**Total**",
    `**${plural(count, "session", "sessions")}**`,
    merged > 0 ? `**${merged} ${MERGED_MARK}**` : "",
    // An em dash, not a bolded nought. The row is a total of the column above
    // it, and there is no total to put there.
    unpricedThroughout(spend) ? NO_COST : `**${formatUsd(spend.usd)}**`,
    `**${unplanned}**`,
  ]);
}

/**
 * A session's cost, or a plain word where there is no rate to give one.
 *
 * A session with no turns and no api calls behind it is `$0.00`, not
 * `unpriced`. Nothing was captured for it, so it moved no tokens and there is
 * no rate it is missing — which is the same call `spendOf` makes, and it has
 * to be the same one: a cell reading `unpriced` under a note that counts no
 * unpriced sessions is a hole the reader can see and the report will not
 * admit to.
 */
function priced(session: Session, rates: RateTable): string {
  const price = priceSession(session.cost, rates);
  if (price.priced) {
    return formatUsd(price.usd);
  }
  const measured = session.cost.turns > 0 || session.cost.apiCalls > 0;
  return measured ? "unpriced" : formatUsd(0);
}

/**
 * What the sessions that changed nothing cost.
 *
 * They are not in the table — nothing was attempted, so there is no row of
 * work to write — but the money was spent, and a report that dropped it would
 * be a report whose total is smaller than the bill.
 *
 * Three shapes, for the same reason the headline has two. These sessions are
 * not in `shown`, so `unpricedNote` never counts them: this line is the only
 * place the document can admit that some of the bill has no rate behind it,
 * and staying silent would drop the money exactly where it cannot be totalled.
 * A clause omitted because nothing was spent and a clause omitted because
 * nothing could be priced would read the same, which is the confusion this
 * whole rule exists to prevent.
 */
function emptyNote(empties: readonly Session[], rates: RateTable): string | undefined {
  if (empties.length === 0) {
    return undefined;
  }
  const spend = spendOf(empties, rates);
  const cost = unpricedThroughout(spend)
    ? `, costing an amount no rate covers (${spend.unpricedModels.join(", ")})`
    : spend.usd > 0
      ? `, costing ${formatUsd(spend.usd)}`
      : "";
  return (
    `${plural(empties.length, "session", "sessions")} changed no files and ` +
    `${empties.length === 1 ? "is" : "are"} not in the table${cost}.`
  );
}

/**
 * How much of the table the money covers.
 *
 * Said outright rather than folded in. The figures above are a total over the
 * sessions that could be priced, and a total with a silent hole in it is the
 * kind of number that ends up in an invoice — which is the whole reason
 * `pricing.ts` refuses to guess a rate in the first place.
 *
 * Two shapes, because "the cost above covers 0 of 2 sessions" points at a cost
 * that is not there. When nothing could be priced the headline has already
 * said so, and what is left to say is how many sessions that was and what to
 * do about it.
 */
function unpricedNote(spend: Spend, shown: number): string | undefined {
  if (spend.unpriced === 0) {
    return undefined;
  }
  const models = spend.unpricedModels.join(", ");
  const ran = `${plural(spend.unpriced, "session", "sessions")} ran on a model with no rate (${models})`;

  if (unpricedThroughout(spend)) {
    return `No cost could be worked out: ${ran}. Add one to ${RATES_HINT}.`;
  }
  return `The cost above covers ${shown - spend.unpriced} of ${shown} sessions. ${ran}.`;
}

/** The legend for the marker, and only when a row carries one. */
function capturedNote(shown: readonly Session[]): string | undefined {
  const captured = shown.filter(isCaptured).length;
  if (captured === 0) {
    return undefined;
  }
  return (
    `${CAPTURED_MARKER} ${plural(captured, "session", "sessions")} recorded by the editor ` +
    `hook: intent captured from the first prompt, no scope declared.`
  );
}

/**
 * What each shipped change cost, over everything spent to get them.
 *
 * The numerator is the whole week, not the merged sessions' own spend. That is
 * the figure worth putting in front of somebody: the money that went into
 * attempts that never landed is part of what the changes that did land cost.
 *
 * Omitted when nothing merged, rather than dividing by zero or printing a dash
 * — a dash in a cost line reads as a figure somebody failed to compute, and
 * the honest statement is that the week has no such figure. Omitted too when
 * no session could be priced at all, where the ratio would be `$0.00` sitting
 * under a note saying the cost covers none of them.
 */
function costPerShippedChange(usd: number, merged: number): string | undefined {
  if (merged === 0 || usd === 0) {
    return undefined;
  }
  return `**${formatUsd(usd / merged)} per shipped change.**`;
}
