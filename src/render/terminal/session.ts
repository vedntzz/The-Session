// `session week <id> --full`: the labelled layout.
import { attributionEntries } from "../../config.js";
import { priceSession, wasMeasured, type Price } from "../../pricing.js";
import { intentSourceOf, type Session } from "../../store.js";
import { plainPalette, type Palette } from "../palette.js";
import { emptyTurnsOf } from "../../empty.js";
import {
  breakdown,
  callsCell,
  costCell,
  NO_RATES,
  outcomeInk,
  pricesChecked,
  wasteCell,
  type View,
} from "./cost.js";
import { intentOf, INTENT_NOTE } from "./intent.js";
import { changedLines, declaredLine, labelledPaths, outsideLines } from "./session-paths.js";
import { turnModelRows } from "./turn-models.js";
import { clock, flatten, gap, INDENT, label, plural, shortId, wrapSegments } from "./text.js";

/**
 * The session as `session week <id> --full` prints it.
 *
 * `outcome` is the first labelled row: where the work ended up is the question
 * the reader came with, and it used to be the last thing they found. The
 * intent stays above it as the heading, because it is the title of the view
 * rather than a row in it.
 *
 * `changed` and `outside` partition what actually changed: the paths that
 * landed inside the declared scope, then the ones that did not. Reading both
 * gives back `reality` exactly, with no path listed twice. Both come before
 * the cost rows — the gap between what was declared and what happened is what
 * this tool measures that nothing else does.
 */
export function formatSession(
  session: Session,
  palette: Palette = plainPalette,
  view: View = {},
): string[] {
  // The id, the cost and the attribution share the last block. A session no
  // transcript was captured for has no cost rows and may have no attribution,
  // but it always has an id, so the block — and the blank line above it — is
  // always there.
  const footer = [
    idLine(session, palette),
    ...costLines(session, palette, view), ...turnModelRows(session, palette),
    ...attributionLines(session, palette),
    ...pricesLines(session, palette, view),
  ];
  return [
    "",
    ...headingLine(session, palette, view.width),
    "",
    outcomeLine(session, palette),
    ...capturedIntentLines(session, palette),
    ...declaredLine(session, palette, view.width),
    ...(session.proposal ? labelledPaths("proposed",
      session.proposal.scope.length ? session.proposal.scope.map((p) => JSON.stringify(p)) : ["no suggestion"],
      palette.path, palette, view.width) : []),
    ...changedLines(session, palette, view.width),
    ...outsideLines(session, palette, view.width),
    "",
    ...footer,
  ];
}

/**
 * The id, in the footer with the rest of the bookkeeping.
 *
 * It is what `session pr`, `session week <id>` and `session mark` take, and until
 * this row existed no view printed one — the id was in the JSONL and nowhere
 * else. Eight characters, the width `settle` and `week` print, which is enough
 * of a prefix for any of those commands to find the session again.
 *
 * Not at the top: the first labelled row is where the work ended up, which is
 * the question the reader opened the view with. An id is a handle, and a
 * handle belongs beside what it costs and who it was for.
 */
function idLine(session: Session, palette: Palette): string {
  return `${INDENT}${palette.meta(label("id"))}${shortId(session.id)}`;
}

/**
 * The intent, with the times it ran between out in the gutter.
 *
 * **This is the one view that holds a whole prompt**, and it is where `week <id>`
 * and the bare screen send the reader who wanted the rest of one they
 * shortened. So nothing here is ever cut — a captured prompt runs to
 * `MAX_INTENT` and prints to `MAX_INTENT` — but it is flattened and wrapped,
 * because a 500-character heading is one line the terminal folds at whatever
 * column it reaches, with no indent, and the labelled rows underneath then
 * read as a continuation of it.
 *
 * The times stay in the gutter of the first line while the heading is one
 * line. Once it wraps there is no gutter left to put them in, so they go
 * under it — the same rule the path rows follow.
 */
