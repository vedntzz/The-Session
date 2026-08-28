// `session` with no arguments.
import type { Command } from "commander";
import { homeState } from "../commands/home.js";
import { sweepFirst } from "../commands/sweep.js";
import { loadRates } from "../pricing.js";
import type { Palette } from "../render/palette.js";
import { formatHome } from "../render/terminal.js";
import { storeHome } from "../store.js";
import type { ProgramOptions } from "./options.js";
import { printLines } from "./print.js";

/**
 * The bare screen. Commander would print the help here, which is a list of
 * everything this tool can do — the right answer to "what is this" and the
 * wrong one to "where am I". See `formatHome`.
 */
export function registerHome(program: Command, options: ProgramOptions, palette: Palette): void {
  program.action(async () => {
    // The bare screen is the most-typed command there is, which makes it the
    // best place to catch a repo whose sweep has come due. Silent unless
    // something was written; the facts it gathered are the ones the screen
    // then reads its outcome from, so a sweep day costs no extra git.
    const { notice, facts } = await sweepFirst(options);
    const view = { rates: await loadRates(storeHome(options)) };
    printLines([...notice, ...formatHome(await homeState(options, facts), palette, view)]);
  });
}
