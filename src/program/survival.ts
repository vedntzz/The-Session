// `session survival`.
import type { Command } from "commander";
import { checkSurvival, survivalReport } from "../commands/survival.js";
import type { Palette } from "../render/palette.js";
import { formatCheck, formatSurvival } from "../render/terminal.js";
import type { ProgramOptions } from "./options.js";
import { printLines } from "./print.js";

/**
 * `session survival` — how much of what merged is still there.
 *
 * Reads by default and writes only with `--check`, which is the one part that
 * has to happen on a schedule: the branch says what it holds today, and no
 * question about the fourteenth day after a merge can be answered by looking
 * on the two hundredth. The report tells you when a check is owed.
 */
export function registerSurvival(
  program: Command,
  options: ProgramOptions,
  palette: Palette,
): void {
  program
    .command("survival")
    .description("How much of what merged is still there, at 14 and 30 days")
    .option("--check", "run the checks that are due and record them")
    .action(async (flags: { check?: boolean }) => {
      if (flags.check) {
        printLines(formatCheck(await checkSurvival(options), palette));
        return;
      }
      printLines(formatSurvival(await survivalReport(options), palette));
    });
}
