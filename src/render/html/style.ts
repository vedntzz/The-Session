// The sheet, inlined: one file so a colour is changed in one place.
import { emptyTurnsOf } from "../../empty.js";
import type { Session } from "../../store.js";
import { escapeHtml } from "./text.js";

/**
 * The page's whole palette. Two of these carry meaning — `primary` marks what
 * a row is and what it cost, `waste` marks what was spent for nothing — and
 * the other three are structure. Nothing else on the page is coloured, so a
 * glance down it finds the intents, the money and the waste, and nothing
 * competes with them.
 */
export const TOKENS = {
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
export const DATA_FONT = `"Spline Sans Mono", ui-monospace, SFMono-Regular, Menlo, monospace`;

export const PROSE_FONT = `"Familjen Grotesk", ui-sans-serif, system-ui, -apple-system, "Helvetica Neue", sans-serif`;

export const BASE_STYLE = `
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
table.bysource {
  margin-top: 1.6rem;
  border-collapse: collapse;
  width: 100%;
  font-variant-numeric: tabular-nums;
}
table.bysource th {
  font-weight: 400;
  text-align: left;
  padding: 0 1.2rem 0.6rem 0;
  border-bottom: 1px solid var(--surface);
  vertical-align: bottom;
}
table.bysource th.num, table.bysource td.num { text-align: right; padding-right: 0; }
table.bysource td, table.bysource tbody th {
  padding: 0.7rem 1.2rem 0.7rem 0;
  border-bottom: 1px solid var(--surface);
  vertical-align: top;
  font-weight: 400;
}
table.bysource tbody th { color: var(--primary); }
table.bysource .figure { color: var(--primary); }
table.bysource .q { display: block; font-size: 0.8125rem; }
.nopool, .basis {
  margin-top: 1rem;
  max-width: 62rem;
  font-family: var(--prose);
}
.week { list-style: none; margin-top: 2.5rem; border-top: 1px solid var(--surface); }
.row { position: relative; border-bottom: 1px solid var(--surface); }
.row::before {
  content: "";
  position: absolute;
  left: 0;
  top: 2px;
  bottom: 2px;
  width: 2px;
  background: var(--surface);
}
summary.cells {
  display: grid;
  grid-template-columns: 6.5rem minmax(8rem, 1fr) 5rem 5rem 4.5rem 8.5rem 6.5rem 5.5rem;
  align-items: start;
  gap: 1.25rem;
  padding: 0.8rem 0.5rem 0 1.25rem;
  cursor: pointer;
  list-style: none;
}
summary.cells::-webkit-details-marker { display: none; }
summary.cells:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
.with-tokens summary.cells {
  grid-template-columns: 6.5rem minmax(8rem, 1fr) 5rem 5rem 4.5rem 8.5rem 10.5rem 6.5rem 5.5rem;
}
.intent {
  font-family: var(--prose);
  font-size: 1.0625rem;
  color: var(--primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.source { white-space: nowrap; }
.figure { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.cost { color: var(--primary); }
.tokens { font-weight: 300; }
.nocost { grid-column: span 3; }
.with-tokens .nocost { grid-column: span 4; }
.outcome { text-align: right; }
.quiet { color: var(--muted); }
.abandoned .intent { color: var(--muted); text-decoration: line-through; }
.detail {
  padding: 0.6rem 1.5rem 2rem 1.25rem;
  border-top: 1px solid var(--surface);
  background: var(--surface);
}
.immutable { font-family: var(--prose); margin-bottom: 1.4rem; }
.panes { display: grid; grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr)); gap: 1.8rem; }
.pane-label { color: var(--muted); letter-spacing: 0.06em; text-transform: uppercase; font-size: 0.75rem; }
.paths { list-style: none; margin-top: 0.6rem; }
.paths li { color: var(--primary); padding: 0.12rem 0; overflow-wrap: anywhere; }
.paths li.dropped { color: var(--muted); text-decoration: line-through; }
.paths .tag {
  margin-left: 0.6rem;
  padding: 0 0.4rem;
  font-size: 0.75rem;
  color: var(--muted);
  border: 1px solid var(--ground);
  text-decoration: none;
}
.said { font-family: var(--prose); margin-top: 0.6rem; max-width: 46rem; }
.aside { margin-top: 1.4rem; }
.counters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
  gap: 1.4rem;
  margin-top: 1.8rem;
  padding-top: 1.2rem;
  border-top: 1px solid var(--ground);
}
.counter dt { color: var(--muted); font-size: 0.75rem; letter-spacing: 0.06em; text-transform: uppercase; }
.counter .big { display: block; font-size: 1.15rem; margin-top: 0.3rem; color: var(--primary); }
.counter .big.quiet { color: var(--muted); font-size: 1rem; }
.counter .qual { display: block; margin-top: 0.35rem; font-family: var(--prose); }
.tokens-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  gap: 0.9rem;
  margin-top: 0.6rem;
}
.token .k { display: block; }
.token .v { display: block; color: var(--primary); font-variant-numeric: tabular-nums; }
.obs { list-style: none; margin-top: 0.6rem; }
.obs li {
  display: grid;
  grid-template-columns: 14rem 7rem minmax(0, 1fr) 6rem;
  gap: 1rem;
  padding: 0.3rem 0;
  font-variant-numeric: tabular-nums;
}
.obs li .w { color: var(--primary); }
.counters, .tokens-grid, .obs { font-variant-numeric: tabular-nums; }
.nothing { margin-top: 2.5rem; font-family: var(--prose); }
footer { margin-top: 2.5rem; font-family: var(--prose); }
@media (max-width: 60rem) {
  summary.cells, .with-tokens summary.cells { grid-template-columns: 1fr 1fr; gap: 0.4rem 1rem; }
  .intent { grid-column: 1 / -1; white-space: normal; }
  .nocost, .with-tokens .nocost { grid-column: span 2; }
  .obs li { grid-template-columns: 1fr; gap: 0.1rem; }
}
`.trim();

/**
 * Carried only by a page that has waste to mark. A week that wasted nothing
 * contains the red nowhere at all — not on an element, not in the stylesheet.
 */
export const WASTE_STYLE = `
:root { --waste: ${TOKENS.waste}; }
.waste { color: var(--waste); }
.paths li.outside { color: var(--waste); }
.paths li.outside::before { content: "! "; }
.outside > .pane-label { color: var(--waste); }
.detail > .outside { margin-top: 1.4rem; }
`.trim();

export function styleSheet(wasteful: boolean): string {
  return wasteful ? `${BASE_STYLE}\n${WASTE_STYLE}` : BASE_STYLE;
}

/**
 * True when anything on the page is worth marking in the waste hue.
 *
 * A session whose empty turns are unknown is not wasteful here. Not knowing is
 * not something to mark — the same reason the cell itself takes no hue.
 */
export function isWasteful(sessions: readonly Session[]): boolean {
  return sessions.some(
    (session) => (emptyTurnsOf(session) ?? 0) > 0 || session.drift.length > 0,
  );
}

/** Everything above `<body>`: the meta tags and the sheet, inlined. */
export function documentHead(title: string, wasteful: boolean): string[] {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${styleSheet(wasteful)}</style>`,
    "</head>",
  ];
}
