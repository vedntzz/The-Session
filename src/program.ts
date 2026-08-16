import { Command } from "commander";
import {
  formatHook,
  installHook,
  uninstallHook,
  type HookOptions,
} from "./commands/hook.js";
import { showSession } from "./commands/show.js";
import { formatStarted, startSession } from "./commands/start.js";
import { formatStopped, stopIfOpen, stopSession, type StopOptions } from "./commands/stop.js";
import {
  DEFAULT_DAYS,
  openInBrowser,
  parseDays,
  weekSessions,
  writeWeekPage,
  type WeekOptions,
} from "./commands/week.js";
import { renderWeek } from "./render/html.js";
import { formatSession, formatWeek } from "./render/terminal.js";

/** Everything the command tree can be pointed somewhere else with. */
export type ProgramOptions = StopOptions & WeekOptions & HookOptions;

/**
 * Builds the `session` command tree. Kept separate from the executable entry
 * point so tests can drive it without spawning a process; `options` is the
 * seam that lets them point the store somewhere temporary.
 */
export function buildProgram(options: ProgramOptions = {}): Command {
  const program = new Command();

  program
    .name("session")
    .description("Record what an AI coding session declared, what it changed, and what it cost")
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
    .option("--if-open", "do nothing when no session is open, instead of failing")
    .action(async (flags: { ifOpen?: boolean }) => {
      const session = flags.ifOpen ? await stopIfOpen(options) : await stopSession(options);
      if (!session) {
        return; // nothing was open, and --if-open says that is fine
      }
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
    .option("--open", "write the week as an HTML page and open it")
    .action(async (flags: { days?: string; open?: boolean }) => {
      const days = parseDays(flags.days);
      const sessions = await weekSessions(days, options);

      if (!flags.open) {
        for (const line of formatWeek(sessions, days)) {
          console.log(line);
        }
        return;
      }

      // The path is printed before the browser is asked for, so a desktop that
      // cannot open it still leaves the developer holding the page.
      const file = await writeWeekPage(renderWeek(sessions, days), options);
      console.log(`  wrote    ${file}`);
      await openInBrowser(file, options);
    });

  const hook = program.command("hook").description("Manage the editor hook that closes sessions");

  hook
    .command("install")
    .description("Register a Claude Code SessionEnd hook that closes an open session")
    .option("--uninstall", "take the hook back out instead")
    .action(async (flags: { uninstall?: boolean }) => {
      const result = flags.uninstall ? await uninstallHook(options) : await installHook(options);
      for (const line of formatHook(result)) {
        console.log(line);
      }
    });

  return program;
}
