// `session week <id> --full`'s cost rows: what it cost, what the turns that produced nothing cost, and how old the prices are.
import { priceSession, wasMeasured, type Price } from "../../pricing.js";
import type { Session } from "../../store.js";
import type { Palette } from "../palette.js";
import { emptyTurnsOf } from "../../empty.js";
import { breakdown, callsCell, costCell, NO_RATES, pricesChecked, wasteCell, type View } from "./cost.js";
import { gap, INDENT, label, plural } from "./text.js";

/**
 * Money left, counts in the gutter beside it. Last in the view, under the
 * paths: what a session cost is a detail, and this is the view somebody opened
 * because they wanted the details. Nothing is printed for a session no
 * transcript was captured for.
 */
export function costLines(session: Session, palette: Palette, view: View): string[] {
  if (!wasMeasured(session.cost)) {
    return [];
  }
  const price = priceSession(session.cost, view.rates ?? NO_RATES);
  const lines = [spentLine(session, palette, price), wasteLine(session, palette, price, callsCell(session.cost, view))];
  const by = session.cost.capturedBy;
  if (by !== undefined) lines.push(`${INDENT}${palette.meta(label("captured"))}${palette.meta(CAPTURED[by])}`);
  if (view.tokens) {
    lines.push(`${INDENT}${palette.meta(label("tokens"))}${palette.meta(breakdown(session.cost))}`);
  }
  return lines;
}

/** Which transcripts the cost was read from (SES-2). Records stopped before it say nothing; all were by window. */
const CAPTURED = {
  "agent-session": "its own agent sessions' transcripts",
  window: "every transcript in its time window and repo",
} as const;

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
export function pricesLines(session: Session, palette: Palette, view: View): string[] {
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
