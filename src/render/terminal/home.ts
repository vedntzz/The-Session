// `session` with no arguments: a state screen, not a menu.
import { sessionFigure, type RateTable } from "../../pricing.js";
import type { Session } from "../../store.js";
import { plainPalette, type Palette } from "../palette.js";
import { NO_RATES, type View } from "./cost.js";
import { formatRecordingHome } from "./home-recording.js";
import { clock, INDENT, padRight, width, wrapSegments } from "./text.js";

// --- the home screen -----------------------------------------------------

/** What the repo looks like right now, for the bare `session` screen. */
export interface Home {
  /** The session still running, when there is one. */
  running?: Session;
  /** The most recent session that has stopped, when there is one. */
  last?: Session;
}

/** One thing worth typing next, and why. */
interface Suggestion {
  command: string;
  why: string;
}

/**
 * What to say when somebody types `session` and nothing else.
 *
 * One sentence about where the repo stands, then at most two commands. Two,
 * not eight: a menu is something to read, and the reader typed a bare command
 * because they did not want to read anything. Which two depends on the state,
 * because in every state there is one obvious next move and at most one other
 * worth knowing about.
 *
 * `session --help` is the list, and `session help all` is the whole list. This
 * screen is not either of those and should never grow into one.
 */
export function formatHome(
  home: Home,
  palette: Palette = plainPalette,
  view: View = {},
): string[] {
  if (home.running) return formatRecordingHome(home.running, palette, view.width);
  const { sentence, suggestions } = homeText(home, view.rates ?? NO_RATES);
  const column = suggestions.reduce((soFar, { command }) => Math.max(soFar, width(command)), 0);
  const lines = ["", ...wrapSegments([{ text: sentence }], view.width), ""];
  for (const { command, why } of suggestions) {
    lines.push(`${INDENT}${padRight(command, column + 3)}${palette.meta(why)}`);
  }
  return lines;
}

/** The sentence and the two commands, chosen by which state the repo is in. */
function homeText(home: Home, rates: RateTable): HomeText {
  if (home.last) {
    return afterLastSession(home.last, rates);
  }
  return beforeAnySession();
}

/** One sentence and at most two commands. See `formatHome`. */
interface HomeText {
  sentence: string;
  suggestions: Suggestion[];
}

/** Nothing is open: when the last one ended and what it cost. */
function afterLastSession(last: Session, rates: RateTable): HomeText {
  const figure = sessionFigure(last.cost, rates);
  const cost = figure === undefined ? "" : `, costing ${figure}`;
  const ended = last.endedAt === null ? "" : ` at ${clock(last.endedAt)}`;
  return {
    sentence: `Nothing is recording. The last session ended${ended}${cost}.`,
    suggestions: [
      { command: "session week last", why: "what that session asked for and changed" },
      { command: 'session start "…"', why: "declare the next one before the agent runs" },
    ],
  };
}

/** An empty log: the two ways to start recording at all. */
function beforeAnySession(): HomeText {
  return {
    sentence: "No sessions recorded in this repo yet.",
    suggestions: [
      { command: 'session start "…"', why: "declare what you are about to do" },
      { command: "session hook install", why: "record them automatically instead" },
    ],
  };
}
