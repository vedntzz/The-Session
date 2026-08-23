// `session stop`.
import type { Command } from "commander";
import { formatStopped, stopIfOpen, stopSession } from "../commands/stop.js";
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
      if (!session) {
        return; // nothing was open, and --if-open says that is fine
      }
      printLines(formatStopped(session, await loadRates(storeHome(options))));
    });
}
