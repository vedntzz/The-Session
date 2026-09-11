// `session` with no arguments: a state screen, not a menu.
import { formatUsd, priceSession, type RateTable } from "../../pricing.js";
import { inOwnWords, type Session } from "../../store.js";
import { plainPalette, type Palette } from "../palette.js";
import { NO_RATES, type View } from "./cost.js";
import { headOf } from "./intent.js";
import { clock, flatten, INDENT, padRight, plural, width, wrapSegments } from "./text.js";

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
  const { sentence, suggestions } = homeText(home, view.rates ?? NO_RATES);

  // Its own column rather than the layout's gutter at `GUTTER`: that one is
  // sized for a labelled table, and two short commands stretched across it
  // read as a table with the middle missing.
  const column = suggestions.reduce((soFar, { command }) => Math.max(soFar, width(command)), 0);

  // One sentence, however many lines a narrow terminal takes to hold it. The
  // sentence quotes an intent, and a prompt the hook captured is whatever was
  // typed at the agent — printed straight it is the whole screen.
  const lines = ["", ...wrapSegments([{ text: sentence }], view.width), ""];
  for (const { command, why } of suggestions) {
    lines.push(`${INDENT}${padRight(command, column + 3)}${palette.meta(why)}`);
  }
  return lines;
}

/** The sentence and the two commands, chosen by which state the repo is in. */
function homeText(home: Home, rates: RateTable): HomeText {
  if (home.running) {
    return whileRecording(home.running);
  }
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

/**
 * A session is open: what it asked for, and how to close it.
 *
 * A declaration prints whole — it is short, because somebody typed it at a
 * prompt — and a prompt the hook captured is shortened to its first sentence
 * with an ellipsis to say so. This is a state screen: one sentence, and a
 * paragraph of somebody's prompt is not one sentence. There is no `--full` to
 * send them to, because the session has not finished; `session stop` is right
 * underneath and the whole of it is in `show` after that.
 */
function whileRecording(running: Session): HomeText {
  const since = clock(running.startedAt);
  const what = running.intent === null ? "nothing asked yet" : asked(running);
  return {
    sentence: `Recording since ${since}: ${what}.`,
    suggestions: [
      { command: "session stop", why: "close it and record what changed" },
      { command: "session week", why: "the sessions before this one" },
    ],
  };
}

/** The running session's intent, at the length a one-sentence screen has room for. */
function asked(running: Session): string {
  if (inOwnWords(running)) {
    return flatten(running.intent ?? "");
  }
  const { head, cut } = headOf(running.intent ?? "");
  return `${flatten(head)}${cut ? " …" : ""}`;
}

/** Nothing is open: when the last one ended and what it cost. */
function afterLastSession(last: Session, rates: RateTable): HomeText {
  const price = priceSession(last.cost, rates);
  const cost = price.priced ? `, costing ${formatUsd(price.usd)}` : "";
  const ended = last.endedAt === null ? "" : ` at ${clock(last.endedAt)}`;
  return {
    sentence: `Nothing is recording. The last session ended${ended}${cost}.`,
    suggestions: [
      { command: "session show", why: "what that session asked for and changed" },
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
