// `session week`, and the three renderings it can end in.
import type { Command } from "commander";
import { parseClass } from "../classify.js";
import {
  copyToClipboard,
  DEFAULT_DAYS,
  openInBrowser,
  parseDays,
  weekSessions,
  writeWeekPage,
  type SessionFilter,
} from "../commands/week.js";
import { sweepFirst } from "../commands/sweep.js";
import { parseOutcome } from "../outcome.js";
import { loadChecked, loadRates } from "../pricing.js";
import { renderWeek } from "../render/html.js";
import { renderMarkdownWeek } from "../render/markdown.js";
import type { Palette } from "../render/palette.js";
import { formatWeek } from "../render/terminal.js";
import { parseIntentSource, storeHome } from "../store.js";
import type { ProgramOptions } from "./options.js";
import { printLines } from "./print.js";

/** What `session week` accepts, as commander hands it over. */
export type WeekFlags = {
  days?: string;
  client?: string;
  project?: string;
  outcome?: string;
  class?: string | boolean;
  intent?: string;
  tokens?: boolean;
  md?: boolean;
  copy?: boolean;
  open?: boolean;
};

export function registerWeek(program: Command, options: ProgramOptions, palette: Palette): void {
  program
    .command("week")
    .description("Summarize recent sessions, one row each")
    .option("--days <n>", "how many days back to look", String(DEFAULT_DAYS))
    .option("--client <name>", "only sessions recorded for this client")
    .option("--project <name>", "only sessions recorded for this project")
    .option("--outcome <state>", "only sessions that are open, merged, abandoned, or empty")
    // Optional value, because the column and the filter are the same question
    // asked twice: `--class` shows what each session was working on, and
    // `--class ui` keeps the ones that were working on the same thing.
    .option("--class [name]", "show the class column; with a name, only that class")
    .option("--intent <source>", "only sessions whose intent was declared, or captured by the hook")
    .option("--tokens", "show the raw token counts as well as the cost")
    .option("--md", "emit Markdown, for pasting into notes, Slack, Notion or Confluence")
    .option("--copy", "put that Markdown on the clipboard instead of printing it")
    .option("--open", "write the week as an HTML page and open it")
    .action((flags: WeekFlags) => emitWeek(flags, options, palette));
}

/** Reads the filtering flags off `week` into the shape the store filters on. */
export function weekFilterFrom(flags: WeekFlags): SessionFilter {
  return {
    client: flags.client,
    project: flags.project,
    outcome: flags.outcome === undefined ? undefined : parseOutcome(flags.outcome),
    // A bare `--class` arrives as true: it asked for the column, not for a
    // class, so nothing is filtered on.
    class: typeof flags.class === "string" ? parseClass(flags.class) : undefined,
    intent: flags.intent === undefined ? undefined : parseIntentSource(flags.intent),
  };
}

/**
 * Gathers the week once, then hands it to whichever of the three renderings
 * was asked for.
 *
 * Markdown before HTML, and before the table: it is the most specific thing
 * asked for. `--copy` implies it — a terminal table is not what anybody pastes
 * into a page, so a bare `--copy` means the Markdown.
 */
async function emitWeek(
  flags: WeekFlags,
  options: ProgramOptions,
  palette: Palette,
): Promise<void> {
  const days = parseDays(flags.days);
  const filter = weekFilterFrom(flags);
  // Before the week is gathered, so the table shows what was just written, and
  // reusing the facts it asked for — see `sweepFirst`.
  const { notice, facts } = await sweepFirst(options);
  const sessions = await weekSessions(days, options, filter, facts);
  const view = {
    rates: await loadRates(storeHome(options)),
    // What the money under the table is quoted at, and how old that is.
    checked: await loadChecked(),
    tokens: flags.tokens,
    classes: flags.class !== undefined,
  };

  if (flags.md || flags.copy) {
    // No notice here, ever. `session week --md > notes.md` is a document, and
    // a line of ours above the heading would be in the file somebody pastes.
    await emitWeekMarkdown(renderMarkdownWeek(sessions, days, view), sessions.length, flags, options);
    return;
  }
  if (flags.open) {
    printLines(notice);
    await emitWeekPage(renderWeek(sessions, days, filter, view), options);
    return;
  }
  printLines([...notice, ...formatWeek(sessions, days, palette, filter, view)]);
}

/** Puts the Markdown on the clipboard, or on stdout. */
async function emitWeekMarkdown(
  markdown: string,
  count: number,
  flags: WeekFlags,
  options: ProgramOptions,
): Promise<void> {
  if (flags.copy) {
    await copyToClipboard(markdown, options);
    console.log(`  copied   ${count === 1 ? "1 session" : `${count} sessions`} as Markdown`);
    return;
  }
  // One document, printed as one line: `renderMarkdownWeek` returns it whole,
  // and console.log supplies the newline that ends it.
  console.log(markdown);
}

/**
 * Writes the page and asks the desktop to open it. The path is printed before
 * the browser is asked for, so a desktop that cannot open it still leaves the
 * developer holding the page.
 */
export async function emitWeekPage(html: string, options: ProgramOptions): Promise<void> {
  const file = await writeWeekPage(html, options);
  console.log(`  wrote    ${file}`);
  await openInBrowser(file, options);
}
