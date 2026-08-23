// `session show`.
import type { Command } from "commander";
import { showSession } from "../commands/show.js";
import { loadRates } from "../pricing.js";
import type { Palette } from "../render/palette.js";
import { formatBrief, formatSession } from "../render/terminal.js";
import { storeHome } from "../store.js";
import type { ProgramOptions } from "./options.js";
import { printLines } from "./print.js";

export function registerShow(program: Command, options: ProgramOptions, palette: Palette): void {
  program
    .command("show")
    .description("Show the last closed session")
    .argument("[id]", "a session id, or an unambiguous prefix of one")
    .option("--full", "the labelled layout: every path, every counter, the outcome")
    .option("--tokens", "show the raw token counters as well as the cost")
    .action(async (id: string | undefined, flags: { full?: boolean; tokens?: boolean }) => {
      const session = await showSession(id, options);
      const view = { rates: await loadRates(storeHome(options)), tokens: flags.tokens };
      // `--tokens` asks for counters the brief view does not have a place for,
      // so it implies `--full` rather than being quietly ignored.
      const full = flags.full === true || flags.tokens === true;
      const render = full ? formatSession : formatBrief;
      printLines(render(session, palette, view));
    });
}
