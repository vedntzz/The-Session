// `session show`: two sentences and a line of three figures.
import { formatUsd, priceSession, type RateTable } from "../../pricing.js";
import { isCaptured, type Session, type SessionCost } from "../../store.js";
import { plainPalette, type Palette } from "../palette.js";
import { costCell, NO_RATES, wasteCell, type View } from "./cost.js";
import { CAPTURED_MARKER, intentOf } from "./intent.js";
import { summarizePaths } from "./paths.js";
import { INDENT, plural } from "./text.js";

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
    const declared = `${files} changed outside what you declared`;
    // The count in front is always exact; the paths are what gets dropped when
    // there are too many of them to read, and `--full` still has every one.
    const summary = summarizePaths(session.drift);
    if (summary.named.length === 0) {
      return { before: `${declared}, ${summary.where}.`, paths: "", after: "" };
    }
    return { before: `${declared}: `, paths: summary.named.join(", "), after: "." };
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
