// `session show --full`: the labelled layout.
import { classOf } from "../../classify.js";
import { attributionEntries } from "../../config.js";
import { formatUsd, priceSession, type Price, type RateTable } from "../../pricing.js";
import { isCaptured, totalTokens, type Session } from "../../store.js";
import { plainPalette, type Palette } from "../palette.js";
import { breakdown, costCell, NO_RATES, outcomeInk, wasteCell, type View } from "./cost.js";
import { CAPTURED_INTENT, DRIFT_MARKER, intentOf, NO_SCOPE, SCOPE_HINT } from "./intent.js";
import { clock, figure, gap, INDENT, label, padRight, plural, width } from "./text.js";

/**
 * The session as `session show --full` prints it.
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
  // Cost and attribution share the last block, and a session no transcript was
  // captured for has neither. The blank line above them goes with them, rather
  // than being left hanging off the end of the view.
  const footer = [...costLines(session, palette, view), ...attributionLines(session, palette)];
  return [
    "",
    headingLine(session, palette),
    "",
    outcomeLine(session, palette),
    ...capturedIntentLines(session, palette),
    declaredLine(session, palette),
    ...changedLines(session, palette),
    ...outsideLines(session, palette),
    ...(footer.length > 0 ? ["", ...footer] : []),
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
 * Money left, counts in the gutter beside it. Last in the view, under the
 * paths: what a session cost is a detail, and this is the view somebody opened
 * because they wanted the details. Nothing is printed for a session no
 * transcript was captured for.
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
