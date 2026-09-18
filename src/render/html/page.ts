// The week as a page: the window split by source, the rows, and what the rows
// leave out.
import { describeFilter, type View } from "../terminal.js";
import type { SessionFilter } from "../../commands/week.js";
import { formatUsd, shippedNote, spendOf, type RateTable, type Spend } from "../../pricing.js";
import type { Session } from "../../store.js";
import { intentLegends } from "../terminal.js";
import { documentHead, isWasteful } from "./style.js";
import { emptyTurnsTotal, unmeasuredEmpty } from "../../empty.js";
import { NO_POOL_NOTE, sourceTable } from "./summary.js";
import { hue, renderRow, weigh, weighedInMoney } from "./row.js";
import { escapeHtml, figure, plural } from "./text.js";

export { hue, rowHeight, weigh, MIN_ROW, MAX_ROW } from "./row.js";

export function sum(sessions: readonly Session[], of: (session: Session) => number): number {
  return sessions.reduce((running, session) => running + of(session), 0);
}

/**
 * Which axis the rows were compared on, said out loud.
 *
 * The page falls back to tokens as soon as one session cannot be priced, so
 * the reader is told — a column of heights that quietly changed what it meant
 * would rank the window on a measure nobody chose.
 */
export function basisNote(sessions: readonly Session[], rates: RateTable): string {
  if (weighedInMoney(sessions, rates)) {
    return (
      "Rows compared in money: every session in this window has a rate for its model."
    );
  }
  return (
    "Rows compared in tokens, not money: at least one session here has no rate for" +
    " its model, and a dollar column would rank the window on partial figures. The" +
    " known spend above is unchanged, per source, with its coverage stated."
  );
}

export function renderBody(sessions: readonly Session[], window: string, view: View): string {
  if (sessions.length === 0) {
    return `<p class="nothing">No sessions in the last ${escapeHtml(window)}</p>`;
  }
  const rates = view.rates ?? new Map();
  const showTokens = view.tokens === true;
  return (
    sourceTable(sessions, rates) +
    `<p class="nopool">${escapeHtml(NO_POOL_NOTE)}</p>` +
    `<p class="basis">${escapeHtml(basisNote(sessions, rates))}</p>` +
    rowsBlock(sessions, rates, showTokens) +
    footerBlock(sessions, spendOf(sessions, rates))
  );
}

/** The rows themselves, each as tall as its share of the money. */
export function rowsBlock(
  sessions: readonly Session[],
  rates: RateTable,
  showTokens: boolean,
): string {
  const weights = weigh(sessions, rates);
  const heaviest = Math.max(...weights);
  const rows = sessions
    .map((session, index) => renderRow(session, weights[index] ?? 0, heaviest, rates, showTokens))
    .join("");
  return `<ol class="week${showTokens ? " with-tokens" : ""}">${rows}</ol>`;
}

/**
 * The money the window spent, and how much of it has not landed.
 *
 * Omitted where the total is nought, whether because nothing was spent or
 * because nothing could be priced — the table above carries that distinction,
 * per source, which is the only place it can be stated without pooling.
 */
function spentLine(spend: Spend): string {
  return spend.usd > 0
    ? `<p>${escapeHtml(formatUsd(spend.usd))} spent, ${escapeHtml(shippedNote(spend))}</p>`
    : "";
}

/**
 * Said either way, like the terminal's note: a page that drops the line reads
 * as a week where nothing was wasted.
 */
function wastedLine(sessions: readonly Session[]): string {
  const turns = sum(sessions, (session) => session.cost.turns);
  if (turns === 0) {
    return "";
  }
  const empty = emptyTurnsTotal(sessions);
  if (empty === undefined) {
    const unknown = plural(unmeasuredEmpty(sessions), "session", "sessions");
    return (
      `<p class="quiet">${escapeHtml(unknown)} cannot say which turns changed no files` +
      " — the diff answers for the session, not for the turn</p>"
    );
  }
  return (
    `<p><span class="${hue(empty)}">${escapeHtml(figure(empty))}</span> of ` +
    `${escapeHtml(plural(turns, "turn", "turns"))} changed no files</p>`
  );
}

/** A legend per marker the rows actually carry. */
function legendLines(sessions: readonly Session[]): string {
  return intentLegends(sessions)
    .map(
      (legend) =>
        `<p>${escapeHtml(`${legend.marker} ${plural(legend.count, "session", "sessions")}`)} ` +
        `${escapeHtml(legend.text)}</p>`,
    )
    .join("");
}

/** What the rows do not say: the split of the money, the waste, the marker. */
export function footerBlock(sessions: readonly Session[], spend: Spend): string {
  const spent = spentLine(spend);
  const wasted = wastedLine(sessions);
  const recorded = legendLines(sessions);
  return spent || wasted || recorded ? `<footer>${spent}${wasted}${recorded}</footer>` : "";
}

/**
 * The week as a page: one row per session, tallest where the money went, each
 * opening onto what it declared and what it changed.
 *
 * Self-contained by construction — no scripts, no stylesheets, no fonts and no
 * images fetched from anywhere. It is a file on the developer's disk that
 * happens to be opened by a browser, and it stays readable with the network
 * unplugged.
 */
export function renderWeek(
  sessions: readonly Session[],
  days: number,
  filter: SessionFilter = {},
  view: View = {},
): string {
  const window = plural(days, "day", "days");
  // The same reason the terminal says so: a filtered page whose heading does
  // not admit it is a page whose totals mean something other than they look.
  const narrowed = describeFilter(filter);
  const suffix = narrowed ? `, ${narrowed}` : "";
  const heading = `The last ${window}${suffix}`;

  return [
    ...documentHead(`session — the last ${window}${suffix}`, isWasteful(sessions)),
    "<body>",
    "<main>",
    `<h1>${escapeHtml(heading)}</h1>`,
    renderBody(sessions, `${window}${suffix}`, view),
    "</main>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
