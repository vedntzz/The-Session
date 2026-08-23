// `session settle` and `session mark`.
import type { Command } from "commander";
import { formatMark, formatSettle, markSession, settleSessions } from "../commands/settle.js";
import { parseOutcome } from "../outcome.js";
import type { ProgramOptions } from "./options.js";
import { printLines } from "./print.js";

export function registerSettle(program: Command, options: ProgramOptions): void {
  program
    .command("settle")
    .description("Record where every finished session ended up, as a signed observation")
    .action(async () => {
      printLines(formatSettle(await settleSessions(options)));
    });

  program
    .command("mark")
    .description("Say where a session ended up, overriding what the repo suggests")
    .argument("<id>", "a session id, or an unambiguous prefix of one")
    .argument("<outcome>", "merged or abandoned")
    .action(async (id: string, outcome: string) => {
      printLines(formatMark(await markSession(id, parseOutcome(outcome), options)));
    });
}
