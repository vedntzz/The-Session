import { classOf } from "../classify.js";
import type { SessionFilter } from "../commands/week.js";
import { attributionEntries } from "../config.js";
import {
  formatUsd,
  priceSession,
  rateStub,
  spendOf,
  unpricedThroughout,
  USER_RATES_FILE,
  type Price,
  type RateTable,
  type Spend,
} from "../pricing.js";
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
export const CAPTURED_MARKER = "~";

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
const RATES_HINT = USER_RATES_FILE;

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
  return [
    "",
    headingLine(session, palette),
    "",
    ...capturedIntentLines(session, palette),
    declaredLine(session, palette),
    ...changedLines(session, palette),
    ...outsideLines(session, palette),
    "",
    ...costLines(session, palette, view),
    ...attributionLines(session, palette),
    outcomeLine(session, palette),
  ];
}

/** The intent, with the times it ran between out in the gutter. */
function headingLine(session: Session, palette: Palette): string {
  // Inked and measured separately: `gap` counts the characters a reader sees,
  // and an escape code is not one of them.
  const intent = intentOf(session);
  const heading = `${INDENT}${intent}`;
  const ended = session.endedAt === null ? "still running" : clock(session.endedAt);
  const times = `${clock(session.startedAt)} → ${ended}`;
  return `${INDENT}${palette.intent(intent)}${gap(heading)}${palette.meta(times)}`;
}

/**
 * Said outright, and only when it applies. A declared intent is the ordinary
 * case and says so by having no line here; a captured one is a different kind
 * of evidence and a reader comparing it to the paths below is owed the
 * difference.
 */
function capturedIntentLines(session: Session, palette: Palette): string[] {
  if (!isCaptured(session)) {
    return [];
  }
  return [`${INDENT}${palette.meta(label("intent"))}${palette.meta(CAPTURED_INTENT)}`];
}

/**
 * What was declared, or why nothing was.
 *
 * A passive session has an empty scope because nobody was asked for one, not
 * because somebody declared that nothing would change. Printing "none
 * declared" there would read as a developer who declared nothing; printing an
 * empty drift line under it would read as a session that stayed inside a
 * scope. Neither happened, so the line says what did — and says what to do
 * about it, since declaring a scope is the whole of how drift becomes visible.
 */
function declaredLine(session: Session, palette: Palette): string {
  if (isCaptured(session)) {
    const bare = `${INDENT}${label("declared")}${NO_SCOPE}`;
    return (
      `${INDENT}${palette.meta(label("declared"))}${palette.meta(NO_SCOPE)}` +
      `${gap(bare)}${palette.meta(SCOPE_HINT)}`
    );
  }
  const declared = session.scope.length > 0 ? session.scope.join("  ") : "none declared";
  return `${INDENT}${palette.meta(label("declared"))}${palette.path(declared)}`;
}

/**
 * The paths that landed inside the declared scope.
 *
 * With `outsideLines` below this partitions what actually changed, so reading
 * both gives back `reality` exactly, with no path listed twice. Where every
 * changed path drifted there is no line: the `outside` line accounts for all
 * of them.
 */
function changedLines(session: Session, palette: Palette): string[] {
  const drifted = new Set(session.drift);
  const inScope = session.reality.filter((path) => !drifted.has(path));
  if (inScope.length > 0) {
    return [`${INDENT}${palette.meta(label("changed"))}${palette.path(inScope.join("  "))}`];
  }
  if (session.reality.length === 0) {
    return [`${INDENT}${palette.meta(label("changed"))}${palette.path("nothing")}`];
  }
  return [];
}

/** The paths that went outside what was declared, marked and counted. */
function outsideLines(session: Session, palette: Palette): string[] {
  if (session.drift.length === 0) {
    return [];
  }
  const marked = session.drift.map((path) => `${DRIFT_MARKER} ${path}`).join("  ");
  const bare = `${INDENT}${label("outside")}${marked}`;
  const note = `← you did not declare ${session.drift.length === 1 ? "this" : "these"}`;
  return [
    `${INDENT}${palette.meta(label("outside"))}${palette.drift(marked)}` +
      `${gap(bare)}${palette.meta(note)}`,
  ];
}

/**
 * Money first, counts in the gutter beside it: what the session cost is the
 * question, and the counters are how it got there. Nothing is printed for a
 * session no transcript was captured for.
 */
