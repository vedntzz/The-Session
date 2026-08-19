import { classOf } from "../classify.js";
import type { SessionFilter } from "../commands/week.js";
import { attributionEntries } from "../config.js";
import { formatUsd, priceSession, spendOf, type Price, type RateTable } from "../pricing.js";
import {
  isCaptured,
  totalTokens,
  type Session,
  type SessionCost,
  type SessionOutcome,
} from "../store.js";
import { plainPalette, type Palette } from "./palette.js";

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
 * Marks an intent that was captured from a prompt rather than declared before
 * the work. Like `DRIFT_MARKER`, it is a character rather than an ink, so the
 * distinction survives a pipe, a log file and a screenshot; the tables that
 * use it say what it means underneath.
 */
const CAPTURED_MARKER = "~";

/** What `show` says about an intent nobody declared. */
const CAPTURED_INTENT = "captured from the first prompt, not declared";
/** What `show` says instead of a scope, for a session nobody declared one for. */
const NO_SCOPE = "no scope — nothing was declared to drift from";
/** Where a reader who wants drift is sent. */
const SCOPE_HINT = "← session start --scope is what makes drift visible";

/** How a session with no intent yet reads. */
const NO_INTENT_OPEN = "(no prompt yet)";
/** How a session that ended without ever being given one reads. */
const NO_INTENT_ENDED = "(no prompt)";

/**
 * The intent as any view prints it.
 *
 * A passive session that has not had a prompt yet has no words to show, and a
 * session that ended before one arrived never will. Both say so rather than
 * printing an empty column: a blank would read as a session whose intent was
 * lost, and nothing was lost — nothing was ever said.
 */
export function intentOf(session: Pick<Session, "intent" | "endedAt">): string {
  if (session.intent !== null) {
    return session.intent;
  }
  return session.endedAt === null ? NO_INTENT_OPEN : NO_INTENT_ENDED;
}

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
 * What a view knows beyond the sessions themselves. Both fields are absent in
 * the tests that only care about layout, and a view with no rates prices
 * nothing and says so — which is the same path a genuinely unknown model takes.
 */
export interface View {
  /** The rates in force. See `pricing.ts`. */
  rates?: RateTable;
  /** Whether `--tokens` asked for the raw counters as well. */
  tokens?: boolean;
  /** Whether `--class` asked for the class column as well. */
  classes?: boolean;
}

const NO_RATES: RateTable = new Map();

/** Where to send a reader whose model has no price on it. */
const RATES_HINT = "~/.session/rates.json";

/** The money, or the tokens and the reason there is no money. */
function costCell(cost: SessionCost, price: Price): string {
  if (price.priced) {
    return formatUsd(price.usd);
  }
  const model = cost.model === "" ? "model" : cost.model;
  return `${figure(totalTokens(cost))} tokens, ${model} unpriced`;
}

/** A figure, and whether it is a figure worth raising your voice about. */
interface Cell {
  text: string;
  /** True when the figure is not zero. See `wasteCell`. */
  spent: boolean;
}

/**
 * What the turns that changed no files came to.
 *
 * `spent` is what decides whether it is printed in red, and it is false at
 * zero: a session that wasted nothing showing `$0.00` in alarm colour would
 * teach the reader to ignore the colour, and then the one that wasted $40
 * would not be seen either. Red has to mean there is something there.
 */
function wasteCell(cost: SessionCost, price: Price): Cell {
  if (price.priced && price.emptyUsd !== undefined) {
    return { text: formatUsd(price.emptyUsd), spent: price.emptyUsd > 0 };
  }
  if (cost.emptyTurnTokens) {
    const tokens = totalTokens(cost.emptyTurnTokens);
    return { text: `${figure(tokens)} tokens`, spent: tokens > 0 };
  }
  // Captured before the split was recorded. A share of the total worked out
  // from the turn count would look like a measurement and would not be one.
  return { text: "not recorded", spent: false };
}

