import { Command, Help } from "commander";
import { parseClass } from "./classify.js";
import {
  formatHook,
  installHook,
  uninstallHook,
  type HookOptions,
} from "./commands/hook.js";
import { formatConfig, setConfig, showConfig } from "./commands/config.js";
import { homeState } from "./commands/home.js";
import { estimateFor, formatEstimate, parseSince } from "./commands/estimate.js";
import { captureFromPrompt, promptFromHook, readHookPayload } from "./commands/intent.js";
import { formatKey, showKey } from "./commands/key.js";
import { formatMark, formatSettle, markSession, settleSessions } from "./commands/settle.js";
import { showSession } from "./commands/show.js";
import { formatStarted, startPassiveSession, startSession } from "./commands/start.js";
import { formatStopped, stopIfOpen, stopSession, type StopOptions } from "./commands/stop.js";
import {
  formatVerify,
  formatVerifyPeers,
  peersFailed,
  verifyFailed,
  verifyLog,
  verifyPeers,
} from "./commands/verify.js";
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
import {
  formatPeers,
  formatPull,
  formatPush,
  listPeers,
  pullPeers,
  pushLog,
} from "./sync.js";
import { paletteFor, type Palette } from "./render/palette.js";
import {
  formatBrief,
  formatCommands,
  formatHome,
  formatSession,
  formatWeek,
  type CommandEntry,
} from "./render/terminal.js";
import { parseIntentSource, storeHome } from "./store.js";

/** Everything the command tree can be pointed somewhere else with. */
export type ProgramOptions = StopOptions &
  WeekOptions &
  HookOptions & {
    /**
     * How the terminal views are inked. Defaults to what this process's stdout
     * and environment call for — colour into a terminal, nothing into a pipe.
     */
    palette?: Palette;
    /**
     * Where a hook payload is read from. Defaults to this process's stdin,
     * which is where Claude Code writes it; the seam is so tests can hand one
     * over without a pipe.
     */
    stdin?: AsyncIterable<Buffer | string>;
  };

/**
 * Reads a flag written out in words: `--passive=false` as well as `--passive`.
 *
 * Commander's own `--no-passive` says the same thing, and both are accepted,
 * but the negated spelling is the one nobody guesses. Anything that is not
 * plainly one or the other is refused rather than read as false, since a
 * typo silently turning capture off is exactly the failure that would go
 * unnoticed until a week of sessions was missing.
 */
export function parseFlag(value: string): boolean {
  const wanted = value.trim().toLowerCase();
  if (["true", "yes", "on", "1"].includes(wanted)) {
    return true;
  }
  if (["false", "no", "off", "0"].includes(wanted)) {
    return false;
  }
  throw new Error(`--passive takes true or false. Got ${value}.`);
}

/**
 * The commands `session --help` lists, beside the bare screen itself.
 *
 * Three. Not because the others are unfinished or deprecated — they all work
 * and are all documented — but because a first reader cannot use fifteen
 * commands and can use these: start a session, look at the week, find the
 * rest. A help screen that lists everything is a help screen nobody finishes
 * reading, and the commands that get lost in it are the ones a newcomer most
 * needs.
 *
 * Discoverability is not sacrificed, it is deferred: `session help all` is on
 * the short list, and the line under it names what is behind it.
 */
const BRIEF_COMMANDS = ["start", "week", "help"];

/**
 * Narrows the top-level help to `BRIEF_COMMANDS` and nothing else.
 *
 * Only the top-level list is touched. `session config --help` and every other
 * subcommand's help go through commander's own rendering, because there is
 * nothing to hide there — a reader who has typed `session config` has already
 * chosen the topic.
 */
function configureHelp(program: Command): void {
  // A row for the bare screen. It is not a subcommand and there is nothing to
  // dispatch to; it is here because it is the shortest thing to type and a
  // list of entry points that leaves out the shortest one hides it.
  const home = new Command("session").description("where this repo stands, and what to run next");

  program.configureHelp({
    visibleCommands(cmd) {
      if (cmd !== program) {
        return Help.prototype.visibleCommands.call(this, cmd);
      }
      // Filtered out of the real tree rather than listed separately, so a
      // command renamed here cannot fall off this list silently.
      return [home, ...program.commands.filter((sub) => BRIEF_COMMANDS.includes(sub.name()))];
    },
    subcommandTerm(cmd) {
      // There is exactly one topic, so the term says it rather than leaving
      // the reader to guess what a `[topic]` might be.
      return cmd.name() === "help" ? "help all" : Help.prototype.subcommandTerm.call(this, cmd);
    },
  });

  program.addHelpText(
    "after",
    "\nEverything else — stop, show, estimate, verify, settle, push, pull, config, key,\n" +
      "hook — still works and is listed under session help all.",
  );
}