function headingLine(session: Session, palette: Palette, limit?: number): string[] {
  const intent = flatten(intentOf(session));
  const ended = session.endedAt === null ? "still running" : clock(session.endedAt);
  const times = `${clock(session.startedAt)} → ${ended}`;
  // Measured off the plain text and inked afterwards: `gap` and the wrap both
  // count the characters a reader sees, and an escape code is not one.
  const lines = wrapSegments([{ text: intent, ink: palette.intent }], limit);
  if (lines.length === 1) {
    return [`${lines[0] as string}${gap(`${INDENT}${intent}`)}${palette.meta(times)}`];
  }
  return [...lines, `${INDENT}${palette.meta(times)}`];
}

/**
 * Said outright, and only when it applies. A declared intent is the ordinary
 * case and says so by having no line here; a captured one is a different kind
 * of evidence and a reader comparing it to the paths below is owed the
 * difference.
 */
function capturedIntentLines(session: Session, palette: Palette): string[] {
  const note = INTENT_NOTE[intentSourceOf(session)];
  if (note === undefined) {
    return [];
  }
  return [`${INDENT}${palette.meta(label("intent"))}${palette.meta(note)}`];
}

/**
 * Money left, counts in the gutter beside it. Last in the view, under the
 * paths: what a session cost is a detail, and this is the view somebody opened
 * because they wanted the details. Nothing is printed for a session no
 * transcript was captured for.
 */
function costLines(session: Session, palette: Palette, view: View): string[] {
  if (!wasMeasured(session.cost)) {
    return [];
  }
  const price = priceSession(session.cost, view.rates ?? NO_RATES);
  const lines = [spentLine(session, palette, price), wasteLine(session, palette, price, callsCell(session.cost, view))];
  if (view.tokens) {
    lines.push(`${INDENT}${palette.meta(label("tokens"))}${palette.meta(breakdown(session.cost))}`);
  }
  return lines;
}

/**
 * How old the prices behind the cost row are, under everything else.
 *
 * Only where `--tokens` asked: it is the view somebody opens to see what the
 * money is made of, and the age of the rates is part of that. Unlabelled and
 * last, because it is a footnote about the view rather than another fact about
 * the session — the same line `week` closes with, from the same function, so
 * the two cannot come to word it differently.
 *
 * Only where there is a figure to date, too. A session nothing was captured
 * for and one no rate covers both print no money, and dating prices under
 * either would read as an explanation of why the money is missing.
 */
function pricesLines(session: Session, palette: Palette, view: View): string[] {
  if (view.tokens !== true || view.checked === undefined || !wasMeasured(session.cost)) {
    return [];
  }
  if (!priceSession(session.cost, view.rates ?? NO_RATES).priced) {
    return [];
  }
  return [palette.meta(`${INDENT}${pricesChecked(view.checked)}`)];
}

/**
 * What it cost, with the turns beside it. The cost itself is left in the
 * terminal's own colour: it is the figure that is always there, and colouring
 * what is always there says nothing.
 */
function spentLine(session: Session, palette: Palette, price: Price): string {
  const { turns } = session.cost;
  const cell = costCell(session.cost, price);
  const spent = `${INDENT}${label("cost")}${cell}`;
  const empty = emptyTurnsOf(session);
  const counts =
    empty === undefined
      ? plural(turns, "turn", "turns")
      : `${plural(turns, "turn", "turns")}, ${empty} that produced nothing`;
  return (
    `${INDENT}${palette.meta(label("cost"))}${cell}` + `${gap(spent)}${palette.meta(counts)}`
  );
}

/**
 * What the turns that produced nothing cost, with the api calls beside it.
 *
 * The api calls are a count and nothing more. There was a second figure here —
 * how many of them wrote no files — and it is gone rather than corrected: a
 * transcript reports the tool a call used, never what the call did to the
 * disk, so the figure was the tool-name guess with a number's face on. Kept on
 * old records, printed nowhere.
 */
function wasteLine(session: Session, palette: Palette, price: Price, counts: string): string {
  const waste = wasteCell(session, price);
  const wasted = `${INDENT}${label("no edits")}${waste.text}`;
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
