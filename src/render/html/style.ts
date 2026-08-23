// The sheet, inlined: one file so a colour is changed in one place.
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
export const WASTE_STYLE = `
:root { --waste: ${TOKENS.waste}; }
.waste { color: var(--waste); }
`.trim();

export function styleSheet(wasteful: boolean): string {
  return wasteful ? `${BASE_STYLE}\n${WASTE_STYLE}` : BASE_STYLE;
}

/** True when anything on the page is worth marking in the waste hue. */
export function isWasteful(sessions: readonly Session[]): boolean {
  return sessions.some((session) => session.cost.emptyTurns > 0 || session.drift.length > 0);
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
