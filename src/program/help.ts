// The short `--help` surface and `help all`, both read off the command tree.
import { Command, Help } from "commander";
import { formatCommands, type CommandEntry } from "../render/terminal.js";
import type { Palette } from "../render/palette.js";
import { printLines } from "./print.js";

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
export const BRIEF_COMMANDS = ["start", "week", "help"];

/**
 * Narrows the top-level help to `BRIEF_COMMANDS` and nothing else.
 *
 * Both overrides are guarded on the command being rendered, because commander
 * calls them for every help screen in the tree. `session config --help` and
 * every other subcommand's help go through commander's own rendering, because
 * there is nothing to hide there — a reader who has typed `session config` has
 * already chosen the topic.
 *
 * The guard on `subcommandTerm` is the parent, not the name: commander gives
 * every command with subcommands an implicit `help` of its own, and a term
 * matched on the name alone renamed those too — `session hook --help` listed
 * `help all`, advertising a `session hook help all` that does not exist. The
 * implicit ones carry no parent; ours is a real command on the root.
 */
export function configureHelp(program: Command): void {
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
      // the reader to guess what a `[topic]` might be. Only the root's own
      // `help` — the one `registerHelp` added — takes the topic with it.
      return cmd.name() === "help" && cmd.parent === program
        ? "help all"
        : Help.prototype.subcommandTerm.call(this, cmd);
    },
  });

  // A function, so it is built when the help is printed rather than when this
  // runs — `registerCommands` has not happened yet. Written out by hand this
  // sentence was one release from being wrong, and it was: `scan` shipped and
  // the list still named ten commands.
  program.addHelpText("after", () => `\n${everythingElse(program)}`);
}

/** Width the footer sentence wraps at, matching the help above it. */
export const HELP_WIDTH = 78;

/**
 * The sentence under the short help: what it left out, and where to find it.
 *
 * Read off the command tree, like `session help all` and for the same reason.
 * The short list is a decision about what a first reader can use; this is a
 * statement about what exists, and a statement about what exists may not be
 * kept by hand.
 */
export function everythingElse(program: Command): string {
  const rest = program.commands
    .map((command) => command.name())
    .filter((name) => !BRIEF_COMMANDS.includes(name) && name !== "help");

  if (rest.length === 0) {
    return "Everything is listed above.";
  }
  return wrap(
    `Everything else — ${rest.join(", ")} — still works and is listed under ` +
      `${HELP_ALL.replaceAll(" ", "\u0000")}.`,
    HELP_WIDTH,
  );
}

/**
 * The command the sentence points at, kept whole.
 *
 * It is something the reader is meant to type, so a line break through the
 * middle of it turns the one actionable thing in the sentence into two halves
 * that have to be reassembled by hand.
 */
export const HELP_ALL = "session help all";

/**
 * Greedy wrap on spaces. The sentence is prose, so words stay whole — and
 * `HELP_ALL` counts as one word, however many spaces are in it.
 */
export function wrap(text: string, width: number): string {
  const lines: string[] = [];
  let line = "";
  const atomic = "\u0000";
  for (const token of text.split(" ")) {
    const word = token.replaceAll(atomic, " ");
    if (line === "") {
      line = word;
    } else if (line.length + 1 + word.length <= width) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }

  if (line !== "") {
    lines.push(line);
  }
  return lines.join("\n");
}

/**
 * Every command in the tree, parent and child, as `session help all` prints
 * them.
 *
 * Read off the tree rather than kept in a list beside it. A hand-maintained
 * list is one release away from being wrong, and the whole point of this
 * command is that it is the place where nothing is left out.
 */
export function commandEntries(program: Command): CommandEntry[] {
  return program.commands.flatMap((command) => [
    { name: command.name(), description: command.description() },
    ...command.commands.map((sub) => ({
      name: `${command.name()} ${sub.name()}`,
      description: sub.description(),
    })),
  ]);
}

export function registerHelp(program: Command, palette: Palette): void {
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
      printLines(formatCommands(commandEntries(program), palette));
    });
}