function costLines(session: Session, palette: Palette, view: View): string[] {
  const { turns, apiCalls } = session.cost;
  if (turns === 0 && apiCalls === 0) {
    return [];
  }
  const price = priceSession(session.cost, view.rates ?? NO_RATES);
  const lines = [spentLine(session, palette, price), wasteLine(session, palette, price)];
  if (view.tokens) {
    lines.push(`${INDENT}${palette.meta(label("tokens"))}${palette.meta(breakdown(session.cost))}`);
  }
  return lines;
}

/**
 * What it cost, with the turns beside it. The cost itself is left in the
 * terminal's own colour: it is the figure that is always there, and colouring
 * what is always there says nothing.
 */
function spentLine(session: Session, palette: Palette, price: Price): string {
  const { turns, emptyTurns } = session.cost;
  const cell = costCell(session.cost, price);
  const spent = `${INDENT}${label("cost")}${cell}`;
  const counts = `${plural(turns, "turn", "turns")}, ${emptyTurns} without edits`;
  return (
    `${INDENT}${palette.meta(label("cost"))}${cell}` + `${gap(spent)}${palette.meta(counts)}`
  );
}

/** What the turns that wrote nothing cost, with the api calls beside it. */
function wasteLine(session: Session, palette: Palette, price: Price): string {
  const { apiCalls, callsWithoutEdits } = session.cost;
  const waste = wasteCell(session.cost, price);
  const wasted = `${INDENT}${label("no edits")}${waste.text}`;
  const counts = `${plural(apiCalls, "api call", "api calls")}, ${callsWithoutEdits} without edits`;
  return (
    `${INDENT}${palette.meta(label("no edits"))}${waste.spent ? palette.waste(waste.text) : waste.text}` +
    `${gap(wasted)}` +
    palette.meta(counts)
  );
}

/**
 * Who it was for, one field per line rather than run together: `sow` and
 * `billingCode` are strings of characters nobody can tell apart on sight, and
 * an unlabelled pair of them would be unreadable.
 */
function attributionLines(session: Session, palette: Palette): string[] {
  return attributionEntries(session.attribution).map(
    ([key, value]) => `${INDENT}${palette.meta(label(key))}${palette.meta(value)}`,
  );
}

function outcomeLine(session: Session, palette: Palette): string {
  const ink = outcomeInk(palette, session.outcome);
  return `${INDENT}${palette.meta(label("outcome"))}${ink(session.outcome)}`;
}

// --- the brief views -----------------------------------------------------

/**
 * The default `session show`, and the reason `--full` exists.
 *
 * Two sentences and a line of figures. The labelled layout below says more,
 * and says it in a shape that has to be learned: which column means what, what
 * a bare `!` marks, why `declared` and `changed` are different lines. That is
 * the right trade for somebody studying a session and the wrong one for
 * somebody who has just watched an agent run for forty minutes and wants to
 * know whether it went where they said. So the short answer is what `show`
 * gives, and the layout is a flag away.
 *
 * Nothing here is computed differently. The sentences are the same `intent`,
 * `scope`, `drift` and `cost` the full view reads; what changed is how much of
 * it is said at once.
 */

/** Separates the figures on the metadata line. */
const FIGURE_GAP = " · ";

/**
 * How many drift paths the sentence names before it starts counting instead.
 * Three is what fits on a line beside the words around it.
 */
const DRIFT_IN_SENTENCE = 3;

/** What `show` says when a session has no scope to have drifted from. */
const NO_DRIFT_POSSIBLE =
  "Nothing was declared to compare against — run session start --scope to see drift.";

/**
 * The first sentence: what was asked for.
 *
 * Returned in three pieces so the intent itself can be inked without the
 * sentence around it going bold too. A captured intent says so in the
 * sentence rather than in a line of its own — it is the same fact the full
 * view spends a row on, and here it is four words.
 */
