import { Command } from "commander";

const NOT_IMPLEMENTED = "not implemented";

/**
 * Builds the `session` command tree. Kept separate from the executable entry
 * point so tests can drive it without spawning a process.
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name("session")
    .description("Track working sessions from the command line")
    .version("0.1.0");

  program
    .command("start")
    .description("Begin a new session")
    .action(() => {
      console.log(NOT_IMPLEMENTED);
    });

  program
    .command("stop")
    .description("End the active session")
    .action(() => {
      console.log(NOT_IMPLEMENTED);
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
