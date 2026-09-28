// `session week <id>`: three sentences, then the id and a line of three figures.
import { priceSession, wasMeasured, type RateTable } from "../../pricing.js";
import type { Session } from "../../store.js";
import { plainPalette, type Palette } from "../palette.js";
import { emptyTurnsOf } from "../../empty.js";
import { askedFor, wentOutside, WHERE_IT_WENT } from "./brief-sentences.js";
import { costCell, NO_RATES, type View } from "./cost.js";
import { INDENT, plural, shortId, wrapSegments } from "./text.js";
import { turnModelNote } from "./turn-models.js";

// --- the brief views -----------------------------------------------------

/**
 * The default `session week <id>`, and the reason `--full` exists.
 *
 * Three sentences and a line of figures. The labelled layout below says more,
 * and says it in a shape that has to be learned: which column means what, what
 * a bare `!` marks, why `declared` and `changed` are different lines. That is
 * the right trade for somebody studying a session and the wrong one for
 * somebody who has just watched an agent run for forty minutes and wants to
 * know whether it went where they said. So the short answer is what `week <id>`
 * gives, and the layout is a flag away.
 *
 * Nothing here is computed differently. The sentences are the same `intent`,
 * `scope`, `drift` and `cost` the full view reads; what changed is how much of
 * it is said at once. The sentences themselves are in `brief-sentences.ts`.
 */

/** Separates the figures on the metadata line. */
const FIGURE_GAP = " · ";

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
 * `session pr`, `session week <id>` and `session mark` take, at the width `settle`
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
 * The session as `session week <id>` prints it without `--full`.
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
  const limit = view.width;
  const lines = [
    "",
    // Left in the terminal's own colour, like the money. It is the one line
    // that is always there, and colouring what is always there says nothing;
    // the `merged` and `abandoned` inks stay where they mark one row out of a
    // table of them.
    ...wrapSegments([{ text: WHERE_IT_WENT[session.outcome] }], limit),
    // Three sentences, however many lines each of them takes. The ink goes on
    // after the wrap, so an escape code never counts toward a width and the
    // quotes stay outside the words they are quoting.
    ...wrapSegments(
      [
        { text: asked.before },
        { text: asked.intent, ink: palette.intent },
        { text: asked.after },
      ],
      limit,
    ),
    ...wrapSegments(
      [
        { text: outside.before },
        { text: outside.paths, ink: palette.drift },
        { text: outside.after },
      ],
      limit,
    ),
  ];

  lines.push("", `${INDENT}${palette.meta(bottomLine(session, view.rates ?? NO_RATES))}`, ...turnModelNote(session, palette));
  return lines;
}