function askedFor(session: Session): { before: string; intent: string; after: string } {
  if (session.intent === null) {
    // Nothing to ink, so the whole sentence is the frame.
    const text =
      session.endedAt === null
        ? "Nothing has been asked yet."
        : "Nothing was ever asked: the session ended before a prompt arrived.";
    return { before: text, intent: "", after: "" };
  }
  // Quoted, and the quotes sit outside the ink. Somebody's own words run into
  // the sentence around them otherwise, and the reader who most needs this
  // view is the one reading it with colour turned off in a log.
  if (isCaptured(session)) {
    return {
      before: 'Your first prompt was "',
      intent: session.intent,
      after: '", and you declared nothing up front.',
    };
  }
  return { before: 'You asked for "', intent: session.intent, after: '".' };
}

/**
 * The second sentence: what went outside what was declared.
 *
 * Four cases, ordered by which fact a tired reader most needs. Something went
 * outside, and here it is; nothing changed at all; nothing was declared, so
 * the question cannot be asked; everything stayed inside.
 */
function wentOutside(session: Session): { before: string; paths: string; after: string } {
  if (session.drift.length > 0) {
    const files = plural(session.drift.length, "file", "files");
    const shown = session.drift.slice(0, DRIFT_IN_SENTENCE);
    // The count is always exact; the list is not always complete. A sentence
    // naming twelve paths is a sentence nobody reads to the end, and the
    // number in front of it is the part that decides whether to run `--full`.
    const rest = session.drift.length - shown.length;
    return {
      before: `${files} changed outside what you declared: `,
      paths: shown.join(", "),
      after: rest > 0 ? `, and ${rest} more.` : ".",
    };
  }
  // Before the scope check, because it is the stronger fact. A session that
  // changed nothing had nothing to go outside a scope, declared or not, and
  // sending that reader off to `--scope` would answer a question they do not
  // have.
  if (session.reality.length === 0) {
    return { before: "It changed no files at all.", paths: "", after: "" };
  }
  if (session.scope.length === 0) {
    return { before: NO_DRIFT_POSSIBLE, paths: "", after: "" };
  }
  return { before: "Everything it changed stayed inside what you declared.", paths: "", after: "" };
}

/**
 * The figures, on one line: what it cost, how many turns that took, and how
 * many of those turns produced nothing.
 *
 * Three numbers, because they are the three a person acts on. The api-call
 * counters, the token breakdown and what the empty turns cost in money are
 * all real and all in `--full`; putting them here would make the line a table
 * again, which is the thing this view is not.
 *
 * The money is left in the terminal's own colour, as everywhere else: it is
 * the figure that is always there, and colouring what is always there says
 * nothing.
 */
function figures(cost: SessionCost, rates: RateTable): string | undefined {
  if (cost.turns === 0 && cost.apiCalls === 0) {
    // Nothing was captured for this session. A row of zeroes would read as a
    // measurement of nothing rather than as an absence of measurement.
    return undefined;
  }
  const spent = costCell(cost, priceSession(cost, rates));
  const turns = plural(cost.turns, "turn", "turns");
  return [spent, turns, `${cost.emptyTurns} produced nothing`].join(FIGURE_GAP);
}

/**
 * The session as `session show` prints it without `--full`.
 *
 * Colour does the same work it does everywhere else and no more: the intent is
 * the line you look for first, the drift paths are the thing that is there,
 * and everything framing them is dim. No role is used here that the full view
 * does not use for the same thing.
 */
export function formatBrief(
  session: Session,
  palette: Palette = plainPalette,
  view: View = {},
): string[] {
  const asked = askedFor(session);
  const outside = wentOutside(session);

  const lines = [
    "",
    `${INDENT}${asked.before}${palette.intent(asked.intent)}${asked.after}`,
    `${INDENT}${outside.before}${palette.drift(outside.paths)}${outside.after}`,
  ];

  const line = figures(session.cost, view.rates ?? NO_RATES);
  if (line !== undefined) {
    lines.push("", `${INDENT}${palette.meta(line)}`);
  }
  return lines;
}

// --- the home screen -----------------------------------------------------

/** What the repo looks like right now, for the bare `session` screen. */
export interface Home {
  /** The session still running, when there is one. */
  running?: Session;
  /** The most recent session that has stopped, when there is one. */
  last?: Session;
}

/** One thing worth typing next, and why. */
interface Suggestion {
  command: string;
  why: string;
}

