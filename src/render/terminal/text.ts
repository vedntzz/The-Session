// Padding, widths and the small conversions every terminal view shares.
export const INDENT = "  ";

/** Width of the label column, sized to the longest label the layout uses. */
export const LABEL_WIDTH = 12;

/** Column the right-hand gutter starts in. */
export const GUTTER = 56;

/** What the gutter narrows to rather than closing up on an over-long line. */
export const MIN_GAP = 2;

/** Visible width. Code points, not UTF-16 units, so an emoji-free intent lines up. */
export function width(text: string): number {
  return [...text].length;
}

export function label(name: string): string {
  return name.padEnd(LABEL_WIDTH);
}

/** Spaces enough to start the gutter at `GUTTER`, given the visible left side. */
export function gap(left: string): string {
  return " ".repeat(Math.max(GUTTER - width(left), MIN_GAP));
}

/** Local wall-clock time, which is how the developer remembers the session. */
export function clock(iso: string): string {
  const at = new Date(iso);
  const hours = String(at.getHours()).padStart(2, "0");
  const minutes = String(at.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Local calendar day. Written out in full because the views that use it look
 * back over months — `08-12` in a report spanning a year is a date the reader
 * cannot place, which is exactly the ambiguity `stamp` is free of inside a week.
 */
export function day(iso: string): string {
  const at = new Date(iso);
  const month = String(at.getMonth() + 1).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${String(at.getDate()).padStart(2, "0")}`;
}

/**
 * How much of a session id is printed, and so how much of one has to be typed.
 *
 * Ids are UUIDs and nobody types those; every command that takes one accepts
 * an unambiguous prefix — see `findSession`. Eight is what `settle` and `mark`
 * have always shown, and one width across every view is the whole point: a
 * prefix copied off a `week` row has to be the prefix `pr` and `mark` answer
 * to, or the reader learns the rule in one view and meets a different answer
 * in the next.
 */
export const SHORT_ID = 8;

/** A session id, as every view that prints one prints it. */
export function shortId(id: string): string {
  return id.slice(0, SHORT_ID);
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** A figure with thousands separators, so six digits can be read at a glance. */
export function figure(value: number): string {
  return value.toLocaleString("en-US");
}

export function padRight(text: string, to: number): string {
  return text + " ".repeat(Math.max(to - width(text), 0));
}

export function padLeft(text: string, to: number): string {
  return " ".repeat(Math.max(to - width(text), 0)) + text;
}

/**
 * A share as a whole percent.
 *
 * Rounded: the shares these views print are counts over counts — paths that
 * survived, out of the paths that were checked — and a tenth of a file is not
 * a thing. It stays here rather than moving into `survival.ts`, its only
 * caller now, so the next view that prints a share rounds it the same way.
 */
export function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

// --- how wide the terminal is --------------------------------------------

/**
 * What a table is allowed to shrink to before it stops trying.
 *
 * Past this the column that carries the meaning — the intent — is down to a
 * few characters, and a table nobody can read is not an improvement on a
 * table that wraps. Below it a view lays out at this width and overflows,
 * which is a narrower overflow than laying out at the full one.
 */
export const MIN_WIDTH = 60;

/** Where `terminalWidth` reads from, injectable so a test need not own a TTY. */
export interface WidthSignals {
  /** Columns the terminal reports. Absent where stdout is not one. */
  columns?: number | undefined;
  isTTY?: boolean;
}

/**
 * How wide the views may lay themselves out, or `undefined` for no limit.
 *
 * The same shape as `colorEnabled`, and the same contract: what a terminal
 * gets adapts to that terminal, and what a pipe gets is fixed. Fixed here
 * means *unconstrained* — a pipe, a file and a CI log have no width, and the
 * widest render is the one carrying the most intent. A render whose columns
 * depended on the `process.stdout.columns` of whoever happened to run it
 * would make the bytes in a bug report a fact about their terminal rather
 * than about the tool, which is the thing the pinned colourless render exists
 * to prevent.
 *
 * Clamped at `MIN_WIDTH` rather than honoured all the way down. A terminal
 * forty columns wide cannot hold this tool's tables whatever is done to them,
 * and the arithmetic that fits a column into what is left goes strange when
 * what is left is negative.
 */
export function terminalWidth(signals: WidthSignals = {}): number | undefined {
  const isTTY = signals.isTTY ?? process.stdout.isTTY === true;
  const columns = signals.columns ?? process.stdout.columns;
  if (!isTTY || columns === undefined || !Number.isFinite(columns)) {
    return undefined;
  }
  return Math.max(MIN_WIDTH, Math.trunc(columns));
}

/**
 * Fits a flexible column into what the other columns leave, between a floor
 * and the width it would take if nothing were competing for the room.
 *
 * One function because more than one view has a single column that can give:
 * the week table's intent, and anything after it that grows one. Where there
 * is no limit — a pipe — the column takes its natural width and the view is
 * exactly what it was before any of this existed.
 */
export function fitColumn(
  natural: number,
  floor: number,
  fixed: number,
  limit: number | undefined,
): number {
  if (limit === undefined) {
    return natural;
  }
  return Math.max(floor, Math.min(natural, limit - fixed));
}

/**
 * Greedy wrap on spaces, words kept whole.
 *
 * A NUL in the text joins the words either side of it into one unbreakable
 * token — how a caller says "this is something the reader is meant to type",
 * so a command does not arrive as two halves to be reassembled by hand. The
 * NUL never reaches the output; it is replaced by the space it stood for.
 *
 * `undefined` is no limit, the same as everywhere else here: the text comes
 * back as the one line it was handed in as.
 */
export function wrap(text: string, limit: number | undefined): string[] {
  if (limit === undefined) {
    return [text];
  }
  const atomic = "\u0000";
  const lines: string[] = [];
  let line = "";
  for (const token of text.split(" ")) {
    const word = token.replaceAll(atomic, " ");
    if (line === "") {
      line = word;
    } else if (width(line) + 1 + width(word) <= limit) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== "") {
    lines.push(line);
  }
  return lines;
}

/**
 * A note under a table: indented, dim, and wrapped to the room there is.
 *
 * One function rather than a `${INDENT}${text}` at every call site, because
 * the notes are the part of a view that runs long — they are sentences, not
 * cells, and a sentence has no column to be measured against. Every line of a
 * wrapped note carries the same indent, so the note reads as one block rather
 * than as a first line with an orphan under it.
 */
export function note(text: string, ink: (text: string) => string, limit?: number): string[] {
  const room = limit === undefined ? undefined : Math.max(MIN_WIDTH, limit) - INDENT.length;
  return wrap(text, room).map((line) => ink(`${INDENT}${line}`));
}

/** One run of a sentence, and the ink it carries. */
export interface Segment {
  text: string;
  /** Absent leaves the run in the terminal's own colour. */
  ink?: (text: string) => string;
}

/** Collapses every run of whitespace to one space, so a sentence is a sentence. */
export function flatten(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/**
 * A sentence built from inked runs, wrapped to the room there is.
 *
 * The brief views quote somebody's own words inside a sentence of ours, and
 * those words can run to paragraphs — a prompt the editor hook captured is
 * whatever was typed at the agent, up to `MAX_INTENT`. Printed straight that
 * is one line hundreds of columns wide, which the terminal wraps at an
 * arbitrary point with no indent, and the three sentences `show` promises
 * arrive as a wall.
 *
 * Wrapped rather than cut. A declaration is the promise the diff is held to,
 * and a view that quietly dropped the second half of it would be hiding the
 * measurement's own yardstick; the terminal is short of columns, not of lines.
 * `render/pr.ts` shortens a *captured* prompt for its summary line, and keeps
 * the whole of it in the block underneath — the same principle, spent
 * differently because a pull request body has a fold and a terminal does not.
 *
 * The ink is applied per line and per run, after the wrap, so an escape code
 * never counts toward a width and no line ends inside one. A run is inked in
 * as many pieces as it has lines, which is what `picocolors` does anyway.
 */
export function wrapSegments(
  segments: readonly Segment[],
  limit: number | undefined,
  indent: string = INDENT,
): string[] {
  const chars = [...segments.map((segment) => segment.text).join("")];
  // Where each run starts and ends, in code points, so a run boundary inside a
  // word — the quote in front of an intent — still inks only its own half.
  const runs: { from: number; to: number; ink?: (text: string) => string }[] = [];
  let at = 0;
  for (const segment of segments) {
    const to = at + [...segment.text].length;
    if (segment.ink !== undefined) {
      runs.push({ from: at, to, ink: segment.ink });
    }
    at = to;
  }

  const room = limit === undefined ? Infinity : Math.max(MIN_WIDTH, limit) - [...indent].length;
  return lineSpans(chars, room).map(([from, to]) => indent + inkSpan(chars, from, to, runs));
}

/**
 * The [from, to) of each wrapped line: greedy fill, words kept whole.
 *
 * Offsets rather than strings, because the caller has to know which run of the
 * original each line came from in order to ink it. A word longer than the room
 * takes a line to itself and overflows — a path or a URL cut in half is worse
 * than one that runs past the edge, since the reader cannot copy it.
 */
function lineSpans(chars: readonly string[], room: number): [number, number][] {
  const words: [number, number][] = [];
  let at = 0;
  while (at < chars.length) {
    if (chars[at] === " ") {
      at += 1;
      continue;
    }
    const from = at;
    while (at < chars.length && chars[at] !== " ") {
      at += 1;
    }
    words.push([from, at]);
  }
  if (words.length === 0) {
    return [[0, chars.length]];
  }

  const spans: [number, number][] = [];
  let [start, finish] = words[0] as [number, number];
  for (const [from, to] of words.slice(1)) {
    if (to - start <= room) {
      finish = to;
      continue;
    }
    spans.push([start, finish]);
    start = from;
    finish = to;
  }
  spans.push([start, finish]);
  return spans;
}

/** One line's characters, with each inked run inside it wrapped in its own ink. */
function inkSpan(
  chars: readonly string[],
  from: number,
  to: number,
  runs: readonly { from: number; to: number; ink?: (text: string) => string }[],
): string {
  let line = "";
  let at = from;
  for (const run of runs) {
    const start = Math.max(run.from, from);
    const end = Math.min(run.to, to);
    if (start >= end) {
      continue;
    }
    line += chars.slice(at, start).join("");
    line += (run.ink as (text: string) => string)(chars.slice(start, end).join(""));
    at = end;
  }
  return line + chars.slice(at, to).join("");
}