/**
 * Every command in the tree, parent and child, as `session help all` prints
 * them.
 *
 * Read off the tree rather than kept in a list beside it. A hand-maintained
 * list is one release away from being wrong, and the whole point of this
 * command is that it is the place where nothing is left out.
 */
function commandEntries(program: Command): CommandEntry[] {
  return program.commands.flatMap((command) => [
    { name: command.name(), description: command.description() },
    ...command.commands.map((sub) => ({
      name: `${command.name()} ${sub.name()}`,
      description: sub.description(),
    })),
  ]);
}

/**
 * Builds the `session` command tree. Kept separate from the executable entry
 * point so tests can drive it without spawning a process; `options` is the
 * seam that lets them point the store somewhere temporary.
 */
export function buildProgram(options: ProgramOptions = {}): Command {
  const program = new Command();
  // Decided once, here, rather than per command: whether stdout is a terminal
  // does not change between two lines of the same run.
  const palette = options.palette ?? paletteFor();

  program
    .name("session")
    .description("Record what an AI coding session declared, what it changed, and what it cost")
    .version("0.3.0");

  // The bare screen. Commander would print the help here, which is a list of
  // everything this tool can do — the right answer to "what is this" and the
  // wrong one to "where am I". See `formatHome`.
  program.action(async () => {
    const view = { rates: await loadRates(storeHome(options)) };
    for (const line of formatHome(await homeState(options), palette, view)) {
      console.log(line);
    }
  });

  // Commander adds its own `help [command]`, which would collide with the one
  // registered at the bottom of this function.
  program.helpCommand(false);
  configureHelp(program);

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
      const session = await startSession(intent, { ...options, scope: flags.scope });
      for (const line of formatStarted(session)) {
        console.log(line);
      }
    });

  program
    .command("intent")
    .description("For the editor hook: record the first prompt as an undeclared session's intent")
    .requiredOption("--from-prompt", "read the Claude Code hook payload on stdin")
    .action(async () => {
      // Nothing is printed and nothing throws. This runs between a developer
      // pressing enter and the agent starting: a UserPromptSubmit handler that
      // exits non-zero blocks the prompt outright, and one that prints is
      // adding text to it. A recorder that can eat a prompt is worse than no
      // recorder.
      try {
        const payload = await readHookPayload(options.stdin ?? process.stdin);
        const prompt = promptFromHook(payload);
        if (prompt !== undefined) {
          await captureFromPrompt(prompt, options);
        }
      } catch {
        // The session keeps whatever it had, which is nothing, and the next
        // prompt tries again.
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
    .option("--full", "the labelled layout: every path, every counter, the outcome")
    .option("--tokens", "show the raw token counters as well as the cost")
    .action(async (id: string | undefined, flags: { full?: boolean; tokens?: boolean }) => {
      const session = await showSession(id, options);
      const view = { rates: await loadRates(storeHome(options)), tokens: flags.tokens };
      // `--tokens` asks for counters the brief view does not have a place for,
      // so it implies `--full` rather than being quietly ignored.
      const full = flags.full === true || flags.tokens === true;
      const render = full ? formatSession : formatBrief;
      for (const line of render(session, palette, view)) {
        console.log(line);
      }
    });

  program
    .command("week")
    .description("Summarize recent sessions, one row each")
    .option("--days <n>", "how many days back to look", String(DEFAULT_DAYS))
    .option("--client <name>", "only sessions recorded for this client")
    .option("--project <name>", "only sessions recorded for this project")
    .option("--outcome <state>", "only sessions that are open, merged, abandoned, or empty")
    // Optional value, because the column and the filter are the same question
    // asked twice: `--class` shows what each session was working on, and
    // `--class ui` keeps the ones that were working on the same thing.
    .option("--class [name]", "show the class column; with a name, only that class")
    .option("--intent <source>", "only sessions whose intent was declared, or captured by the hook")
    .option("--tokens", "show the raw token counts as well as the cost")
    .option("--open", "write the week as an HTML page and open it")
    .action(
      async (flags: {
        days?: string;
        client?: string;
        project?: string;
        outcome?: string;
        class?: string | boolean;
        intent?: string;
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
          intent: flags.intent === undefined ? undefined : parseIntentSource(flags.intent),
        };
        const sessions = await weekSessions(days, options, filter);
        const view = {
          rates: await loadRates(storeHome(options)),
          tokens: flags.tokens,
          classes: flags.class !== undefined,
        };

        if (!flags.open) {
          for (const line of formatWeek(sessions, days, palette, filter, view)) {
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
    .command("estimate")
    .description("What sessions like this one have cost, from the ones already recorded")
    .argument("<intent>", "what you are setting out to do")
    .option("--scope <paths...>", "paths you expect to change — a better signal than the words")
    .option("--class <name>", "the class to estimate from, when the words and paths get it wrong")
    .option("--since <when>", "only sessions since a date (2026-05-20) or a span of days (30d)")
    .action(
      async (intent: string, flags: { scope?: string[]; class?: string; since?: string }) => {
        const request = {
          intent,
          scope: flags.scope,
          class: flags.class === undefined ? undefined : parseClass(flags.class),
          since: flags.since === undefined ? undefined : parseSince(flags.since),
        };
        const rates = await loadRates(storeHome(options));
        for (const line of formatEstimate(await estimateFor(request, rates, options))) {
          console.log(line);
        }
      },
    );

  program
    .command("verify")
    .description("Check a log's hash chain and signatures")
    .option("--log <path>", "a log file to check instead of this repo's own")
    .option("--key <path>", "the public key to check against: a key file, or the PEM itself")
    .option("--peers", "check every chain pulled into this repo, key by key")
    .action(async (flags: { log?: string; key?: string; peers?: boolean }) => {
      // A broken log, an empty one, and a pulled chain that does not add up are
      // findings, not crashes: the report is the point. The exit code is there
      // so a script can gate on it.
      if (flags.peers) {
        if (flags.log !== undefined) {
          throw new Error(
            "--peers checks the chains pulled into this repo; --log names one file. " +
              "Pass one or the other.",
          );
        }
        const result = await verifyPeers({ ...options, key: flags.key });
        for (const line of formatVerifyPeers(result)) {
          console.log(line);
        }
        if (peersFailed(result)) {
          process.exitCode = 1;
        }
        return;
      }

      const result = await verifyLog({ ...options, log: flags.log, key: flags.key });
      for (const line of formatVerify(result)) {
        console.log(line);
      }
      if (verifyFailed(result)) {
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

  program
    .command("push")
    .description("Publish this machine's records to origin, on a ref of their own")
    .action(async () => {
      for (const line of formatPush(await pushLog(options))) {
        console.log(line);
      }
    });

  program
    .command("pull")
    .description("Fetch every key's records from origin. Nothing is merged into your log")
    .action(async () => {
      for (const line of formatPull(await pullPeers(options))) {
        console.log(line);
      }
    });

  program
    .command("peers")
    .description("The keys whose records are on this machine, and what they hold")
    .action(async () => {
      for (const line of formatPeers(await listPeers(options))) {
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
    .description("Register the Claude Code hooks that open and close sessions")
    .option("--uninstall", "take the hooks back out instead")
    .option(
      "--passive [yes|no]",
      "record sessions nobody declared, from the first prompt onwards",
      parseFlag,
      true,
    )
    // The same answer spelled the way commander spells it. Both are here
    // because `--passive=false` is what anyone reading the other flag would
    // reach for, and `--no-passive` is what anyone reading a commander CLI
    // would.
    .option("--no-passive", "register only the hook that closes a session you started")
    .action(async (flags: { uninstall?: boolean; passive?: boolean }) => {
      const result = flags.uninstall
        ? await uninstallHook(options)
        : await installHook({ ...options, passive: flags.passive });
      for (const line of formatHook(result)) {
        console.log(line);
      }
    });

  // Registered last, so it comes last in the short list: it is where a reader
  // goes when the two commands above are not the ones they wanted.
  program
    .command("help")
    .description("Every command, not just the ones above")
    .argument("[topic]", 'the only topic is "all"')
    .action((topic: string | undefined) => {
      if (topic === undefined) {
        program.outputHelp();
        return;
      }
      if (topic !== "all") {
        throw new Error(`No help topic ${topic}. The only one is: session help all.`);
      }
      for (const line of formatCommands(commandEntries(program), palette)) {
        console.log(line);
      }
    });

  return program;
}
