// The window, one row per intent source. Nothing here is ever a total.
//
// Declared, primed and captured are different evidence: a pooled figure would
// move whenever their mix moved and would describe none of the three. Prime can
// lower drift mechanically by putting historical misses into the accepted
// scope, so pooling its sessions with unaided declarations would disguise that
// change as better planning. See the `measurement-rules` skill.
import { formatUsd, isPriced, priceSession, wasMeasured, type RateTable } from "../../pricing.js";
import {
  hasDeclaredScope,
  INTENT_SOURCES,
  intentSourceOf,
  type IntentSource,
  type Session,
} from "../../store.js";
import { escapeHtml, figure, plural } from "./text.js";

/** One source's own figures. They are never added to another source's. */
export interface SourceTotals {
  source: IntentSource;
  count: number;
  open: number;
  priced: number;
  usd: number;
  turns: number;
  uncaptured: number;
  /** Sessions that declared a scope — the drift denominator. */
  scoped: number;
  driftPaths: number;
  driftSessions: number;
}

export function totalsFor(
  source: IntentSource,
  all: readonly Session[],
  rates: RateTable,
): SourceTotals {
  const mine = all.filter((session) => intentSourceOf(session) === source);
  const prices = mine.map((session) => priceSession(session.cost, rates)).filter(isPriced);
  const counted = mine.filter((session) => wasMeasured(session.cost));
  return {
    source,
    count: mine.length,
    open: mine.filter((session) => session.outcome === "open").length,
    priced: prices.length,
    usd: prices.reduce((running, price) => running + price.usd, 0),
    turns: counted.reduce((running, session) => running + session.cost.turns, 0),
    uncaptured: mine.length - counted.length,
    ...driftOf(mine),
  };
}

/**
 * Drift over every session that declared a scope, open ones included.
 *
 * Drift is a fact about planning and it is settled the moment a session stops;
 * what an open session is missing is a destination, not a diff. Only the rates
 * about where work went leave it out.
 */
function driftOf(mine: readonly Session[]): Pick<SourceTotals, "scoped" | "driftPaths" | "driftSessions"> {
  const scoped = mine.filter(hasDeclaredScope);
  return {
    scoped: scoped.length,
    driftPaths: scoped.reduce((running, session) => running + session.drift.length, 0),
    driftSessions: scoped.filter((session) => session.drift.length > 0).length,
  };
}

/** A figure, and under it the coverage that qualifies it. */
function td(value: string, note?: string, tone = "figure"): string {
  const qualifier = note === undefined ? "" : `<span class="q">${escapeHtml(note)}</span>`;
  return `<td class="num"><span class="${tone}">${escapeHtml(value)}</span>${qualifier}</td>`;
}

function sessionsCell(totals: SourceTotals): string {
  if (totals.count === 0) {
    return td("none", undefined, "quiet");
  }
  const open = totals.open > 0 ? `${totals.open} open, not yet settled` : undefined;
  return td(figure(totals.count), open);
}

/** Known spend, with its own coverage. Never added across sources. */
function spendCell(totals: SourceTotals): string {
  if (totals.count === 0) {
    return td("—", undefined, "quiet");
  }
  if (totals.priced === 0) {
    return td("none priced", `0 of ${totals.count}`, "quiet");
  }
  return td(formatUsd(totals.usd), `${totals.priced} of ${totals.count} priced`);
}

function turnsCell(totals: SourceTotals): string {
  if (totals.count === 0) {
    return td("—", undefined, "quiet");
  }
  const missing = totals.uncaptured > 0 ? `${totals.uncaptured} not captured` : undefined;
  return td(figure(totals.turns), missing);
}

/**
 * What this source changed outside what it declared.
 *
 * A source whose sessions declared no scope says so rather than reporting
 * none: `0 outside` would be a claim that they stayed inside one.
 */
function driftCell(totals: SourceTotals): string {
  if (totals.count === 0) {
    return td("—", undefined, "quiet");
  }
  if (totals.scoped === 0) {
    return td("no scope declared", "nothing to compare against", "quiet");
  }
  if (totals.driftPaths === 0) {
    return td("none", `in ${totals.scoped} that declared one`, "quiet");
  }
  const where = `in ${totals.driftSessions} of ${totals.scoped} that declared one`;
  return td(plural(totals.driftPaths, "path", "paths"), where, "waste");
}

function sourceRow(totals: SourceTotals): string {
  return (
    `<tr><th scope="row">${escapeHtml(totals.source)}</th>` +
    sessionsCell(totals) +
    spendCell(totals) +
    turnsCell(totals) +
    driftCell(totals) +
    "</tr>"
  );
}

const HEADINGS = ["Intent source", "Sessions", "Known spend", "Turns", "Outside scope"];

function tableHead(): string {
  const cells = HEADINGS.map((heading, index) =>
    index === 0
      ? `<th scope="col">${escapeHtml(heading)}</th>`
      : `<th scope="col" class="num">${escapeHtml(heading)}</th>`,
  ).join("");
  return `<thead><tr>${cells}</tr></thead>`;
}

/**
 * The window above the rows, split three ways and never summed.
 *
 * Every source prints, including one holding nothing: dropping an empty arm
 * would leave the others reading as the whole answer, which is the pooled
 * reading this exists to prevent.
 */
export function sourceTable(sessions: readonly Session[], rates: RateTable): string {
  const rows = INTENT_SOURCES.map((source) =>
    sourceRow(totalsFor(source, sessions, rates)),
  ).join("");
  return `<table class="bysource">${tableHead()}<tbody>${rows}</tbody></table>`;
}

export const NO_POOL_NOTE =
  "Never totalled. Declared, primed and captured are different evidence, and a " +
  "pooled figure would move whenever their mix moved rather than when anything " +
  "about the work changed. A source with nothing in it still prints its row. " +
  "Sessions still open are counted and named: they have not settled, which is " +
  "not the same as having failed, and no rate about where work went includes them.";
