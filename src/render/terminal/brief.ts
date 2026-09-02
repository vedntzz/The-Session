// `session show`: three sentences, then the id and a line of three figures.
import { formatUsd, priceSession, wasMeasured, type RateTable } from "../../pricing.js";
import {
  isCaptured,
  type Session,
  type SessionCost,
  type SessionOutcome,
} from "../../store.js";
import { plainPalette, type Palette } from "../palette.js";
import { emptyTurnsOf } from "../../empty.js";
import { costCell, NO_RATES, wasteCell, type View } from "./cost.js";
import { CAPTURED_MARKER, intentOf } from "./intent.js";
import { summarizePaths } from "./paths.js";
import { INDENT, plural, shortId } from "./text.js";

// --- the brief views -----------------------------------------------------

/**
 * The default `session show`, and the reason `--full` exists.
 *
 * Three sentences and a line of figures. The labelled layout below says more,
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
 * The first sentence of all: where the work ended up.
 *
 * Read off `outcome`, which by the time a view runs holds what the repository
 * says now rather than what the record was written with — see `withOutcomes`.
 * The full view spends a labelled row on the same fact; here it is a sentence,
 * and it comes first because it is the question the reader opened `show` with.
 *
 * Four ends, four sentences, and each says only what its evidence supports. A
 * session still open has not landed and has not failed to, so it is not told
 * it did either. A session that changed no files never had anything to land,
 * and the sentence below it says that in its own words.
 *
 * "Landed on the default branch" rather than "shipped" or "merged": it is the
 * plainest description of the thing `outcome.ts` actually checked, which is
 * whether what the session left is in the default branch's history.
 */
const WHERE_IT_WENT: Record<SessionOutcome, string> = {
  merged: "The work landed on the default branch.",
  abandoned: "The work did not land on the default branch.",
  open: "The work has not landed on the default branch yet.",
  empty: "Nothing landed on the default branch.",
};

/** What `show` says when a session has no scope to have drifted from. */
const NO_DRIFT_POSSIBLE =
  "Nothing was declared to compare against — run session start --scope to see drift.";

/**
 * The second sentence: what was asked for.
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
 * The third sentence: what went outside what was declared.
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
 * The figures, on one line at the bottom and dim: what it cost, how many turns
 * that took, and how many of those turns produced nothing.
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
function figures(session: Session, rates: RateTable): string | undefined {
  const { cost } = session;
  if (!wasMeasured(cost)) {
    // Nothing was captured for this session. A row of zeroes would read as a
    // measurement of nothing rather than as an absence of measurement.
    return undefined;
  }
  const spent = costCell(cost, priceSession(cost, rates));
  const turns = plural(cost.turns, "turn", "turns");
  // Three figures where the third can be had, two where it cannot. A
  // `— produced nothing` in a line read at a glance is a shape the reader has
  // to stop and decode; the labelled view is where an absence is spelled out.
  const empty = emptyTurnsOf(session);
  const counts = empty === undefined ? [spent, turns] : [spent, turns, `${empty} produced nothing`];
  return counts.join(FIGURE_GAP);
}

/**
 * The bottom line: which session this was, and then the figures.
 *
 * The id leads it because it is the one part that is always there — a session
 * nothing was captured for has no figures at all, and it is exactly that
 * session somebody may still want to write a pull request body for. It is what
 * `session pr`, `session show` and `session mark` take, at the width `settle`
 * and `week` print, so a prefix read off any of them works in all of them.
 *
 * Dim, with the figures, because it is not a measurement: it is the handle on
 * the record the measurements came from.
 */
function bottomLine(session: Session, rates: RateTable): string {
  const counts = figures(session, rates);
  return counts === undefined
    ? shortId(session.id)
    : `${shortId(session.id)}${FIGURE_GAP}${counts}`;
}

/**
 * The session as `session show` prints it without `--full`.
 *
 * Three sentences now, in the order the questions are asked: where the work
 * went, what was asked for, and what went outside what was declared. Then, dim
 * at the bottom, the id this session answers to and the figures.
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
    // Left in the terminal's own colour, like the money. It is the one line
    // that is always there, and colouring what is always there says nothing;
    // the `merged` and `abandoned` inks stay where they mark one row out of a
    // table of them.
    `${INDENT}${WHERE_IT_WENT[session.outcome]}`,
    `${INDENT}${asked.before}${palette.intent(asked.intent)}${asked.after}`,
    `${INDENT}${outside.before}${palette.drift(outside.paths)}${outside.after}`,
  ];

  lines.push("", `${INDENT}${palette.meta(bottomLine(session, view.rates ?? NO_RATES))}`);
  return lines;
}
