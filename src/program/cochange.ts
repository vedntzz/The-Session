// `session cochange`.
import type { Command } from "commander";
import { cochangeReport } from "../commands/cochange.js";
import type { Palette } from "../render/palette.js";
import { formatCochange } from "../render/terminal.js";
import type { ProgramOptions } from "./options.js";
import { printLines } from "./print.js";

/**
 * `session cochange` — the files that keep changing together.
 *
 * Reads every repository's log rather than this one's, for the reasons under
 * `commands/cochange.ts`. No rates are loaded: there is no money in this view,
 * because there is no way to divide a session's cost between the files it
 * touched and less still between a pair of them.
 *
 * `--current` drops the pairs whose files are no longer at the branch tip. It
 * is a flag rather than the default because both questions are real: what this
 * repo couples now, and what it has been coupling. Marking is what the report
 * does when it is not asked — see `withTips`.
 */
export function registerCochange(
  program: Command,
  options: ProgramOptions,
  palette: Palette,
): void {
  program
    .command("cochange")
    .description("Files that keep changing together, per repo")
    .option("--current", "only pairs whose files are both still at the branch tip")
    .action(async (flags: { current?: boolean }) => {
      printLines(formatCochange(await cochangeReport(options, flags.current === true), palette));
    });
}
