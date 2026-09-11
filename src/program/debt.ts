// `session debt`.
import type { Command } from "commander";
import { debtReport } from "../commands/debt.js";
import { loadRates } from "../pricing.js";
import type { Palette } from "../render/palette.js";
import { formatDebt, terminalWidth } from "../render/terminal.js";
import { repoIdentity, storeHome } from "../store.js";
import type { ProgramOptions } from "./options.js";
import { printLines } from "./print.js";

/**
 * `session debt` — the files work keeps landing in that nobody ever plans for.
 *
 * The one command that reads every repository's log rather than this one's:
 * the pattern it reports takes months to show up, and it is not a question
 * anybody wants to ask once per checkout. See `commands/debt.ts`.
 */
export function registerDebt(program: Command, options: ProgramOptions, palette: Palette): void {
  program
    .command("debt")
    .description("Files that keep drifting outside the plan and are never declared, per repo")
    .action(async () => {
      const rates = await loadRates(storeHome(options));
      // Which repo the reader is standing in. `debt` reports every one on the
      // machine, and this is the only thing that says which of them is the one
      // they typed the command in — see `hereFirst`.
      const here = await repoIdentity(options.cwd ?? process.cwd());
      printLines(
        formatDebt(await debtReport(rates, options), palette, { here, limit: terminalWidth() }),
      );
    });
}
