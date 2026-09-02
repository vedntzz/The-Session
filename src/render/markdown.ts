import {
  formatUsd,
  sessionFigure,
  spendOf,
  unpricedThroughout,
  USER_RATES_FILE,
  wasMeasured,
  type RateTable,
  type Spend,
} from "../pricing.js";
import { isCaptured, type Session } from "../store.js";
import { CAPTURED_MARKER, intentOf, spentFigure, type View } from "./terminal.js";

/**
 * The week as Markdown, for pasting somewhere other people read it — meeting
 * notes, a Slack post, a Notion or Confluence page.
 *
 * A different document from the terminal table, not the same one with the
 * escape codes taken out. The terminal view is read by the person who ran the
 * sessions, beside the repo they ran in; this one is read by somebody who was
 * not there. So it leads with the figures that survive being read cold — what
 * shipped, what did not, and what went outside the plan — and the table comes
 * after them rather than instead of them.
 *
 * What the week cost is the closing line and nothing else, in the order `week`
 * puts it in: the agents meter their own spend now, so a document that opened
 * on a dollar figure would answer a question its reader has already had
 * answered. It still closes on one — a week nobody can put a figure on is a
 * week nobody can bill.
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

/** Where a reader who wants these sessions priced is sent. */
const RATES_HINT = USER_RATES_FILE;

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
    headline(shown, merged, unplanned),
    weekTable(shown, rates, merged, unplanned),
    emptyNote(empties, rates),
    coverageNote(spend, shown.length),
    capturedNote(shown),
    spentClosing(spend, merged),
  ]);
}

/** Joins the blocks that have anything in them, one blank line between. */
function blocksOf(blocks: readonly (string | undefined)[]): string {
  return blocks.filter((block): block is string => Boolean(block)).join("\n\n");
}

/**
 * The line the document leads with: what landed, what did not, and how far the
 * work went outside what was declared.
 *
 * Every figure in it is over the sessions the table lists, so a headline never
 * counts sessions the table does not — that would send the reader looking for
 * rows that are not there. Sessions that changed no files are not among them;
 * the note under the table accounts for those.
 *
 * No money. Every figure here is a count of something observed, and nought of
 * something observed is a fact — which is why none can go absent the way the
 * closing line's figure can.
 *
 * A session still open has not landed and has not failed to, so it gets its
 * own clause rather than being counted against the week; the clause is dropped
 * when there are none. `week` splits the same ends the same way.
 */
function headline(shown: readonly Session[], merged: number, unplanned: number): string {
  const open = shown.filter((session) => session.outcome === "open").length;
  return (
    `**${plural(merged, "change", "changes")} shipped · ` +
    `${shown.length - merged - open} did not · ` +
    `${open > 0 ? `${open} still open · ` : ""}` +
    `${plural(unplanned, "file", "files")} touched outside plan**`
  );
}

/**
 * The table itself: headings, one row per session, then the total.
 *
 * The column order is `week`'s, cost last. Where the work went and how far it
 * went outside the plan are what the table is read for, and a reader scanning
 * the columns should meet the money after the two that are this document's
 * reason for existing.
 */
function weekTable(
  shown: readonly Session[],
  rates: RateTable,
  merged: number,
  unplanned: number,
): string {
  return [
    row(["Date", "Work", "Outcome", "Unplanned", "Cost"]),
    // Unplanned and Cost right-aligned: they are figures, and figures are
    // compared down a column rather than read across a row.
    "|---|---|---|---:|---:|",
    ...shown.map((session) => sessionRow(session, rates)),
    totalRow(shown.length, merged, unplanned),
  ].join("\n");
}

function sessionRow(session: Session, rates: RateTable): string {
  return row([
    monthDay(new Date(session.startedAt)),
    workCell(session),
    session.outcome === "merged" ? MERGED_MARK : "",
    String(session.drift.length),
    priced(session, rates),
  ]);
}

/**
 * The bottom row, which is a total of the column above it and nothing else.
 *
 * The cost cell is empty on purpose. What the week cost is the closing line
 * and nowhere else — the same arrangement `week`'s totals row keeps — and a
 * second copy of the figure here would put it back in the middle of the
 * columns the table is read for.
 */
function totalRow(count: number, merged: number, unplanned: number): string {
  return row([
    "**Total**",
    `**${plural(count, "session", "sessions")}**`,
    merged > 0 ? `**${merged} ${MERGED_MARK}**` : "",
    `**${unplanned}**`,
    "",
  ]);
}

/**
 * A session's cost, or a plain word where there is none.
 *
 * Two words, because there are two ways to have no figure and they want
 * different things from the reader. `unpriced` is a model with no rate, and a
 * rate is what fixes it. `not captured` is a session with no turns on the
 * record: nothing was found to price, no rate would fill it, and calling it
 * `$0.00` would say a session that may well have changed files was free.
 *
 * Both are accounted for by `coverageNote` below, from the same counters. A
 * cell whose word no note underneath counts is a hole the reader can see and
 * the report will not admit to.
 *
 * The figure itself is `sessionFigure`, beside the rates it needs and shared
 * with the terminal table. Only the words are decided here: a document read
 * cold by somebody who was not there says what it means, where the terminal
 * column can spend an em dash on it.
 */
