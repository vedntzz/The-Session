import type { Command } from "commander";
import { primeFor, startPrimed } from "../commands/prime.js";
import { formatStarted } from "../commands/start.js";
import { formatPrime } from "../render/prime.js";
import type { ProgramOptions } from "./options.js";
import { printLines } from "./print.js";

export function registerPrime(program: Command, options: ProgramOptions): void {
  program.command("prime")
    .description("Suggest specific scope paths from previous planning misses")
    .argument("<intent>", "what you are setting out to do")
    .option("--seed <paths...>", "repo-relative tracked paths to start from")
    .option("--start", "accept this run's proposal and start a primed session")
    .option("--scope <paths...>", "with --start: replace the suggested scope")
    .action(async (intent: string, flags: { seed?: string[]; start?: boolean; scope?: string[] }) => {
      if (flags.scope && !flags.start) {
        throw new Error("--scope requires --start. Use --seed to guide a preview.");
      }
      const proposal = await primeFor({ intent, seeds: flags.seed }, options);
      if (flags.start) {
        printLines(formatStarted(await startPrimed(proposal, flags.scope, options)));
      } else {
        printLines(formatPrime(proposal));
      }
    });
}
