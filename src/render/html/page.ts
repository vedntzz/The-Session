// The week as a page: the summary, the rows, and what the rows leave out.
import { describeFilter, stamp, type View } from "../terminal.js";
import type { SessionFilter } from "../../commands/week.js";
import {
  formatUsd,
  priceSession,
  shippedNote,
  spendOf,
  unpricedThroughout,
  type RateTable,
  type Spend,
} from "../../pricing.js";
import { isCaptured, totalTokens, type Session } from "../../store.js";
import { intentOf } from "../terminal.js";
import { documentHead, isWasteful } from "./style.js";
import { emptyTurnsOf, emptyTurnsTotal, unmeasuredEmpty } from "../../empty.js";
import { escapeHtml } from "./text.js";

/** Shortest a row gets, so a cheap session is still a readable line. */
export const MIN_ROW = 44;

/** Tallest a row gets. The heaviest session in the window is exactly this. */
export const MAX_ROW = 180;


/**
 * How tall a session's row stands: its share of the heaviest session in the
 * window. Spend is the only thing the layout encodes, which is why there are
 * no charts — the row is the chart.
 *
 * The floor means rows below about a quarter of the heaviest all stand the
 * same height; below that a row would be too short to read, and an unreadable
 * row states its cost at the price of stating anything else.
 */
export function rowHeight(weight: number, heaviest: number): number {
  if (heaviest <= 0) {
    return MIN_ROW;
  }
  return Math.max(MIN_ROW, Math.round((weight / heaviest) * MAX_ROW));
}

/**
 * What a row's height is measured in: dollars when every session in the window
 * has a price, tokens otherwise.
 *
 * Money is the truer axis — it is what the height is trying to say — but it
 * only works when the whole window is on it. One unpriced session among priced
 * ones would stand at the floor and read as cheap rather than as unknown, so
 * the window falls back to the axis every session can be put on.
 */
export function weigh(sessions: readonly Session[], rates: RateTable): number[] {
  const prices = sessions.map((session) => priceSession(session.cost, rates));
  if (prices.every((price) => price.priced)) {
    return prices.map((price) => (price.priced ? price.usd : 0));
  }
  return sessions.map((session) => totalTokens(session.cost));
}

/** The marker the terminal table uses for an intent nobody declared. */
export const CAPTURED_MARKER = "~";

/**
 * Which treatment a count gets. Red is reserved for a count that is actually
 * above zero: a red nought teaches the eye that red means nothing in
 * particular, and then the one number that matters cannot get its attention.
 */
export function hue(count: number): string {
  return count > 0 ? "waste" : "quiet";
}

/** True when the session has no captured cost to report, rather than a zero. */
export function uncosted(session: Session): boolean {
  return session.cost.turns === 0 && session.cost.apiCalls === 0;
}

