// One session as a row, and the detail it opens. No script anywhere on the
// page: the disclosure is a `<details>`, which a keyboard already operates.
import type { AgentInfo } from "../../agents.js";
import { emptyTurnsOf } from "../../empty.js";
import { priceSession, formatUsd, wasMeasured, type RateTable } from "../../pricing.js";
import { hasDeclaredScope, intentSourceOf, totalTokens, type Session } from "../../store.js";
import { intentOf, markedIntent, INTENT_NOTE } from "../terminal.js";
import { stamp } from "../terminal.js";
import {
  changedPane,
  counterBlock,
  declaredPane,
  observationBlock,
  outsideBlock,
  sourceNote,
  tokenBlock,
} from "./detail.js";
import { escapeHtml, figure, plural } from "./text.js";

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
export function weighedInMoney(sessions: readonly Session[], rates: RateTable): boolean {
  return sessions.every((session) => priceSession(session.cost, rates).priced);
}

export function weigh(sessions: readonly Session[], rates: RateTable): number[] {
  if (weighedInMoney(sessions, rates)) {
    const prices = sessions.map((session) => priceSession(session.cost, rates));
    return prices.map((price) => (price.priced ? price.usd : 0));
  }
  return sessions.map((session) => totalTokens(session.cost));
}

/**
 * Which treatment a count gets. Red is reserved for a count that is actually
 * above zero: a red nought teaches the eye that red means nothing in
 * particular, and then the one number that matters cannot get its attention.
 */
export function hue(count: number): string {
  return count > 0 ? "waste" : "quiet";
}

/**
 * True when the session has no captured cost to report, rather than a zero.
 *
 * `wasMeasured` decides it, as it does for every other surface: a page that
 * dashed a different set of sessions from the table beside it would be two
 * answers to one question.
 */
export function uncosted(session: Session): boolean {
  return !wasMeasured(session.cost);
}

/**
 * The empty-turn cell. `unknown` where the record cannot say, never a nought —
 * a nought has the shape of a measurement and would say nothing was wasted.
 */
function emptyCell(session: Session): string {
  const empty = emptyTurnsOf(session);
  if (empty === undefined) {
    return `<span class="figure empty quiet">unknown</span>`;
  }
  return `<span class="figure empty ${hue(empty)}">${escapeHtml(figure(empty))} produced nothing</span>`;
}

/** The cost cells, or one dash when there was no cost to capture. */
export function costCells(session: Session, rates: RateTable, tokens: boolean): string {
  if (uncosted(session)) {
    return `<span class="figure nocost quiet">—</span>`;
  }
  const price = priceSession(session.cost, rates);
  const raw = tokens
    ? `<span class="figure tokens">${escapeHtml(figure(totalTokens(session.cost)))} tokens</span>`
    : "";
  return (
    `<span class="figure cost">${escapeHtml(price.priced ? formatUsd(price.usd) : "—")}</span>` +
    `<span class="figure turns">${escapeHtml(plural(session.cost.turns, "turn", "turns"))}</span>` +
    emptyCell(session) +
    raw
  );
}

/**
 * What the session changed that nobody declared. The count is the signal; the
 * paths are in the detail below, which is where a reader who wants them looks
 * rather than at a tooltip they have to find with a mouse.
 *
 * A session the hook recorded declared no scope, so it has no drift — and `0
 * outside` would be a claim that it stayed inside one.
 */
export function driftCell(session: Session): string {
  if (!hasDeclaredScope(session)) {
    return `<span class="figure drift quiet">no scope</span>`;
  }
  const count = session.drift.length;
  return `<span class="figure drift ${hue(count)}">${escapeHtml(figure(count))} outside</span>`;
}

/** The intent, marked with the source it came from. */
export function intentCell(session: Session): string {
  const note = INTENT_NOTE[intentSourceOf(session)];
  const text = note === undefined ? intentOf(session) : markedIntent(session);
  return `<span class="intent">${escapeHtml(text)}</span>`;
}

/** The row's cells, in the order the terminal table puts them. */
function summaryCells(session: Session, rates: RateTable, tokens: boolean): string {
  return (
    `<span class="when">${escapeHtml(stamp(session.startedAt))}</span>` +
    intentCell(session) +
    `<span class="source">${escapeHtml(intentSourceOf(session))}</span>` +
    costCells(session, rates, tokens) +
    driftCell(session) +
    `<span class="outcome">${escapeHtml(session.outcome)}</span>`
  );
}

/** Everything the row opens: the declaration, the diff, and the counters. */
function detailBody(session: Session, rates: RateTable, agents: readonly AgentInfo[]): string {
  return (
    `<div class="detail">` +
    sourceNote(session) +
    `<div class="panes"><div>${declaredPane(session)}</div>` +
    `<div>${changedPane(session)}</div></div>` +
    outsideBlock(session) +
    counterBlock(session, rates, agents) +
    tokenBlock(session) +
    observationBlock(session) +
    "</div>"
  );
}

export function renderRow(
  session: Session,
  weight: number,
  heaviest: number,
  rates: RateTable,
  tokens: boolean,
  agents: readonly AgentInfo[] = [],
): string {
  const height = rowHeight(weight, heaviest);
  const classes = session.outcome === "abandoned" ? "row abandoned" : "row";
  return (
    `<li class="${classes}"><details><summary class="cells" style="height:${height}px">` +
    summaryCells(session, rates, tokens) +
    `</summary>${detailBody(session, rates, agents)}</details></li>`
  );
}