/** The four counters, spelled out. Only ever shown when `--tokens` asks. */
function breakdown(cost: SessionCost): string {
  return [
    `${figure(cost.inputTokens)} in`,
    `${figure(cost.cacheReadTokens)} cache read`,
    `${figure(cost.cacheCreationTokens)} cache write`,
    `${figure(cost.outputTokens)} out`,
  ].join(" · ");
}

/**
 * How an outcome is written, wherever one is printed.
 *
 * `open` is left in the terminal's own colour on purpose. It is the ordinary
 * case — most sessions are open most of the time — and a view that colours
 * every outcome emphasises none of them.
 */
function outcomeInk(palette: Palette, outcome: SessionOutcome): (text: string) => string {
  switch (outcome) {
    case "merged":
      return (text) => palette.merged(text);
    case "abandoned":
      return (text) => palette.abandoned(text);
    default:
      return (text) => text;
  }
}

/**
 * The session as `session show` prints it.
 *
 * `changed` and `outside` partition what actually changed: the paths that
 * landed inside the declared scope, then the ones that did not. Reading both
 * gives back `reality` exactly, with no path listed twice.
 */
export function formatSession(
  session: Session,
  palette: Palette = plainPalette,
  view: View = {},
): string[] {
  const lines: string[] = [""];

  // Inked and measured separately: `gap` counts the characters a reader sees,
  // and an escape code is not one of them.
  const intent = intentOf(session);
  const heading = `${INDENT}${intent}`;
  const ended = session.endedAt === null ? "still running" : clock(session.endedAt);
  const times = `${clock(session.startedAt)} → ${ended}`;
  lines.push(`${INDENT}${palette.intent(intent)}${gap(heading)}${palette.meta(times)}`);
  lines.push("");

  // Said outright, and only when it applies. A declared intent is the ordinary
  // case and says so by having no line here; a captured one is a different
  // kind of evidence and a reader comparing it to the paths below is owed the
  // difference.
  if (isCaptured(session)) {
    lines.push(`${INDENT}${palette.meta(label("intent"))}${palette.meta(CAPTURED_INTENT)}`);
  }

  // A passive session has an empty scope because nobody was asked for one, not
  // because somebody declared that nothing would change. Printing "none
  // declared" there would read as a developer who declared nothing; printing
  // an empty drift line under it would read as a session that stayed inside a
  // scope. Neither happened, so the line says what did — and says what to do
  // about it, since declaring a scope is the whole of how drift becomes
  // visible.
  if (isCaptured(session)) {
    const bare = `${INDENT}${label("declared")}${NO_SCOPE}`;
    lines.push(
      `${INDENT}${palette.meta(label("declared"))}${palette.meta(NO_SCOPE)}` +
        `${gap(bare)}${palette.meta(SCOPE_HINT)}`,
    );
  } else {
    const declared = session.scope.length > 0 ? session.scope.join("  ") : "none declared";
    lines.push(`${INDENT}${palette.meta(label("declared"))}${palette.path(declared)}`);
  }

  const drifted = new Set(session.drift);
  const inScope = session.reality.filter((path) => !drifted.has(path));
  if (inScope.length > 0) {
    lines.push(`${INDENT}${palette.meta(label("changed"))}${palette.path(inScope.join("  "))}`);
  } else if (session.reality.length === 0) {
    lines.push(`${INDENT}${palette.meta(label("changed"))}${palette.path("nothing")}`);
  }
  // Otherwise every changed path drifted, and the `outside` line below already
  // accounts for all of them.

  if (session.drift.length > 0) {
    const marked = session.drift.map((path) => `${DRIFT_MARKER} ${path}`).join("  ");
    const bare = `${INDENT}${label("outside")}${marked}`;
    const note = `← you did not declare ${session.drift.length === 1 ? "this" : "these"}`;
    lines.push(
      `${INDENT}${palette.meta(label("outside"))}${palette.drift(marked)}` +
        `${gap(bare)}${palette.meta(note)}`,
    );
  }

  lines.push("");

  // Money first, counts in the gutter beside it: what the session cost is the
  // question, and the counters are how it got there.
  const { turns, emptyTurns, apiCalls, callsWithoutEdits } = session.cost;
  if (turns > 0 || apiCalls > 0) {
    const price = priceSession(session.cost, view.rates ?? NO_RATES);

    // The cost itself is left in the terminal's own colour. It is the figure
    // that is always there, and colouring what is always there says nothing.
    const cell = costCell(session.cost, price);
    const spent = `${INDENT}${label("cost")}${cell}`;
    lines.push(
      `${INDENT}${palette.meta(label("cost"))}${cell}` +
        `${gap(spent)}${palette.meta(`${plural(turns, "turn", "turns")}, ${emptyTurns} without edits`)}`,
    );

    const waste = wasteCell(session.cost, price);
    const wasted = `${INDENT}${label("no edits")}${waste.text}`;
    lines.push(
      `${INDENT}${palette.meta(label("no edits"))}${waste.spent ? palette.waste(waste.text) : waste.text}` +
        `${gap(wasted)}` +
        palette.meta(`${plural(apiCalls, "api call", "api calls")}, ${callsWithoutEdits} without edits`),
    );

    if (view.tokens) {
      lines.push(`${INDENT}${palette.meta(label("tokens"))}${palette.meta(breakdown(session.cost))}`);
    }
  }
  // Who it was for, one field per line rather than run together: `sow` and
  // `billingCode` are strings of characters nobody can tell apart on sight,
  // and an unlabelled pair of them would be unreadable.
  for (const [key, value] of attributionEntries(session.attribution)) {
    lines.push(`${INDENT}${palette.meta(label(key))}${palette.meta(value)}`);
  }

  lines.push(`${INDENT}${palette.meta(label("outcome"))}${outcomeInk(palette, session.outcome)(session.outcome)}`);

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

/** Stands in for a session whose model carries no price. */
const NO_PRICE = "—";

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
  const turns = sum(sessions, (session) => session.cost.turns);
  const empty = sum(sessions, (session) => session.cost.emptyTurns);
  const spend = spendOf(sessions, rates);
  const totals: WeekCells = {
    when: plural(sessions.length, "session", "sessions"),
    intent: "",
    class: "",
    cost: spend.usd > 0 ? formatUsd(spend.usd) : NO_PRICE,
    turns: figure(turns),
    tokens: figure(sum(sessions, (session) => totalTokens(session.cost))),
    empty: figure(empty),
    outcome: "",
  };

  const widths = measure(rows, totals);
  const lines = [""];
  if (narrowed) {
    lines.push(palette.meta(`${INDENT}only ${narrowed}`));
  }
  lines.push(palette.meta(sessionRow(HEADINGS, widths, show)));

  for (const [index, session] of sessions.entries()) {
    const cells = rows[index] as WeekCells;
    // An abandoned row takes one ink and no other: the whole row is written
    // off, and brightening its intent inside the strike would argue with it.
    if (session.outcome === "abandoned") {
      lines.push(palette.abandoned(sessionRow(cells, widths, show)));
      continue;
    }
    lines.push(
      sessionRow(cells, widths, show, {
        intent: (text) => palette.intent(text),
        outcome: outcomeInk(palette, session.outcome),
      }),
    );
  }

  lines.push("", totalsRow(totals, widths, show));

  // The sentence the table is for. Everything that did not merge is money
  // still owed an outcome, which is a different question from the turn counts
  // below it — a productive session that nobody shipped wasted all of itself.
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
          `${spend.unpricedModels.join(", ")} — add rates to ${RATES_HINT}`,
      ),
    );
  }
  if (turns > 0) {
    lines.push(
      palette.meta(`${INDENT}${figure(empty)} of ${plural(turns, "turn", "turns")} changed no files`),
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
