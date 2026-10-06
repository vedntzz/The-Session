// `session` with no arguments.
import type { Command } from "commander";
import { homeState } from "../commands/home.js";
import { sweepFirst } from "../commands/sweep.js";
import { loadRates } from "../pricing.js";
import type { Palette } from "../render/palette.js";
import { formatHome, terminalWidth } from "../render/terminal.js";
import { storeHome } from "../store.js";
import { unknownCommand } from "./help.js";
import type { ProgramOptions } from "./options.js";
import { printLines } from "./print.js";
import { runWorkspaceUi } from "../commands/app-ui.js";
import { canStartUi } from "../commands/start-ui.js";
import type { HomeAction } from "../render/tui/home.js";
import type { UiScreen } from "../render/tui/navigation.js";
import { safeText } from "../render/tui/text.js";
import { shortId } from "../render/terminal/text.js";

const SECTION_COMMANDS: Record<UiScreen, string> = {
  home: "session", start: "session start", sessions: "session ui", week: "session week", pr: "session pr",
  prime: "session prime --help", debt: "session prime --debt", agreement: "session start --help",
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
    // Declared so a name that matches no subcommand arrives here as what it is
    // rather than as an excess argument to the state screen. Without it
    // commander answers `session wek` with "too many arguments. Expected 0
    // arguments but got 1" — a true statement about the parse, and no help at
    // all to somebody who did not think they were passing an argument.
    .argument("[command]", "a command to run; with none, where this repo stands")
    // Whatever followed it. Taken so `session estimate "x"` is answered about
    // `estimate` rather than refused for having one argument too many.
    .argument("[rest...]")
    .action(async (name: string | undefined) => {
      if (name !== undefined) {
        throw new Error(unknownCommand(name, program));
      }
      const terminal = options.appTerminal ?? { input: process.stdin, output: process.stdout };
      if (canStartUi(terminal)) {
        const action = await runWorkspaceUi(options, palette, terminal);
        if (action) printLines([safeText(`  Open ${action.label} with: ${sectionCommand(action)}`)]);
        return;
      }
    // The bare screen is the most-typed command there is, which makes it the
    // best place to catch a repo whose sweep has come due. Silent unless
    // something was written; the facts it gathered are the ones the screen
    // then reads its outcome from, so a sweep day costs no extra git.
      const { notice, facts } = await sweepFirst(options);
      const view = { rates: await loadRates(storeHome(options)), width: terminalWidth() };
      printLines([...notice, ...formatHome(await homeState(options, facts), palette, view)]);
    });
}
