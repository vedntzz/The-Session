import type { SessionFilter } from "../commands/week.js";
import { formatUsd, priceSession, spendOf, type RateTable } from "../pricing.js";
import { totalTokens, type Session } from "../store.js";
import { describeFilter, stamp, type View } from "./terminal.js";

/**
 * The page's whole palette. Two of these carry meaning — `primary` marks what
 * a row is and what it cost, `waste` marks what was spent for nothing — and
 * the other three are structure. Nothing else on the page is coloured, so a
 * glance down it finds the intents, the money and the waste, and nothing
 * competes with them.
 */
const TOKENS = {
  ground: "#0A0B0C",
  surface: "#16191C",
  muted: "#6E747A",
  primary: "#EDEBE7",
  waste: "#A62F3C",
} as const;

/**
 * Named exactly, then fallen back to what the machine already has. The page is
 * a local file opened offline: fetching a webfont would put a third party
 * between the developer and their own record.
 */
const DATA_FONT = `"Spline Sans Mono", ui-monospace, SFMono-Regular, Menlo, monospace`;
const PROSE_FONT = `"Familjen Grotesk", ui-sans-serif, system-ui, -apple-system, "Helvetica Neue", sans-serif`;

/** Shortest a row gets, so a cheap session is still a readable line. */
const MIN_ROW = 44;
/** Tallest a row gets. The heaviest session in the window is exactly this. */
const MAX_ROW = 180;

/** Everything that could close a tag or an attribute early. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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
function weigh(sessions: readonly Session[], rates: RateTable): number[] {
  const prices = sessions.map((session) => priceSession(session.cost, rates));
  if (prices.every((price) => price.priced)) {
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

/** True when the session has no captured cost to report, rather than a zero. */
function uncosted(session: Session): boolean {
  return session.cost.turns === 0 && session.cost.apiCalls === 0;
}

function figure(value: number): string {
  return value.toLocaleString("en-US");
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

const BASE_STYLE = `
:root {
  --ground: ${TOKENS.ground};
  --surface: ${TOKENS.surface};
  --muted: ${TOKENS.muted};
  --primary: ${TOKENS.primary};
  --data: ${DATA_FONT};
  --prose: ${PROSE_FONT};
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: var(--ground);
  color: var(--muted);
  font-family: var(--data);
  font-size: 14px;
  line-height: 1.45;
  padding: 3rem 2rem 4rem;
  -webkit-font-smoothing: antialiased;
}
main { max-width: 72rem; margin: 0 auto; }
h1 {
  font-family: var(--prose);
  font-size: 1rem;
  font-weight: 500;
  color: var(--muted);
}
.summary { margin-top: 0.4rem; font-variant-numeric: tabular-nums; }
.week { list-style: none; margin-top: 2.5rem; border-top: 1px solid var(--surface); }
.row {
  position: relative;
  display: grid;
  grid-template-columns: 6.5rem minmax(8rem, 1fr) 5rem 4.5rem 8.5rem 6.5rem 5.5rem;
  align-items: start;
  gap: 1.25rem;
  padding: 0.8rem 0.5rem 0 1.25rem;
  border-bottom: 1px solid var(--surface);
}
.with-tokens .row {
  grid-template-columns: 6.5rem minmax(8rem, 1fr) 5rem 4.5rem 8.5rem 10.5rem 6.5rem 5.5rem;
}
.row::before {
  content: "";
  position: absolute;
  left: 0;
  top: 2px;
  bottom: 2px;
  width: 2px;
  background: var(--surface);
}
.intent {
  font-family: var(--prose);
  font-size: 1.0625rem;
  color: var(--primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.figure { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.cost { color: var(--primary); }
.tokens { font-weight: 300; }
.nocost { grid-column: span 3; }
.with-tokens .nocost { grid-column: span 4; }
.outcome { text-align: right; }
.quiet { color: var(--muted); }
.abandoned .intent { color: var(--muted); text-decoration: line-through; }
.nothing { margin-top: 2.5rem; font-family: var(--prose); }
footer { margin-top: 2.5rem; font-family: var(--prose); }
`.trim();

/**
 * Carried only by a page that has waste to mark. A week that wasted nothing
 * contains the red nowhere at all — not on an element, not in the stylesheet.
 */
const WASTE_STYLE = `
:root { --waste: ${TOKENS.waste}; }
.waste { color: var(--waste); }
`.trim();

function styleSheet(wasteful: boolean): string {
  return wasteful ? `${BASE_STYLE}\n${WASTE_STYLE}` : BASE_STYLE;
}

/** The cost cells, or one dash when there was no cost to capture. */
function costCells(session: Session, rates: RateTable, tokens: boolean): string {
  if (uncosted(session)) {
    return `<span class="figure nocost quiet">—</span>`;
  }

  const { turns, emptyTurns } = session.cost;
  const price = priceSession(session.cost, rates);
  const raw = tokens
    ? `<span class="figure tokens">${escapeHtml(figure(totalTokens(session.cost)))} tokens</span>`
    : "";

  return (
    `<span class="figure cost">${escapeHtml(price.priced ? formatUsd(price.usd) : "—")}</span>` +
    `<span class="figure turns">${escapeHtml(plural(turns, "turn", "turns"))}</span>` +
    `<span class="figure empty ${hue(emptyTurns)}">` +
    `${escapeHtml(figure(emptyTurns))} without edits</span>` +
    raw
  );
}

/**
 * What the session changed that nobody declared. The count is the signal; the
 * paths are on the element, so the question "which files?" is a hover rather
 * than another column.
 */
function driftCell(session: Session): string {
  const count = session.drift.length;
  const paths =
    count > 0 ? ` title="${session.drift.map(escapeHtml).join("&#10;")}"` : "";
  return `<span class="figure drift ${hue(count)}"${paths}>${escapeHtml(figure(count))} outside</span>`;
}

function renderRow(
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
    `<span class="intent">${escapeHtml(session.intent)}</span>` +
    costCells(session, rates, tokens) +
    driftCell(session) +
    `<span class="outcome">${escapeHtml(session.outcome)}</span>` +
    `</li>`
  );
}

