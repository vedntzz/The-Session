// `session` with no arguments.
import type { Command } from "commander";
import { homeState } from "../commands/home.js";
import { loadRates } from "../pricing.js";
import type { Palette } from "../render/palette.js";
import { formatHome, terminalWidth } from "../render/terminal.js";
import { START_MIN_WIDTH } from "../render/terminal/start-frame.js";
import { storeHome } from "../store.js";
import { unknownCommand } from "./help.js";
import type { ProgramOptions } from "./options.js";
import { printLines } from "./print.js";

/**
 * The bare screen. Commander would print the help here, which is a list of
 * everything this tool can do — the right answer to "what is this" and the
 * wrong one to "where am I". See `formatHome`.
 */
export function registerHome(program: Command, options: ProgramOptions, palette: Palette): void {
  program
    .argument("[command]", "a command to run; with none, where this repo stands")
    .argument("[rest...]")
    .action((name: string | undefined) => renderHome(name, program, options, palette));
}

/** The state screen reads live facts without opening a workspace or sweeping records. */
async function renderHome(name: string | undefined, program: Command, options: ProgramOptions, palette: Palette): Promise<void> {
  if (name !== undefined) throw new Error(unknownCommand(name, program));
  const view = { rates: await loadRates(storeHome(options)), width: terminalWidth(options.appTerminal?.output, START_MIN_WIDTH) };
  printLines(formatHome(await homeState(options), palette, view));
}
