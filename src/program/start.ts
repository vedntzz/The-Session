// `session start`.
import type { Command } from "commander";
import { formatStarted, startPassiveSession, startSession } from "../commands/start.js";
import type { ProgramOptions } from "./options.js";
import { printLines } from "./print.js";

export function registerStart(program: Command, options: ProgramOptions): void {
  program
    .command("start")
    .description("Begin a new session")
    .argument("[intent]", "what you are setting out to do")
    .option("--scope <paths...>", "paths you expect to change")
    .option("--passive", "for the editor hook: open an undeclared session, or do nothing")
    .action(async (intent: string | undefined, flags: { scope?: string[]; passive?: boolean }) => {
      // The hook's half of the command, and it prints nothing either way. A
      // SessionStart handler's stdout is fed to the agent as context, so a
      // line here would arrive inside somebody's prompt.
      if (flags.passive) {
        await startPassiveSession(options);
        return;
      }

      if (intent === undefined) {
        throw new Error('No intent given. Run: session start "what you are about to do"');
      }
      printLines(formatStarted(await startSession(intent, { ...options, scope: flags.scope })));
    });
}