/**
 * What to say when somebody types `session` and nothing else.
 *
 * One sentence about where the repo stands, then at most two commands. Two,
 * not eight: a menu is something to read, and the reader typed a bare command
 * because they did not want to read anything. Which two depends on the state,
 * because in every state there is one obvious next move and at most one other
 * worth knowing about.
 *
 * `session --help` is the list, and `session help all` is the whole list. This
 * screen is not either of those and should never grow into one.
 */
export function formatHome(
  home: Home,
  palette: Palette = plainPalette,
  view: View = {},
): string[] {
  const { sentence, suggestions } = homeText(home, view.rates ?? NO_RATES);

  // Its own column rather than the layout's gutter at `GUTTER`: that one is
  // sized for a labelled table, and two short commands stretched across it
  // read as a table with the middle missing.
  const column = suggestions.reduce((soFar, { command }) => Math.max(soFar, width(command)), 0);

  const lines = ["", `${INDENT}${sentence}`, ""];
  for (const { command, why } of suggestions) {
    lines.push(`${INDENT}${padRight(command, column + 3)}${palette.meta(why)}`);
  }
  return lines;
}

/** The sentence and the two commands, chosen by which state the repo is in. */
function homeText(home: Home, rates: RateTable): HomeText {
  if (home.running) {
    return whileRecording(home.running);
  }
  if (home.last) {
    return afterLastSession(home.last, rates);
  }
  return beforeAnySession();
}

/** One sentence and at most two commands. See `formatHome`. */
interface HomeText {
  sentence: string;
  suggestions: Suggestion[];
}

/** A session is open: what it asked for, and how to close it. */
function whileRecording(running: Session): HomeText {
  const since = clock(running.startedAt);
  const what = running.intent === null ? "nothing asked yet" : running.intent;
  return {
    sentence: `Recording since ${since}: ${what}.`,
    suggestions: [
      { command: "session stop", why: "close it and record what changed" },
      { command: "session week", why: "the sessions before this one" },
    ],
  };
}

/** Nothing is open: when the last one ended and what it cost. */
function afterLastSession(last: Session, rates: RateTable): HomeText {
  const price = priceSession(last.cost, rates);
  const cost = price.priced ? `, costing ${formatUsd(price.usd)}` : "";
  const ended = last.endedAt === null ? "" : ` at ${clock(last.endedAt)}`;
  return {
    sentence: `Nothing is recording. The last session ended${ended}${cost}.`,
    suggestions: [
      { command: "session show", why: "what that session asked for and changed" },
      { command: 'session start "…"', why: "declare the next one before the agent runs" },
    ],
  };
}

/** An empty log: the two ways to start recording at all. */
function beforeAnySession(): HomeText {
  return {
    sentence: "No sessions recorded in this repo yet.",
    suggestions: [
      { command: 'session start "…"', why: "declare what you are about to do" },
      { command: "session hook install", why: "record them automatically instead" },
    ],
  };
}

// --- the command list ----------------------------------------------------

/** One row of `session help all`. Subcommands carry their parent in the name. */
export interface CommandEntry {
  name: string;
  description: string;
}

/**
 * Every command, for `session help all`.
 *
 * The bare `--help` lists three, which is a decision about what a first reader
 * needs rather than a claim about what exists. This is where the claim is
 * kept, and it is built from the command tree itself rather than from a list
 * beside it — a list beside it would be one release away from being wrong.
 */
export function formatCommands(
  entries: readonly CommandEntry[],
  palette: Palette = plainPalette,
): string[] {
  const widest = entries.reduce((soFar, entry) => Math.max(soFar, width(entry.name)), 0);

  const lines = ["", `${INDENT}Every command. The short list is session --help.`, ""];
  for (const entry of entries) {
    lines.push(`${INDENT}${padRight(entry.name, widest + 2)}${palette.meta(entry.description)}`);
  }
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

/**
 * The file to write, whole, under the line that said a price was missing.
 *
 * A pointer at `~/.session/rates.json` tells somebody where to go and not what
 * to put there, and the format is not one anybody knows by heart. This is the
 * whole document with the model already in it, so the answer to an unpriced
 * week is a paste and four numbers.
 *
 * `meta`, like the line above it: it is framing around the figures, and no
 * view earns a colour role for showing a file.
 */
function stubLines(models: readonly string[], palette: Palette): string[] {
  return rateStub(models)
    .split("\n")
    .map((line) => palette.meta(`${INDENT}${line}`));
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
