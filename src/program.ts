import { Command } from "commander";
import { formatStarted, startSession } from "./commands/start.js";
import { formatStopped, stopSession, type StopOptions } from "./commands/stop.js";

const NOT_IMPLEMENTED = "not implemented";

/**
 * Builds the `session` command tree. Kept separate from the executable entry
 * point so tests can drive it without spawning a process; `options` is the
 * seam that lets them point the store somewhere temporary.
 */
export function buildProgram(options: StopOptions = {}): Command {
  const program = new Command();

  program
    .name("session")
    .description("Track working sessions from the command line")
    .version("0.1.0");

  program
    .command("start")
    .description("Begin a new session")
    .argument("<intent>", "what you are setting out to do")
    .option("--scope <paths...>", "paths you expect to change")
    .action(async (intent: string, flags: { scope?: string[] }) => {
      const session = await startSession(intent, { ...options, scope: flags.scope });
      for (const line of formatStarted(session)) {
        console.log(line);
      }
    });

  program
    .command("stop")
    .description("End the active session")
    .action(async () => {
      const session = await stopSession(options);
      for (const line of formatStopped(session)) {
        console.log(line);
      }
    });

  program
    .command("show")
    .description("Show the active session")
    .action(() => {
      console.log(NOT_IMPLEMENTED);
    });

  program
    .command("week")
    .description("Summarize the current week")
    .action(() => {
      console.log(NOT_IMPLEMENTED);
    });

  return program;
}
