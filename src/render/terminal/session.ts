// `session week <id> --full`: the labelled layout.
import { attributionEntries } from "../../config.js";
import { intentSourceOf, type Session } from "../../store.js";
import { plainPalette, type Palette } from "../palette.js";
import { outcomeInk, type View } from "./cost.js";
import { intentOf, INTENT_NOTE } from "./intent.js";
import { costLines, pricesLines } from "./session-cost.js";
import { detailCostTable } from "./session-cost-table.js";
import { detailDeclarationTable } from "./session-declaration.js";
import { sessionPathRows } from "./session-paths.js";
import { turnModelRows } from "./turn-models.js";
import { clock, flatten, gap, INDENT, label, shortId, wrapSegments } from "./text.js";

/** Full detail tables begin with the declaration; paths still precede the cost. */
export function formatSession(
  session: Session,
  palette: Palette = plainPalette,
  view: View = {},
): string[] {
  return [
    ...declarationRows(session, palette, view.width),
    ...sessionPathRows(session, palette, view.width),
    "",
    ...sessionFooter(session, palette, view),
  ];
}

/** A pipe retains the existing heading and source rows byte for byte. */
function declarationRows(session: Session, palette: Palette, width?: number): string[] {
  if (width !== undefined) return ["", ...detailDeclarationTable(session, palette, width)];
  return ["", ...headingLine(session, palette), "", outcomeLine(session, palette), ...capturedIntentLines(session, palette)];
}

function sessionFooter(session: Session, palette: Palette, view: View): string[] {
  if (view.width !== undefined) return detailCostTable(session, palette, view.width, view);
  return [idLine(session, palette),
    ...costLines(session, palette, view), ...turnModelRows(session, palette),
    ...attributionLines(session, palette), ...pricesLines(session, palette, view),
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