function sum(sessions: readonly Session[], of: (session: Session) => number): number {
  return sessions.reduce((running, session) => running + of(session), 0);
}

function renderBody(sessions: readonly Session[], window: string, view: View): string {
  if (sessions.length === 0) {
    return `<p class="nothing">No sessions in the last ${escapeHtml(window)}</p>`;
  }

  const rates = view.rates ?? new Map();
  const showTokens = view.tokens === true;

  const turns = sum(sessions, (session) => session.cost.turns);
  const empty = sum(sessions, (session) => session.cost.emptyTurns);
  const tokens = sum(sessions, (session) => totalTokens(session.cost));
  // Summed per session, so the rows add up to the total. A file that drifted
  // in two sessions drifted twice.
  const drift = sum(sessions, (session) => session.drift.length);
  const spend = spendOf(sessions, rates);

  const weights = weigh(sessions, rates);
  const heaviest = Math.max(...weights);

  const counted = [
    plural(sessions.length, "session", "sessions"),
    ...(spend.usd > 0 ? [formatUsd(spend.usd)] : []),
    plural(turns, "turn", "turns"),
    ...(showTokens ? [`${figure(tokens)} tokens`] : []),
  ]
    .map(escapeHtml)
    .join(" · ");
  const summary =
    `<p class="summary">${counted} · ` +
    `<span class="${hue(drift)}">${escapeHtml(figure(drift))} outside</span></p>`;

  // Not in the waste hue. Red is for money that is definitely gone, and most
  // of this figure is work that has simply not landed yet.
  const spent =
    spend.usd > 0
      ? `<p>${escapeHtml(formatUsd(spend.usd))} spent, ` +
        `${escapeHtml(formatUsd(spend.unmerged))} of it on changes that never merged</p>`
      : "";
  const wasted =
    turns > 0
      ? `<p><span class="${hue(empty)}">${escapeHtml(figure(empty))}</span> of ` +
        `${escapeHtml(plural(turns, "turn", "turns"))} changed no files</p>`
      : "";
  const footer = spent || wasted ? `<footer>${spent}${wasted}</footer>` : "";

  return (
    summary +
    `<ol class="week${showTokens ? " with-tokens" : ""}">` +
    sessions
      .map((session, index) => renderRow(session, weights[index] ?? 0, heaviest, rates, showTokens))
      .join("") +
    `</ol>` +
    footer
  );
}

/** True when anything on the page is worth marking in the waste hue. */
function isWasteful(sessions: readonly Session[]): boolean {
  return sessions.some((session) => session.cost.emptyTurns > 0 || session.drift.length > 0);
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
  const title = `session — the last ${window}${suffix}`;

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${styleSheet(isWasteful(sessions))}</style>`,
    "</head>",
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
