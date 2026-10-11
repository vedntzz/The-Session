// `session` with no arguments.
import type { Command } from "commander";
import { homeState } from "../commands/home.js";
import { loadRates } from "../pricing.js";
import type { Palette } from "../render/palette.js";
import { formatHome, terminalWidth } from "../render/terminal.js";
import { storeHome } from "../store.js";
import { unknownCommand } from "./help.js";
import type { ProgramOptions } from "./options.js";
import { printLines } from "./print.js";
import type { HomeAction } from "../render/tui/home.js";
import type { UiScreen } from "../render/tui/navigation.js";
import { shortId } from "../render/terminal/text.js";

const SECTION_COMMANDS: Record<UiScreen, string> = {
  home: "session", start: "session start", sessions: "session ui", week: "session week", pr: "session pr",
  debt: "session prime --debt", agreement: "session start --help",
  outcomes: "session settle --help", survival: "session survival", knowledge: "session knowledge --help",
  scan: "session scan", agents: "session agents", hooks: "session hook --help", peers: "session peers",
  sync: "session help all", verify: "session verify", key: "session key show", attribution: "session config --help", help: "session help all",
};
export function sectionCommand(action: HomeAction): string {
  return action.screen === "sessions" && action.selectedSessionId
    ? `session week '${shortId(action.selectedSessionId).replaceAll("'", "'\\''")}' --full` : SECTION_COMMANDS[action.screen];
}

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
  const view = { rates: await loadRates(storeHome(options)), width: terminalWidth(options.appTerminal?.output) };
  printLines(formatHome(await homeState(options), palette, view));
}
