// `session estimate`.
import type { Command } from "commander";
import { parseClass } from "../classify.js";
import { estimateFor, formatEstimate, parseSince } from "../commands/estimate.js";
import { loadRates } from "../pricing.js";
import { storeHome } from "../store.js";
import type { ProgramOptions } from "./options.js";
import { printLines } from "./print.js";

export function registerEstimate(program: Command, options: ProgramOptions): void {
  program
    .command("estimate")
    .description("What sessions like this one have cost, from the ones already recorded")
    .argument("<intent>", "what you are setting out to do")
    .option("--scope <paths...>", "paths you expect to change — a better signal than the words")
    .option("--class <name>", "the class to estimate from, when the words and paths get it wrong")
    .option("--since <when>", "only sessions since a date (2026-05-20) or a span of days (30d)")
    .action(
      async (intent: string, flags: { scope?: string[]; class?: string; since?: string }) => {
        const request = {
          intent,
          scope: flags.scope,
          class: flags.class === undefined ? undefined : parseClass(flags.class),
          since: flags.since === undefined ? undefined : parseSince(flags.since),
        };
        const rates = await loadRates(storeHome(options));
        printLines(formatEstimate(await estimateFor(request, rates, options)));
      },
    );
}
