// `session stop`.
import type { Command } from "commander";
import { formatStopped, stopIfOpen, stopSession } from "../commands/stop.js";
import { sweepFirst } from "../commands/sweep.js";
import { loadRates } from "../pricing.js";
import { storeHome } from "../store.js";
import type { ProgramOptions } from "./options.js";
import { printLines } from "./print.js";

export function registerStop(program: Command, options: ProgramOptions): void {
  program
    .command("stop")
    .description("End the active session")
    .option("--if-open", "do nothing when no session is open, instead of failing")
    .action(async (flags: { ifOpen?: boolean }) => {
      const session = flags.ifOpen ? await stopIfOpen(options) : await stopSession(options);
      if (session) {
        printLines(formatStopped(session, await loadRates(storeHome(options))));
      }
      // Printed before the sweep runs, not after it: the developer asked for a
      // stop and should have it the moment it is written, rather than waiting
      // on work they did not ask for.

      // And swept only once that record is safely written. This is what the
      // `SessionEnd` hook runs, and a handler cancelled on a timeout would
      // otherwise be the one failure that loses a record rather than delaying
      // it. The sweep is what gets cut short instead, and it comes round again.
      //
      // It runs even when nothing was open: the hook fires at the end of every
      // editor session, which is exactly the moment worth catching a repo whose
      // sweep has come due.
      printLines((await sweepFirst(options)).notice);
    });
}
