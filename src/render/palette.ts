import pc from "picocolors";

/**
 * What the terminal views are allowed to say with colour.
 *
 * The roles are named for what a thing *is*, never for the ink it gets. A
 * renderer asks for `drift` or `merged`; it never asks for red or green. Two
 * consequences, and they are why this file exists:
 *
 * - Every decision about ink is in one place. `terminal.ts` cannot quietly
 *   grow a fourth shade of dim, and what the tool emphasises can be read off
 *   this file without reading the layout code.
 * - Roles that share ink today stay separate anyway. `path` and `meta` are
 *   both dim, and they are still two roles: a declared path and a column
 *   label are different things, and the day one of them should stop being dim
 *   is a one-line change here rather than an audit of every call site.
 *
 * **Only the 16 basic ANSI colours.** No 256-colour codes, no truecolor, no
 * hex. The hues belong to whoever configured the terminal: `red` is whatever
 * red they chose, and it will be legible on their background because they
 * picked it. A hard-coded `#c33` is a guess about a background this tool
 * cannot see, and it is wrong on half of them. That also keeps every line
 * readable over ssh, in `script` output, and on a console that has eight
 * colours and no more.
 *
 * Emphasis is carried by attributes — bold, dim, strikethrough — rather than
 * by more colours, for the same reason: they compose with any theme.
 */
export interface Palette {
  /** What the session set out to do, in the developer's own words. */
  intent(text: string): string;
  /** A path that went somewhere it was never declared to go. */
  drift(text: string): string;
  /** Money spent on turns that changed no files. */
  waste(text: string): string;
  /** A path that went where it was declared to go, and the declaration itself. */
  path(text: string): string;
  /** Labels, times, counts in the gutter — everything that frames a figure. */
  meta(text: string): string;
  /** Work that shipped. */
  merged(text: string): string;
  /** Work that was thrown away. It still happened, and it still cost money. */
  abandoned(text: string): string;
}

/** picocolors with its escapes either on or off — the one source of ink here. */
type Ink = ReturnType<typeof pc.createColors>;

/**
 * The same palette either way.
 *
 * Colourless output is this construction with the ink turned off, not a second
 * hand-written table of identity functions: built the other way, the two could
 * come to disagree about which text a role even wraps, and the plain rendering
 * — the one that goes into pipes, files and everyone's CI logs — is the one
 * that must never change by accident.
 */
function paletteFrom(ink: Ink): Palette {
  return {
    // Bold, not a colour: the intent is the line you look for first, and it
    // should stand out in every theme rather than in the ones where some
    // chosen hue happens to be loud.
    intent: (text) => ink.bold(text),
    drift: (text) => ink.red(text),
    waste: (text) => ink.red(text),
    path: (text) => ink.dim(text),
    meta: (text) => ink.dim(text),
    merged: (text) => ink.green(text),
    // Struck through so the eye writes the row off, dimmed so it stops
    // competing with the rows that are still live — but still printed. Hiding
    // it would flatter the total.
    abandoned: (text) => ink.dim(ink.strikethrough(text)),
  };
}

/** No colour at all: what a pipe, a file and a CI log see. */
export const plainPalette: Palette = paletteFrom(pc.createColors(false));

/** Colour unconditionally. Use `paletteFor`, which decides whether to. */
export const ansiPalette: Palette = paletteFrom(pc.createColors(true));

/** What the decision to emit colour is made from. Both default to this process. */
export interface ColorSignals {
  env?: NodeJS.ProcessEnv;
  /** Whether stdout is a terminal. */
  isTTY?: boolean;
}

/**
 * Whether to emit escapes at all, in the order the answers outrank each other.
 *
 * 1. `FORCE_COLOR` wins outright, either way. It is the explicit "I know where
 *    this is going, give me colour anyway" — a pager that renders escapes, a
 *    CI job that colours its own logs — and an override nothing can beat is
 *    the only kind worth having. `FORCE_COLOR=0` forces the other way.
 * 2. `NO_COLOR`, set to anything non-empty, turns colour off. That is the
 *    whole of the convention at no-color.org, and it is honoured for every
 *    stream including a terminal.
 * 3. Otherwise: colour only into a TTY. Anything else is being read by a
 *    program, or saved, or pasted into a bug report, and escape codes there
 *    are noise at best and corruption at worst.
 *
 * Deliberately not part of it: whether `CI` is set, and what platform this is.
 * picocolors turns colour *on* for those, which is the opposite of what a
 * recorder wants — a CI log is a file somebody reads later.
 */
export function colorEnabled(signals: ColorSignals = {}): boolean {
  const env = signals.env ?? process.env;
  const isTTY = signals.isTTY ?? process.stdout.isTTY === true;

  const forced = env["FORCE_COLOR"];
  if (forced !== undefined) {
    return forced !== "0" && forced.toLowerCase() !== "false";
  }

  const off = env["NO_COLOR"];
  if (off !== undefined && off !== "") {
    return false;
  }

  return isTTY;
}

/** The palette this process should render with. */
export function paletteFor(signals: ColorSignals = {}): Palette {
  return colorEnabled(signals) ? ansiPalette : plainPalette;
}