export function figure(value: number): string {
  return value.toLocaleString("en-US");
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The cost cells, or one dash when there was no cost to capture. */
export function costCells(session: Session, rates: RateTable, tokens: boolean): string {
  if (uncosted(session)) {
    return `<span class="figure nocost quiet">—</span>`;
  }

  const { turns } = session.cost;
  const price = priceSession(session.cost, rates);
  const raw = tokens
    ? `<span class="figure tokens">${escapeHtml(figure(totalTokens(session.cost)))} tokens</span>`
    : "";
  // A dash where the diff cannot say which turn wrote a file, and no hue on
  // it: the waste ink means there is something here, and not knowing is not
  // something here.
  const empty = emptyTurnsOf(session);
  const emptyCell =
    empty === undefined
      ? `<span class="figure empty quiet">— produced nothing</span>`
      : `<span class="figure empty ${hue(empty)}">${escapeHtml(figure(empty))} produced nothing</span>`;

  return (
    `<span class="figure cost">${escapeHtml(price.priced ? formatUsd(price.usd) : "—")}</span>` +
    `<span class="figure turns">${escapeHtml(plural(turns, "turn", "turns"))}</span>` +
    emptyCell +
    raw
  );
}

/**
 * What the session changed that nobody declared. The count is the signal; the
 * paths are on the element, so the question "which files?" is a hover rather
 * than another column.
 *
 * A session the hook recorded declared no scope, so it has no drift — and `0
 * outside` would be a claim that it stayed inside one. The column says which
 * of the two it is looking at instead.
 */
export function driftCell(session: Session): string {
  if (isCaptured(session)) {
    return (
      `<span class="figure drift quiet" title="no scope was declared, ` +
      `so there is nothing for these paths to be outside of">no scope</span>`
    );
  }

  const count = session.drift.length;
  const paths =
    count > 0 ? ` title="${session.drift.map(escapeHtml).join("&#10;")}"` : "";
  return `<span class="figure drift ${hue(count)}"${paths}>${escapeHtml(figure(count))} outside</span>`;
}

/**
 * The intent, marked when nobody declared it. The same `~` the terminal table
 * uses, for the same reason: the page is read next to that table, and a
 * distinction drawn one way in one view and another way in the other is a
 * distinction the reader has to learn twice.
 */
export function intentCell(session: Session): string {
  const intent = intentOf(session);
  if (!isCaptured(session)) {
    return `<span class="intent">${escapeHtml(intent)}</span>`;
  }
  return (
    `<span class="intent" title="captured from the first prompt, not declared">` +
    `${escapeHtml(`${CAPTURED_MARKER} ${intent}`)}</span>`
  );
}

export function renderRow(
  session: Session,
  weight: number,
  heaviest: number,
  rates: RateTable,
  tokens: boolean,
): string {
  const classes = session.outcome === "abandoned" ? "row abandoned" : "row";

  return (
    `<li class="${classes}" style="height:${rowHeight(weight, heaviest)}px">` +
    `<span class="when">${escapeHtml(stamp(session.startedAt))}</span>` +
    intentCell(session) +
    costCells(session, rates, tokens) +
    driftCell(session) +
    `<span class="outcome">${escapeHtml(session.outcome)}</span>` +
    `</li>`
  );
}

export function sum(sessions: readonly Session[], of: (session: Session) => number): number {
  return sessions.reduce((running, session) => running + of(session), 0);
}

export function renderBody(sessions: readonly Session[], window: string, view: View): string {
  if (sessions.length === 0) {
    return `<p class="nothing">No sessions in the last ${escapeHtml(window)}</p>`;
  }

  const rates = view.rates ?? new Map();
  const showTokens = view.tokens === true;
  const spend = spendOf(sessions, rates);

  return (
    summaryLine(sessions, spend, showTokens) +
    rowsBlock(sessions, rates, showTokens) +
    footerBlock(sessions, spend)
  );
}

/**
 * The one line above the rows: how much of what, and how much of it went
 * outside plan.
 *
 * The money is left out only where there is none to give — a window nothing
 * could be priced in. A window that genuinely cost nothing carries `$0.00`,
 * because that is what it cost; dropping it there would render an absence and
 * a nought the same way, and the page would have no way to tell the reader
 * which of the two it meant.
 */
export function summaryLine(sessions: readonly Session[], spend: Spend, showTokens: boolean): string {
  const turns = sum(sessions, (session) => session.cost.turns);
  // Summed per session, so the rows add up to the total. A file that drifted
  // in two sessions drifted twice.
  const drift = sum(sessions, (session) => session.drift.length);
  const tokens = sum(sessions, (session) => totalTokens(session.cost));
  const counted = [
    plural(sessions.length, "session", "sessions"),
    ...(unpricedThroughout(spend) ? [] : [formatUsd(spend.usd)]),
    plural(turns, "turn", "turns"),
    ...(showTokens ? [`${figure(tokens)} tokens`] : []),
  ]
    .map(escapeHtml)
    .join(" · ");
  return (
    `<p class="summary">${counted} · ` +
    `<span class="${hue(drift)}">${escapeHtml(figure(drift))} outside</span></p>`
  );
}

/** The rows themselves, each as tall as its share of the money. */
export function rowsBlock(sessions: readonly Session[], rates: RateTable, showTokens: boolean): string {
  const weights = weigh(sessions, rates);
  const heaviest = Math.max(...weights);
  const rows = sessions
    .map((session, index) => renderRow(session, weights[index] ?? 0, heaviest, rates, showTokens))
    .join("");
  return `<ol class="week${showTokens ? " with-tokens" : ""}">${rows}</ol>`;
}

/** What the rows do not say: the split of the money, the waste, the marker. */
export function footerBlock(sessions: readonly Session[], spend: Spend): string {
  const turns = sum(sessions, (session) => session.cost.turns);
  const empty = emptyTurnsTotal(sessions);
  // Not in the waste hue. Red is for money that is definitely gone, and most
  // of this figure is work that has simply not landed yet. Omitted where the
  // total is nought, whether because nothing was spent or because nothing
  // could be priced — the summary above carries that distinction.
  const spent =
    spend.usd > 0
      ? `<p>${escapeHtml(formatUsd(spend.usd))} spent, ${escapeHtml(shippedNote(spend))}</p>`
      : "";
  // Said either way, like the terminal's note: a page that drops the line
  // reads as a week where nothing was wasted.
  const wasted =
    turns === 0
      ? ""
      : empty !== undefined
        ? `<p><span class="${hue(empty)}">${escapeHtml(figure(empty))}</span> of ` +
          `${escapeHtml(plural(turns, "turn", "turns"))} changed no files</p>`
        : `<p class="quiet">${escapeHtml(plural(unmeasuredEmpty(sessions), "session", "sessions"))} ` +
          "cannot say which turns changed no files — the diff answers for the session, " +
          "not for the turn</p>";
  // The legend for the marker on those rows, and only when there are any.
  const captured = sessions.filter(isCaptured).length;
  const recorded =
    captured > 0
      ? `<p>${escapeHtml(`~ ${plural(captured, "session", "sessions")}`)} recorded by the hook: ` +
        `intent captured from the first prompt, no scope declared</p>`
      : "";
  return spent || wasted || recorded ? `<footer>${spent}${wasted}${recorded}</footer>` : "";
}

/**
 * The week as a page: one row per session, tallest where the money went.
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
