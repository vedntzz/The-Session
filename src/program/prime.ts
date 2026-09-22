import type { Command } from "commander";
import { debtReport } from "../commands/debt.js";
import { debtHere, primeFor, startPrimed } from "../commands/prime.js";
import { formatStarted } from "../commands/start.js";
import { loadRates } from "../pricing.js";
import type { Palette } from "../render/palette.js";
import { formatPrime, formatPrimeDetails } from "../render/prime.js";
import { requireReviewTerminal, startReviewed } from "../commands/review.js";
import { formatDebt, terminalWidth } from "../render/terminal.js";
import { repoIdentity, storeHome } from "../store.js";
import type { ProgramOptions } from "./options.js";
import { printLines } from "./print.js";

type PrimeFlags = { seed?: string[]; start?: boolean; scope?: string[]; debt?: boolean; review?: boolean };

export function registerPrime(program: Command, options: ProgramOptions, palette: Palette): void {
  program.command("prime")
    .description("Suggest specific scope paths from previous planning misses, and show what keeps drifting")
    .argument("[intent]", "what you are setting out to do")
    .option("--seed <paths...>", "repo-relative tracked paths to start from")
    .option("--start", "accept this run's proposal and start a primed session")
    .option("--review", "with --start: review and edit an agreement before accepting (interactive)")
    .option("--scope <paths...>", "with --start: replace the suggested scope")
    .option("--debt", "on its own: files that keep drifting outside scope, every repo on this machine")
    .action(async (intent: string | undefined, flags: PrimeFlags) => {
      if (flags.debt) {
        if (intent !== undefined || flags.seed || flags.start || flags.scope || flags.review) {
          throw new Error("--debt takes no intent and no other flag. Run session prime --debt on its own.");
        }
        await emitDebt(options, palette);
        return;
      }
      if (intent === undefined) {
        throw new Error('No intent given. Run session prime "<what you are setting out to do>", or session prime --debt.');
      }
      if (flags.scope && !flags.start) {
        throw new Error("--scope requires --start. Use --seed to guide a preview.");
      }
      if (flags.review) {
        if (!flags.start) throw new Error("--review requires --start. Run session prime with --start --review to review before accepting.");
        requireReviewTerminal(options.reviewTerminal ?? { input: process.stdin, output: process.stdout });
      }
      const proposal = await primeFor({ intent, seeds: flags.seed }, options);
      if (flags.review) {
        printLines(formatPrimeDetails(proposal, await debtHere(options)));
        const session = await startReviewed(intent, { ...options, palette, proposal, scope: flags.scope });
        printLines(session ? formatStarted(session) : ["  Cancelled. No session started."]);
      } else if (flags.start) {
        printLines(formatStarted(await startPrimed(proposal, flags.scope, options)));
      } else {
        printLines(formatPrime(proposal, await debtHere(options)));
      }
    });
}

/**
 * The files work keeps landing in that nobody ever plans for, every repo on
 * the machine — the pattern takes months to show up, and it is not a question
 * anybody wants to ask once per checkout. See `commands/debt.ts`.
 */
async function emitDebt(options: ProgramOptions, palette: Palette): Promise<void> {
  const rates = await loadRates(storeHome(options));
  // Which repo the reader is standing in, so it can be printed first — see
  // `hereFirst`.
  const here = await repoIdentity(options.cwd ?? process.cwd());
  printLines(formatDebt(await debtReport(rates, options), palette, { here, limit: terminalWidth() }));
}