function priced(session: Session, rates: RateTable): string {
  const figure = sessionFigure(session.cost, rates);
  if (figure !== undefined) {
    return figure;
  }
  return wasMeasured(session.cost) ? "unpriced" : "not captured";
}

/**
 * What the sessions that changed nothing cost.
 *
 * They are not in the table — nothing was attempted, so there is no row of
 * work to write — but the money was spent, and a report that dropped it would
 * be a report whose total is smaller than the bill.
 *
 * Three shapes, for the same reason the headline has two. These sessions are
 * not in `shown`, so `coverageNote` never counts them: this line is the only
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
  const cost = emptyCost(spend);
  return (
    `${plural(empties.length, "session", "sessions")} changed no files and ` +
    `${empties.length === 1 ? "is" : "are"} not in the table${cost}.`
  );
}

/**
 * What that money was, where there is a figure for it at all.
 *
 * Three ways to have none, and each says which. A model with no rate names the
 * model; a session with nothing captured names no model, because there is no
 * model on the record to name — a clause reading `an amount no rate covers ()`
 * would be this document admitting a gap and then failing to say what it was.
 * A window that simply cost nothing says nothing, since the sentence above it
 * has already said these sessions are not in the table.
 */
function emptyCost(spend: Spend): string {
  if (unpricedThroughout(spend)) {
    return spend.unpriced > 0
      ? `, costing an amount no rate covers (${spend.unpricedModels.join(", ")})`
      : ", and nothing was captured to say what they cost";
  }
  return spend.usd > 0 ? `, costing ${formatUsd(spend.usd)}` : "";
}

/**
 * How much of the table the money covers, and what it leaves out.
 *
 * Said outright rather than folded in. The figure below is a total over the
 * sessions that could be priced, and a total with a silent hole in it is the
 * kind of number that ends up in an invoice — the whole reason `pricing.ts`
 * refuses to guess a rate.
 *
 * Both holes are named, and named apart. A missing rate is somebody's next
 * five minutes; a session with nothing captured is not, and pointing that
 * reader at a rates file would be pointing them at a fix for a different
 * problem. Between them they account for every cell in the column that is not
 * a figure.
 *
 * "Below", because the money is the closing line. The count is dropped where
 * nothing could be priced at all: "the cost below covers 0 of 2 sessions"
 * points at a cost the document deliberately did not print, and the closing
 * line already says so itself.
 */
function coverageNote(spend: Spend, shown: number): string | undefined {
  const missing = spend.unpriced + spend.uncaptured;
  if (missing === 0) {
    return undefined;
  }

  const nothingPriced = unpricedThroughout(spend);
  const parts: string[] = [];

  // Dropped where nothing could be priced at all: "the cost below covers 0 of
  // 2 sessions" points at a figure the document deliberately did not print,
  // and the closing line says so itself.
  if (!nothingPriced) {
    parts.push(`The cost below covers ${shown - missing} of ${shown} sessions.`);
  }
  if (spend.unpriced > 0) {
    const models = spend.unpricedModels.join(", ");
    parts.push(
      `${plural(spend.unpriced, "session", "sessions")} ran on a model with no rate (${models}).`,
    );
    if (nothingPriced) {
      parts.push(`Add one to ${RATES_HINT}.`);
    }
  }
  if (spend.uncaptured > 0) {
    parts.push(
      `${plural(spend.uncaptured, "session", "sessions")} had no turns on the record, ` +
        "so nothing was captured to price.",
    );
  }

  return parts.join(" ");
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
 * The closing line: what the week cost, and what that came to per shipped
 * change.
 *
 * `spentFigure` is `week`'s, imported rather than copied. Whether a window
 * reads `$0.00` or an em dash is a distinction the whole tool turns on, and
 * this document and the terminal one must not be able to answer it differently
 * for the same week.
 *
 * The ratio is over everything spent, not over the merged sessions' own spend:
 * money that went into attempts that never landed is part of what the changes
 * that did land cost. It is dropped where nothing merged, and where there is
 * no total to divide — a free week, or one nothing could be priced in. Better
 * no figure than a dash, which reads as one somebody failed to compute.
 *
 * The line itself is never dropped. It is the only place left that says what
 * the week cost, and a document that stopped mentioning money would be one
 * somebody has to go and ask about.
 */
function spentClosing(spend: Spend, merged: number): string {
  const spent = spentFigure(spend);
  if (merged === 0 || spend.usd === 0) {
    return `**${spent}**`;
  }
  return `**${spent} · ${formatUsd(spend.usd / merged)} per shipped change**`;
}
