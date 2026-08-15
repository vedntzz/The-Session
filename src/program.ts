import { Command } from "commander";
import { showSession } from "./commands/show.js";
import { formatStarted, startSession } from "./commands/start.js";
import { formatStopped, stopSession, type StopOptions } from "./commands/stop.js";
import { DEFAULT_DAYS, parseDays, weekSessions } from "./commands/week.js";
import { formatSession, formatWeek } from "./render/terminal.js";

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
    .description("Show the last closed session")
    .argument("[id]", "a session id, or an unambiguous prefix of one")
    .action(async (id?: string) => {
      const session = await showSession(id, options);
      for (const line of formatSession(session)) {
        console.log(line);
      }
    });

  program
    .command("week")
    .description("Summarize recent sessions, one row each")
    .option("--days <n>", "how many days back to look", String(DEFAULT_DAYS))
    .action(async (flags: { days?: string }) => {
      const days = parseDays(flags.days);
      for (const line of formatWeek(await weekSessions(days, options), days)) {
        console.log(line);
      }
    });

  return program;
}
