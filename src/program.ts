import { Command } from "commander";
import { parseClass } from "./classify.js";
import {
  formatHook,
  installHook,
  uninstallHook,
  type HookOptions,
} from "./commands/hook.js";
import { formatConfig, setConfig, showConfig } from "./commands/config.js";
import { formatKey, showKey } from "./commands/key.js";
import { formatMark, formatSettle, markSession, settleSessions } from "./commands/settle.js";
import { showSession } from "./commands/show.js";
import { formatStarted, startSession } from "./commands/start.js";
import { formatStopped, stopIfOpen, stopSession, type StopOptions } from "./commands/stop.js";
import { formatVerify, verifyFailed, verifyLog } from "./commands/verify.js";
import {
  DEFAULT_DAYS,
  openInBrowser,
  parseDays,
  weekSessions,
  writeWeekPage,
  type SessionFilter,
  type WeekOptions,
} from "./commands/week.js";
import { parseOutcome } from "./outcome.js";
import { loadRates } from "./pricing.js";
import { renderWeek } from "./render/html.js";
import { formatSession, formatWeek, terminalPalette } from "./render/terminal.js";
import { storeHome } from "./store.js";

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
    .option("--tokens", "show the raw token counters as well as the cost")
    .action(async (id: string | undefined, flags: { tokens?: boolean }) => {
      const session = await showSession(id, options);
      const view = { rates: await loadRates(storeHome(options)), tokens: flags.tokens };
      for (const line of formatSession(session, terminalPalette, view)) {
        console.log(line);
      }
    });

  program
    .command("week")
    .description("Summarize recent sessions, one row each")
    .option("--days <n>", "how many days back to look", String(DEFAULT_DAYS))
    .option("--client <name>", "only sessions recorded for this client")
    .option("--project <name>", "only sessions recorded for this project")
    .option("--outcome <state>", "only sessions that are open, merged, or abandoned")
    // Optional value, because the column and the filter are the same question
    // asked twice: `--class` shows what each session was working on, and
    // `--class ui` keeps the ones that were working on the same thing.
    .option("--class [name]", "show the class column; with a name, only that class")
    .option("--tokens", "show the raw token counts as well as the cost")
    .option("--open", "write the week as an HTML page and open it")
    .action(
      async (flags: {
        days?: string;
        client?: string;
        project?: string;
        outcome?: string;
        class?: string | boolean;
        tokens?: boolean;
        open?: boolean;
      }) => {
        const days = parseDays(flags.days);
        const filter: SessionFilter = {
          client: flags.client,
          project: flags.project,
          outcome: flags.outcome === undefined ? undefined : parseOutcome(flags.outcome),
          // A bare `--class` arrives as true: it asked for the column, not for
          // a class, so nothing is filtered on.
          class: typeof flags.class === "string" ? parseClass(flags.class) : undefined,
        };
        const sessions = await weekSessions(days, options, filter);
        const view = {
          rates: await loadRates(storeHome(options)),
          tokens: flags.tokens,
          classes: flags.class !== undefined,
        };

        if (!flags.open) {
          for (const line of formatWeek(sessions, days, terminalPalette, filter, view)) {
            console.log(line);
          }
          return;
        }

        // The path is printed before the browser is asked for, so a desktop
        // that cannot open it still leaves the developer holding the page.
        const file = await writeWeekPage(renderWeek(sessions, days, filter, view), options);
        console.log(`  wrote    ${file}`);
        await openInBrowser(file, options);
      },
    );

  program
    .command("verify")
    .description("Check a log's hash chain and signatures")
    .option("--log <path>", "a log file to check instead of this repo's own")
    .option("--key <path>", "the public key to check against: a key file, or the PEM itself")
    .action(async (flags: { log?: string; key?: string }) => {
      const result = await verifyLog({ ...options, log: flags.log, key: flags.key });
      for (const line of formatVerify(result)) {
        console.log(line);
      }
      if (verifyFailed(result)) {
        // A broken log is a finding, not a crash: the report above is the
        // point. The exit code is there so a script can gate on it.
        process.exitCode = 1;
      }
    });

  program
    .command("settle")
    .description("Record where every finished session ended up, as a signed observation")
    .action(async () => {
      for (const line of formatSettle(await settleSessions(options))) {
        console.log(line);
      }
    });

  program
    .command("mark")
    .description("Say where a session ended up, overriding what the repo suggests")
    .argument("<id>", "a session id, or an unambiguous prefix of one")
    .argument("<outcome>", "merged or abandoned")
    .action(async (id: string, outcome: string) => {
      const settled = await markSession(id, parseOutcome(outcome), options);
      for (const line of formatMark(settled)) {
        console.log(line);
      }
    });

  const config = program
    .command("config")
    .description("Attribution for this repo, in .session.json — checked in, shared by the team");

  config
    .command("set")
    .description("Set an attribution field, recorded by every session from now on")
    .argument("<key>", "client, project, sow, or billingCode")
    .argument("<value>", "what to record; an empty value clears the field")
    .action(async (key: string, value: string) => {
      for (const line of formatConfig(await setConfig(key, value, options.cwd))) {
        console.log(line);
      }
    });

  config
    .command("show")
    .description("Print the attribution this repo declares")
    .action(async () => {
      for (const line of formatConfig(await showConfig(options.cwd))) {
        console.log(line);
      }
    });

  const key = program.command("key").description("The signing key this machine writes with");

  key
    .command("show")
    .description("Print the public key, for anyone who wants to check the log")
    .action(async () => {
      const keypair = await showKey(options);
      for (const line of formatKey(keypair, options)) {
        console.log(line);
      }
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
